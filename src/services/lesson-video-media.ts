import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getEnv } from "../config/env.js";
import { resolveFfmpegPath, resolveFfprobePath } from "./live-hls-capture.js";
import { downloadVideo } from "./video-download.js";

export type LessonMediaWorkDir = {
  root: string;
  sourcePath: string;
  audioPath: string;
  framesDir: string;
};

function lessonTmpRoot(): string {
  const custom = getEnv().LESSON_ANALYZE_TMP_DIR.trim();
  return custom || os.tmpdir();
}

function runFfmpeg(
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
  abortMessage = "Lesson media extract aborted",
): Promise<void> {
  const ffmpeg = resolveFfmpegPath();
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("FFmpeg lesson extract timeout"));
    }, timeoutMs);

    const onAbort = () => {
      proc.kill("SIGKILL");
      reject(new Error(abortMessage));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `FFmpeg exited with code ${code ?? "unknown"}`));
        return;
      }
      resolve();
    });
  });
}

export function lessonFrameScaleFilter(sampleSec: number): string {
  const fps = 1 / sampleSec;
  return `fps=${fps},scale=640:480`;
}

export async function probeMediaDurationSec(
  mediaPath: string,
  signal?: AbortSignal,
): Promise<number> {
  const ffprobe = resolveFfprobePath();
  const timeoutMs = getEnv().LESSON_ANALYZE_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      mediaPath,
    ];
    const proc = spawn(ffprobe, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("FFprobe timeout"));
    }, timeoutMs);

    const onAbort = () => {
      proc.kill("SIGKILL");
      reject(new Error("Lesson analyze aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `FFprobe exited with code ${code ?? "unknown"}`));
        return;
      }
      const value = Number.parseFloat(stdout.trim());
      if (!Number.isFinite(value) || value <= 0) {
        reject(new Error("Could not determine media duration"));
        return;
      }
      resolve(value);
    });
  });
}

export async function prepareLessonMediaWorkDir(
  videoUrl: string,
  signal?: AbortSignal,
): Promise<LessonMediaWorkDir> {
  const env = getEnv();
  const timeoutMs = env.LESSON_ANALYZE_TIMEOUT_MS;
  const sampleSec = env.LESSON_VISION_SAMPLE_SEC;
  const root = await fs.mkdtemp(path.join(lessonTmpRoot(), "qoz-lesson-"));
  const sourcePath = path.join(root, "source.mp4");
  const audioPath = path.join(root, "audio.wav");
  const framesDir = path.join(root, "frames");

  const { buffer } = await downloadVideo(videoUrl, signal);
  await fs.writeFile(sourcePath, buffer);
  await fs.mkdir(framesDir, { recursive: true });

  const vf = lessonFrameScaleFilter(sampleSec);
  const outPattern = path.join(framesDir, "frame_%04d.jpg");

  await Promise.all([
    runFfmpeg(
      ["-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", audioPath],
      timeoutMs,
      signal,
    ),
    runFfmpeg(
      ["-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath, "-vf", vf, outPattern],
      timeoutMs,
      signal,
    ),
  ]);

  return { root, sourcePath, audioPath, framesDir };
}

export async function readLessonFrameJpegs(framesDir: string): Promise<Buffer[]> {
  const names = await fs.readdir(framesDir);
  const frames = names
    .filter((n) => /^frame_\d+\.jpg$/i.test(n))
    .sort((a, b) => a.localeCompare(b));
  const out: Buffer[] = [];
  for (const name of frames) {
    const buf = await fs.readFile(path.join(framesDir, name));
    if (buf.length > 0) {
      out.push(buf);
    }
  }
  return out;
}

export async function cleanupLessonMediaWorkDir(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
}
