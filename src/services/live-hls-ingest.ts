import type { FastifyBaseLogger } from "fastify";
import { getEnv } from "../config/env.js";
import { withGeminiLiveSlot } from "./gemini-concurrency.js";
import { analyzeLiveFrame } from "./gemini-live-frame.js";
import { formatUserFacingGeminiError } from "./gemini-error-format.js";
import { captureHlsFrameWithRetry } from "./live-hls-capture.js";
import { recordGemini429, recordIngestTick } from "./live-metrics.js";
import { buildMockLiveAnalysis } from "./live-mock-analysis.js";
import {
  insertLiveSnapshot,
  setMonitorSessionError,
  touchMonitorSessionFrame,
} from "./live-monitor-db.js";
import type { LiveMonitorSessionRow } from "../types/live-analysis.js";

const DEFAULT_INTERVAL_MS = 10_000;
const MAX_CONSECUTIVE_FAILS = 5;

type IngestHandle = {
  timer: ReturnType<typeof setInterval>;
  abort: AbortController;
  tick: number;
  failStreak: number;
  session: LiveMonitorSessionRow;
  log: FastifyBaseLogger;
};

const activeIngests = new Map<string, IngestHandle>();
const lastIngestErrors = new Map<string, string>();

export function getLastIngestError(deviceId: string): string | null {
  return lastIngestErrors.get(deviceId) ?? null;
}

export function countActiveIngests(): number {
  return activeIngests.size;
}

function setIngestError(deviceId: string, message: string | null): void {
  if (message) lastIngestErrors.set(deviceId, message);
  else lastIngestErrors.delete(deviceId);
}

function shouldUseMock(): boolean {
  const env = getEnv();
  if (env.GEMINI_LIVE_MODE === "mock") return true;
  if (env.GEMINI_LIVE_MODE === "live") return false;
  return !env.GEMINI_API_KEY;
}

let intervalOverrideMs: number | null = null;

export function setCaptureIntervalOverride(ms: number | null): void {
  if (ms == null) {
    intervalOverrideMs = null;
    rescheduleAllIngestTimers();
    return;
  }
  const clamped = Math.min(120_000, Math.max(10_000, Math.floor(ms)));
  intervalOverrideMs = clamped;
  rescheduleAllIngestTimers();
}

export function baseCaptureIntervalMs(): number {
  if (intervalOverrideMs != null) return intervalOverrideMs;
  const raw = Number(process.env.LIVE_CAPTURE_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw < 10_000) return DEFAULT_INTERVAL_MS;
  return Math.min(raw, 120_000);
}

export function captureIntervalMs(): number {
  const base = baseCaptureIntervalMs();
  const n = activeIngests.size;
  if (n <= 1) return base;
  return Math.min(120_000, base + (n - 1) * 5_000);
}

function rescheduleIngestTimer(handle: IngestHandle): void {
  clearInterval(handle.timer);
  handle.timer = setInterval(() => {
    void runTick(handle.session, handle, handle.log);
  }, captureIntervalMs());
}

function rescheduleAllIngestTimers(): void {
  for (const handle of activeIngests.values()) {
    rescheduleIngestTimer(handle);
  }
}

async function runTick(
  session: LiveMonitorSessionRow,
  handle: IngestHandle,
  log: FastifyBaseLogger,
): Promise<void> {
  const started = Date.now();
  const sessionOffsetSec = Math.floor(
    (started - new Date(session.started_at).getTime()) / 1000,
  );

  try {
    let payload;
    let frameJpeg: Buffer | null = null;
    const uploadEvidence = !shouldUseMock();
    if (shouldUseMock()) {
      payload = buildMockLiveAnalysis(handle.tick);
    } else {
      frameJpeg = await captureHlsFrameWithRetry(session.hls_url, handle.abort.signal);
      const analyzed = await withGeminiLiveSlot(() => analyzeLiveFrame(frameJpeg!));
      if (!analyzed) {
        handle.failStreak += 1;
        log.warn({ sessionId: session.id, deviceId: session.device_id }, "live parse failed");
        if (handle.failStreak >= MAX_CONSECUTIVE_FAILS) {
          await setMonitorSessionError(
            session.id,
            "Слишком много ошибок анализа подряд",
          );
          stopLiveIngest(session.device_id);
        }
        recordIngestTick({
          deviceId: session.device_id,
          sessionId: session.id,
          durationMs: Date.now() - started,
          failStreak: handle.failStreak,
        });
        return;
      }
      payload = analyzed;
    }

    await insertLiveSnapshot({
      sessionId: session.id,
      deviceId: session.device_id,
      payload,
      sessionOffsetSec,
      frameJpeg,
      uploadEvidence,
    });
    await touchMonitorSessionFrame(session.id);
    setIngestError(session.device_id, null);
    handle.failStreak = 0;
    handle.tick += 1;
    log.info(
      {
        sessionId: session.id,
        deviceId: session.device_id,
        score: payload.analytics_meta.overall_engagement_score,
        incidents: payload.detected_incidents.length,
      },
      "live snapshot stored",
    );
  } catch (err) {
    handle.failStreak += 1;
    const msg = formatUserFacingGeminiError(err);
    if (/429|RESOURCE_EXHAUSTED/i.test(msg)) {
      recordGemini429(session.device_id);
    }
    setIngestError(session.device_id, msg);
    log.warn({ err, sessionId: session.id }, "live tick failed");
    if (handle.failStreak >= MAX_CONSECUTIVE_FAILS) {
      await setMonitorSessionError(session.id, msg);
      stopLiveIngest(session.device_id);
    }
  } finally {
    recordIngestTick({
      deviceId: session.device_id,
      sessionId: session.id,
      durationMs: Date.now() - started,
      failStreak: handle.failStreak,
    });
  }
}

export function startLiveIngest(
  session: LiveMonitorSessionRow,
  log: FastifyBaseLogger,
): void {
  stopLiveIngest(session.device_id);
  const abort = new AbortController();
  const handle: IngestHandle = {
    timer: setInterval(() => {}, captureIntervalMs()),
    abort,
    tick: 0,
    failStreak: 0,
    session,
    log,
  };
  rescheduleIngestTimer(handle);
  activeIngests.set(session.device_id, handle);
  rescheduleAllIngestTimers();
  void runTick(session, handle, log);
  log.info({ deviceId: session.device_id, sessionId: session.id }, "live ingest started");
}

export function stopLiveIngest(deviceId: string): void {
  const handle = activeIngests.get(deviceId);
  if (!handle) return;
  clearInterval(handle.timer);
  handle.abort.abort();
  activeIngests.delete(deviceId);
  lastIngestErrors.delete(deviceId);
  rescheduleAllIngestTimers();
}

export function stopAllLiveIngests(): void {
  for (const deviceId of [...activeIngests.keys()]) {
    stopLiveIngest(deviceId);
  }
}
