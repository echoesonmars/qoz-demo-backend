import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { getEnv } from "../config/env.js";
import type { LiveMonitorSessionRow } from "../types/live-analysis.js";
import { recordVisionHttpError } from "./live-metrics.js";
import { liveCaptureIntervalMinFloorMs } from "./live-capture-interval-bounds.js";

const DEFAULT_INTERVAL_MS = 10_000;

const startedDriverDevices = new Set<string>();

export function isVisionLiveDriverDevice(deviceId: string): boolean {
  return startedDriverDevices.has(deviceId);
}

function visionBase(): string {
  return getEnv().VISION_LIVE_URL.trim().replace(/\/$/, "");
}

function driverIntervalMs(): number {
  const floor = liveCaptureIntervalMinFloorMs();
  const raw = Number(process.env.LIVE_CAPTURE_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(raw)) return Math.max(DEFAULT_INTERVAL_MS, floor);
  return Math.min(120_000, Math.max(floor, raw));
}

export async function notifyVisionLiveDriverStart(
  session: LiveMonitorSessionRow,
  log: FastifyBaseLogger,
): Promise<void> {
  const env = getEnv();
  const base = visionBase();
  const url = `${base}/api/live-driver/sessions/start`;
  const secret = env.VISION_INTERNAL_SECRET.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Request-Id": randomUUID(),
  };
  if (secret) {
    headers["X-Vision-Internal-Secret"] = secret;
  }
  const body = {
    sessionId: session.id,
    deviceId: session.device_id,
    hlsUrl: session.hls_url,
    startedAtIso: session.started_at.toISOString(),
    intervalMs: driverIntervalMs(),
  };
  const t0 = Date.now();
  let loggedHttpFail = false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.VISION_LIVE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      recordVisionHttpError({
        deviceId: session.device_id,
        sessionId: session.id,
        status: res.status,
        durationMs: Date.now() - t0,
      });
      loggedHttpFail = true;
      throw new Error(`vision live-driver HTTP ${res.status}: ${text.slice(0, 400)}`);
    }
    startedDriverDevices.add(session.device_id);
    log.info(
      { sessionId: session.id, deviceId: session.device_id },
      "vision live driver ingest started",
    );
  } catch (err) {
    if (!loggedHttpFail) {
      recordVisionHttpError({
        deviceId: session.device_id,
        sessionId: session.id,
        status: 0,
        durationMs: Date.now() - t0,
      });
    }
    startedDriverDevices.delete(session.device_id);
    log.warn(
      { err, sessionId: session.id, deviceId: session.device_id },
      "vision live driver start failed",
    );
    throw err;
  }
}

export async function notifyVisionLiveDriverStop(
  deviceId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const env = getEnv();
  const base = visionBase();
  if (!base) {
    startedDriverDevices.delete(deviceId);
    return;
  }
  const url = `${base}/api/live-driver/sessions/stop`;
  const secret = env.VISION_INTERNAL_SECRET.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Request-Id": randomUUID(),
  };
  if (secret) {
    headers["X-Vision-Internal-Secret"] = secret;
  }
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ deviceId }),
      signal: AbortSignal.timeout(env.VISION_LIVE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      recordVisionHttpError({
        deviceId,
        status: res.status,
        durationMs: Date.now() - t0,
      });
      log.warn(
        { deviceId, status: res.status, text: text.slice(0, 200) },
        "vision live driver stop HTTP error",
      );
    }
  } catch (err) {
    recordVisionHttpError({ deviceId, status: 0, durationMs: Date.now() - t0 });
    log.warn({ err, deviceId }, "vision live driver stop failed");
  } finally {
    startedDriverDevices.delete(deviceId);
  }
}

export async function stopAllVisionLiveDrivers(log: FastifyBaseLogger): Promise<void> {
  const ids = [...startedDriverDevices];
  for (const id of ids) {
    await notifyVisionLiveDriverStop(id, log);
  }
}
