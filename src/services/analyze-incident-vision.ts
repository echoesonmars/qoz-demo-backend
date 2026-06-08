import type { FastifyBaseLogger } from "fastify";

import { getEnv } from "../config/env.js";
import type { AnalyzeResult } from "../types/incidents.js";
import type { VisionFrameAnalysisDto } from "../types/vision-frame-dto.js";
import { extractIncidentVideoFrameBuffers } from "./incident-video-frames.js";
import {
  aggregateIncidentFrames,
  explainEmptyAggregate,
  summarizeRawCategoryHits,
} from "./incident-vision-aggregate.js";
import { formatUserFacingVisionError } from "./vision-error-format.js";
import { isVisionUrlConfigured, postVisionAnalyzeFrame } from "./vision-live-frame.js";

export type IncidentVisionAnalyzeMeta = {
  frameCount: number;
  analyzedFrames: number;
  durationMs: number;
  category: string | null;
  categories: string[];
  emptyReason: string | null;
  rawSmokingFrames: number;
  rawSmokingMaxScore: number;
};

export async function analyzeIncidentVideoWithVision(
  videoUrl: string,
  log?: FastifyBaseLogger,
  incidentId?: string,
  signal?: AbortSignal,
): Promise<{ result: AnalyzeResult | null; meta: IncidentVisionAnalyzeMeta }> {
  if (!isVisionUrlConfigured()) {
    throw new Error("VISION_LIVE_URL is not configured");
  }

  const env = getEnv();
  const started = Date.now();
  const frames = await extractIncidentVideoFrameBuffers(videoUrl, signal);
  const dtos: VisionFrameAnalysisDto[] = [];
  const ctx = {
    deviceId: "incident-upload",
    sessionId: incidentId,
  };
  let lastFrameError: unknown;

  for (let i = 0; i < frames.length; i++) {
    if (signal?.aborted) {
      throw new Error("Анализ остановлен");
    }
    try {
      const dto = await postVisionAnalyzeFrame(frames[i], signal, ctx);
      dtos.push(dto);
    } catch (e) {
      lastFrameError = e;
      log?.warn(
        { err: e, incidentId, frameIndex: i },
        "incident vision frame analyze failed, skipping frame",
      );
    }
  }

  if (dtos.length === 0) {
    if (lastFrameError) {
      throw new Error(formatUserFacingVisionError(lastFrameError));
    }
    throw new Error("Не удалось проанализировать кадры видео");
  }

  const result = aggregateIncidentFrames(dtos, env.INCIDENT_VISION_MIN_CONF);
  const rawHits = summarizeRawCategoryHits(dtos);
  const rawSmoking = rawHits.find((r) => r.category === "smoking");
  const meta: IncidentVisionAnalyzeMeta = {
    frameCount: frames.length,
    analyzedFrames: dtos.length,
    durationMs: Date.now() - started,
    category: result?.category ?? null,
    categories: result?.categories?.map((c) => c.category) ?? [],
    emptyReason: result
      ? null
      : explainEmptyAggregate(dtos, env.INCIDENT_VISION_MIN_CONF),
    rawSmokingFrames: rawSmoking?.frames ?? 0,
    rawSmokingMaxScore: rawSmoking?.maxScore ?? 0,
  };

  log?.info(
    {
      incidentId,
      analysisSource: "vision",
      ...meta,
    },
    "incident vision analyze completed",
  );

  return { result, meta };
}
