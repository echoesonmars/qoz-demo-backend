import type { FastifyBaseLogger } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";

import { getEnv } from "../config/env.js";
import type { LessonAnalysisReport } from "../types/lessons.js";
import { buildLessonLog } from "./lesson-log-builder.js";
import { synthesizeLessonReport } from "./lesson-llm-client.js";
import { analyzeLessonFrames } from "./lesson-vision-batch.js";
import { transcribeLessonAudio } from "./lesson-whisper-client.js";
import {
  cleanupLessonMediaWorkDir,
  prepareLessonMediaWorkDir,
  probeMediaDurationSec,
  readLessonFrameJpegs,
} from "./lesson-video-media.js";

function mergeAbortSignals(jobSignal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([jobSignal, AbortSignal.timeout(timeoutMs)]);
}

export async function analyzeLessonPipeline(
  videoUrl: string,
  signal: AbortSignal,
  ctx: { lessonId: string; log: FastifyBaseLogger },
): Promise<LessonAnalysisReport> {
  const env = getEnv();
  const merged = mergeAbortSignals(signal, env.LESSON_ANALYZE_TIMEOUT_MS);
  const sampleSec = env.LESSON_VISION_SAMPLE_SEC;
  let workRoot: string | null = null;

  try {
    ctx.log.info({ lessonId: ctx.lessonId }, "lesson pipeline started");

    const media = await prepareLessonMediaWorkDir(videoUrl, merged);
    workRoot = media.root;

    const durationSec = await probeMediaDurationSec(media.sourcePath, merged);
    const frames = await readLessonFrameJpegs(media.framesDir);

    if (frames.length === 0) {
      throw new Error("No frames extracted from lesson video");
    }

    const transcript = await transcribeLessonAudio(media.audioPath, merged);
    const visionSnapshots = await analyzeLessonFrames(
      frames,
      sampleSec,
      ctx.lessonId,
      merged,
    );

    const builtLog = buildLessonLog(
      transcript,
      visionSnapshots,
      durationSec,
      sampleSec,
    );

    if (env.LESSON_PIPELINE_SAVE_DEBUG_LOG) {
      const debugPath = path.join(media.root, "compiled-log.txt");
      await fs.writeFile(debugPath, builtLog.compiledText, "utf8");
      ctx.log.info({ lessonId: ctx.lessonId, debugPath }, "lesson pipeline debug log saved");
    }

    const report = await synthesizeLessonReport(builtLog, merged);

    ctx.log.info(
      {
        lessonId: ctx.lessonId,
        language: report.detected_language,
        frames: frames.length,
        windows: builtLog.windows.length,
      },
      "lesson pipeline completed",
    );

    return report;
  } finally {
    if (workRoot) {
      await cleanupLessonMediaWorkDir(workRoot);
    }
  }
}
