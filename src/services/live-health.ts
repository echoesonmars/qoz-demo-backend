import fs from "node:fs/promises";
import os from "node:os";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { getEnv } from "../config/env.js";
import { resolveFfmpegPath } from "./live-hls-capture.js";
import { createS3Client } from "./storage.js";

export type LiveHealthReport = {
  ffmpeg: { ok: boolean; detail: string };
  storage: { ok: boolean; detail: string };
  gemini: { ok: boolean; detail: string };
  tmp: { ok: boolean; detail: string; freeBytes?: number };
};

export async function checkLiveHealth(): Promise<LiveHealthReport> {
  const ffmpeg = await checkFfmpeg();
  const storage = await checkStorage();
  const gemini = checkGeminiConfigured();
  const tmp = await checkTmpSpace();
  return { ffmpeg, storage, gemini, tmp };
}

async function checkFfmpeg(): Promise<{ ok: boolean; detail: string }> {
  try {
    const bin = resolveFfmpegPath();
    return { ok: Boolean(bin), detail: bin ? "ffmpeg available" : "ffmpeg missing" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "ffmpeg error" };
  }
}

async function checkStorage(): Promise<{ ok: boolean; detail: string }> {
  const env = getEnv();
  try {
    const client = createS3Client();
    await client.send(
      new HeadObjectCommand({
        Bucket: env.STORAGE_BUCKET,
        Key: ".live-health-probe",
      }),
    );
    return { ok: true, detail: `bucket ${env.STORAGE_BUCKET} reachable` };
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || status === 403) {
      return { ok: true, detail: `bucket ${env.STORAGE_BUCKET} reachable (${status})` };
    }
    return { ok: false, detail: e instanceof Error ? e.message : "storage error" };
  }
}

function checkGeminiConfigured(): { ok: boolean; detail: string } {
  const env = getEnv();
  if (env.GEMINI_LIVE_MODE === "mock") {
    return { ok: true, detail: "mock mode" };
  }
  if (env.GEMINI_API_KEY?.trim()) {
    return { ok: true, detail: "API key set" };
  }
  return { ok: false, detail: "GEMINI_API_KEY missing" };
}

async function checkTmpSpace(): Promise<{ ok: boolean; detail: string; freeBytes?: number }> {
  const dir = process.env.LIVE_RECORDING_TMP_DIR?.trim() || os.tmpdir();
  try {
    const stat = await fs.statfs(dir);
    const freeBytes = Number(stat.bfree) * Number(stat.bsize);
    const minFree = Number.parseInt(process.env.LIVE_TMP_MIN_FREE_MB ?? "512", 10) * 1024 * 1024;
    const ok = freeBytes >= minFree;
    return {
      ok,
      freeBytes,
      detail: ok
        ? `${Math.round(freeBytes / 1024 / 1024)} MB free in ${dir}`
        : `Мало места в ${dir}: ${Math.round(freeBytes / 1024 / 1024)} MB (нужно ≥ ${Math.round(minFree / 1024 / 1024)} MB)`,
    };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "tmp check failed" };
  }
}
