import type { FastifyBaseLogger } from "fastify";
import { getEnv } from "../config/env.js";
import { withGeminiLiveSlot } from "./gemini-concurrency.js";
import { analyzeLiveFrame } from "./gemini-live-frame.js";
import { formatUserFacingLiveIngestError } from "./live-ingest-error-format.js";
import { captureHlsFrameWithRetry } from "./live-hls-capture.js";
import { recordGemini429, recordIngestTick } from "./live-metrics.js";
import { buildMockLiveAnalysis } from "./live-mock-analysis.js";
import {
  insertLiveSnapshot,
  setMonitorSessionError,
  touchMonitorSessionFrame,
} from "./live-monitor-db.js";
import { liveCaptureIntervalMinFloorMs } from "./live-capture-interval-bounds.js";
import type { LiveAnalysisPayload, LiveMonitorSessionRow } from "../types/live-analysis.js";
import { stopSessionRecording } from "./live-session-recorder.js";
import { analyzeLiveFrameWithVision } from "./vision-live-frame.js";
import { withVisionLiveSlot } from "./vision-concurrency.js";

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

export function hasLiveIngest(deviceId: string): boolean {
  return activeIngests.has(deviceId);
}

function setIngestError(deviceId: string, message: string | null): void {
  if (message) lastIngestErrors.set(deviceId, message);
  else lastIngestErrors.delete(deviceId);
}

function shouldUseMock(): boolean {
  const env = getEnv();
  if (env.GEMINI_LIVE_MODE === "mock") return true;
  if (env.GEMINI_LIVE_MODE === "live") return false;
  if (env.VISION_LIVE_MODE !== "off" && env.VISION_LIVE_URL.trim()) {
    return false;
  }
  return !env.GEMINI_API_KEY;
}

export function liveSnapshotEvidenceEnabled(): boolean {
  return !shouldUseMock();
}

let intervalOverrideMs: number | null = null;

export function setCaptureIntervalOverride(ms: number | null): void {
  if (ms == null) {
    intervalOverrideMs = null;
    rescheduleAllIngestTimers();
    return;
  }
  const floor = liveCaptureIntervalMinFloorMs();
  const clamped = Math.min(120_000, Math.max(floor, Math.floor(ms)));
  intervalOverrideMs = clamped;
  rescheduleAllIngestTimers();
}

export function baseCaptureIntervalMs(): number {
  if (intervalOverrideMs != null) return intervalOverrideMs;
  const floor = liveCaptureIntervalMinFloorMs();
  const raw = Number(process.env.LIVE_CAPTURE_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(raw)) return Math.max(DEFAULT_INTERVAL_MS, floor);
  return Math.min(120_000, Math.max(floor, raw));
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
  let tickAnalysisSource: "mock" | "vision" | "gemini" | undefined;
  let tickVisionMs: number | undefined;

  try {
    let payload: LiveAnalysisPayload | null = null;
    let frameJpeg: Buffer | null = null;
    const uploadEvidence = !shouldUseMock();

    if (shouldUseMock()) {
      payload = buildMockLiveAnalysis(handle.tick);
      tickAnalysisSource = "mock";
    } else {
      frameJpeg = await captureHlsFrameWithRetry(session.hls_url, handle.abort.signal);
      const env = getEnv();
      const visionMode = env.VISION_LIVE_MODE;

      if (visionMode !== "off") {
        const vStart = Date.now();
        try {
          const v = await withVisionLiveSlot(() =>
            analyzeLiveFrameWithVision(frameJpeg!, handle.abort.signal, {
              sessionId: session.id,
              deviceId: session.device_id,
            }),
          );
          if (v) {
            payload = v;
            tickVisionMs = Date.now() - vStart;
            tickAnalysisSource = "vision";
          }
        } catch (err) {
          log.warn(
            { err, sessionId: session.id, deviceId: session.device_id },
            "vision live analyze failed",
          );
          if (visionMode === "live") {
            throw err;
          }
        }
      }

      if (!payload) {
        if (visionMode === "live") {
          handle.failStreak += 1;
          log.warn(
            { sessionId: session.id, deviceId: session.device_id },
            "vision live: empty analysis result",
          );
          if (handle.failStreak >= MAX_CONSECUTIVE_FAILS) {
            await setMonitorSessionError(
              session.id,
              "Слишком много ошибок анализа кадра подряд (vision)",
            );
            stopLiveIngest(session.device_id);
          }
          tickAnalysisSource = "vision";
          return;
        }

        const analyzed = await withGeminiLiveSlot(() => analyzeLiveFrame(frameJpeg!));
        if (!analyzed) {
          handle.failStreak += 1;
          log.warn({ sessionId: session.id, deviceId: session.device_id }, "live parse failed");
          if (handle.failStreak >= MAX_CONSECUTIVE_FAILS) {
            await setMonitorSessionError(
              session.id,
              "Слишком много ошибок анализа кадра подряд (Gemini)",
            );
            stopLiveIngest(session.device_id);
          }
          tickAnalysisSource = "gemini";
          return;
        }
        payload = analyzed;
        tickAnalysisSource = "gemini";
      }
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
        analysisSource: tickAnalysisSource,
        visionDurationMs: tickVisionMs,
        durationMs: Date.now() - started,
      },
      "live snapshot stored",
    );
  } catch (err) {
    handle.failStreak += 1;
    const msg = formatUserFacingLiveIngestError(err);
    if (/429|RESOURCE_EXHAUSTED/i.test(msg)) {
      recordGemini429(session.device_id);
    }
    setIngestError(session.device_id, msg);
    log.warn(
      {
        err,
        sessionId: session.id,
        deviceId: session.device_id,
        durationMs: Date.now() - started,
      },
      "live tick failed",
    );
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
      analysisSource: tickAnalysisSource,
      visionDurationMs: tickVisionMs,
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
  const sessionId = handle.session.id;
  clearInterval(handle.timer);
  handle.abort.abort();
  activeIngests.delete(deviceId);
  lastIngestErrors.delete(deviceId);
  rescheduleAllIngestTimers();
  void stopSessionRecording(sessionId).catch(() => {});
}

export function stopAllLiveIngests(): void {
  for (const deviceId of [...activeIngests.keys()]) {
    stopLiveIngest(deviceId);
  }
}
