import { getEnv } from "../config/env.js";
import type { LessonFrameSnapshot } from "./lesson-frame-stats.js";
import { snapshotFromDto } from "./lesson-frame-stats.js";
import { postVisionAnalyzeFrame, resolveLessonVisionUrl } from "./vision-live-frame.js";

let active = 0;
const waiters: Array<() => void> = [];

function maxConcurrent(): number {
  return getEnv().LESSON_VISION_MAX_CONCURRENT;
}

function releaseSlot(): void {
  active -= 1;
  const next = waiters.shift();
  if (next) next();
}

async function acquireSlot(): Promise<void> {
  if (active < maxConcurrent()) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    waiters.push(() => {
      active += 1;
      resolve();
    });
  });
}

async function withLessonVisionSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

export async function analyzeLessonFrames(
  frames: Buffer[],
  sampleSec: number,
  lessonId: string,
  signal?: AbortSignal,
): Promise<LessonFrameSnapshot[]> {
  const env = getEnv();
  const baseUrl = resolveLessonVisionUrl();
  if (!baseUrl) {
    throw new Error("Vision URL is not configured for lesson pipeline");
  }

  const ctx = { deviceId: "lesson-upload", sessionId: lessonId };
  const runAllSpecialized = env.LESSON_VISION_RUN_ALL_SPECIALIZED;
  const out: LessonFrameSnapshot[] = [];
  let lastError: unknown;

  const tasks = frames.map((jpeg, frameIndex) => async () => {
    if (signal?.aborted) {
      throw new Error("Анализ остановлен");
    }
    try {
      const dto = await withLessonVisionSlot(() =>
        postVisionAnalyzeFrame(jpeg, signal, ctx, { baseUrl, runAllSpecialized }),
      );
      out.push(snapshotFromDto(frameIndex, frameIndex * sampleSec, dto));
    } catch (e) {
      lastError = e;
    }
  });

  for (const task of tasks) {
    if (signal?.aborted) {
      throw new Error("Анализ остановлен");
    }
    await task();
  }

  out.sort((a, b) => a.frameIndex - b.frameIndex);

  if (out.length === 0) {
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error("Не удалось проанализировать кадры урока");
  }

  return out;
}
