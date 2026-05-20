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
  vision: { ok: boolean; detail: string };
  tmp: { ok: boolean; detail: string; freeBytes?: number };
};

export async function checkLiveHealth(): Promise<LiveHealthReport> {
  const ffmpeg = await checkFfmpeg();
  const storage = await checkStorage();
  const gemini = checkGeminiConfigured();
  const vision = await checkVisionReachable();
  const tmp = await checkTmpSpace();
  return { ffmpeg, storage, gemini, vision, tmp };
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
  if (env.VISION_LIVE_MODE === "live" && env.VISION_LIVE_URL.trim()) {
    return { ok: true, detail: "snapshot analysis via qoz-vision (Gemini key optional)" };
  }
  if (env.VISION_LIVE_DRIVER === "on" && env.VISION_LIVE_URL.trim()) {
    return { ok: true, detail: "vision live driver ingest (Gemini key optional)" };
  }
  if (env.GEMINI_API_KEY?.trim()) {
    return { ok: true, detail: "API key set" };
  }
  return { ok: false, detail: "GEMINI_API_KEY missing for this mode" };
}

async function checkVisionReachable(): Promise<{ ok: boolean; detail: string }> {
  const env = getEnv();
  if (!env.VISION_LIVE_URL.trim()) {
    return { ok: true, detail: "vision URL unset" };
  }
  if (env.VISION_LIVE_MODE === "off" && env.VISION_LIVE_DRIVER !== "on") {
    return { ok: true, detail: "VISION_LIVE_URL set but ingest mode off and driver off" };
  }
  const base = env.VISION_LIVE_URL.trim().replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) {
      return { ok: false, detail: `vision health HTTP ${r.status}` };
    }
    const j = (await r.json()) as { models_loaded?: boolean };
    if (j.models_loaded === false) {
      return { ok: false, detail: "qoz-vision models not loaded" };
    }
    return { ok: true, detail: "qoz-vision reachable" };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : "qoz-vision unreachable",
    };
  }
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
