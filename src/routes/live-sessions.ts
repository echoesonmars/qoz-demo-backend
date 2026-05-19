import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { assertCanStartLiveSession, maxConcurrentLiveIngest } from "../services/live-concurrency.js";
import { geminiLiveMaxConcurrent } from "../services/gemini-concurrency.js";
import {
  baseCaptureIntervalMs,
  captureIntervalMs,
  countActiveIngests,
  getLastIngestError,
  setCaptureIntervalOverride,
  startLiveIngest,
  stopLiveIngest,
  stopAllLiveIngests,
} from "../services/live-hls-ingest.js";
import { getLiveMetricsSnapshot } from "../services/live-metrics.js";
import { assertLiveStartRateLimit } from "../services/live-rate-limit.js";
import { pruneOldLiveData } from "../services/live-retention.js";
import {
  createMonitorSession,
  getLatestLiveSnapshot,
  getLatestSession,
  getLiveDashboard,
  getLiveFeed,
  getLiveIncidentEvents,
  getRunningSession,
  getSessionById,
  listDeviceSessions,
  listRunningSessions,
  stopMonitorSession,
  ZOMBIE_MESSAGE,
} from "../services/live-monitor-db.js";
import { finalizeSessionRecording } from "../services/live-session-finalize.js";
import {
  startSessionRecording,
  stopAllSessionRecordings,
} from "../services/live-session-recorder.js";
import { exportLiveSessionToLesson } from "../services/live-export-lesson.js";
import {
  getFleetSituationSummary,
  listFleetIncidentsForCategory,
  type FleetIncidentWithSession,
} from "../services/live-fleet-situations.js";
import { getLiveRetentionCutoff } from "../services/live-retention.js";
import { isIncidentCategoryId } from "../constants/incident-categories.js";
import { presignIncidentVideo } from "../services/storage.js";
import type { LiveIncidentEventRow, LiveMonitorSessionRow } from "../types/live-analysis.js";

function checkSecret(header: unknown): boolean {
  return header === getEnv().BACKEND_INTERNAL_SECRET;
}

const startBodySchema = z.object({
  deviceId: z.string().min(1),
  cameraId: z.string().min(1),
  hlsUrl: z.string().url(),
});

const deviceQuerySchema = z.object({
  deviceId: z.string().min(1),
});

function serializeSession(row: LiveMonitorSessionRow) {
  return {
    id: row.id,
    deviceId: row.device_id,
    cameraId: row.camera_id,
    hlsUrl: row.hls_url,
    status: row.status,
    startedAt: row.started_at.toISOString(),
    stoppedAt: row.stopped_at?.toISOString() ?? null,
    frameCount: row.frame_count,
    lastFrameAt: row.last_frame_at?.toISOString() ?? null,
    errorMessage: row.error_message,
    needsRestart: row.error_message === ZOMBIE_MESSAGE,
    lastIngestError: getLastIngestError(row.device_id),
    recordingStoragePath: row.recording_storage_path,
    recordingDurationSec: row.recording_duration_sec,
    recordingBytes: row.recording_bytes,
    recordingUploadStatus: row.recording_upload_status,
    recordingUploadedAt: row.recording_uploaded_at?.toISOString() ?? null,
  };
}

function serializeSnapshot(row: {
  id: string;
  session_id: string;
  device_id: string;
  captured_at: Date;
  payload: unknown;
  engagement_score: number | null;
  incident_count: number;
  session_offset_sec: number | null;
}) {
  return {
    id: row.id,
    sessionId: row.session_id,
    deviceId: row.device_id,
    capturedAt: row.captured_at.toISOString(),
    payload: row.payload,
    engagementScore: row.engagement_score,
    incidentCount: row.incident_count,
    sessionOffsetSec: row.session_offset_sec,
  };
}

async function serializeIncident(
  row: LiveIncidentEventRow,
  withSignedEvidence: boolean,
) {
  let evidenceUrl: string | null = null;
  if (withSignedEvidence && row.evidence_storage_path) {
    try {
      evidenceUrl = await presignIncidentVideo(row.evidence_storage_path, 3600);
    } catch {
      evidenceUrl = null;
    }
  }
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    sessionId: row.session_id,
    deviceId: row.device_id,
    capturedAt: row.captured_at.toISOString(),
    type: row.incident_type,
    confidence: row.confidence,
    locationContext: row.location_context,
    description: row.description,
    timestampMarker: row.timestamp_marker,
    evidenceStoragePath: row.evidence_storage_path,
    evidenceUrl,
  };
}

async function serializeFleetIncident(row: FleetIncidentWithSession) {
  const base = await serializeIncident(row, true);
  return {
    ...base,
    sessionStatus: row.session_status,
  };
}

export async function liveSessionsRoutes(app: FastifyInstance) {
  app.addHook("onClose", async () => {
    stopAllLiveIngests();
    stopAllSessionRecordings();
  });

  app.post("/api/live/sessions/start", async (request, reply) => {
    if (!checkSecret(request.headers["x-backend-secret"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = startBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    try {
      await assertCanStartLiveSession();
    } catch (e) {
      return reply.code(429).send({
        error: e instanceof Error ? e.message : "Limit reached",
        maxConcurrent: maxConcurrentLiveIngest(),
        activeIngests: countActiveIngests(),
      });
    }
    const { deviceId, cameraId, hlsUrl } = parsed.data;
    try {
      assertLiveStartRateLimit(deviceId);
    } catch (e) {
      return reply.code(429).send({
        error: e instanceof Error ? e.message : "Rate limit",
      });
    }
    const session = await createMonitorSession({ deviceId, cameraId, hlsUrl });
    startSessionRecording(session.id, hlsUrl);
    startLiveIngest(session, request.log);
    return reply.code(201).send({ session: serializeSession(session) });
  });

  app.post("/api/live/sessions/stop", async (request, reply) => {
    if (!checkSecret(request.headers["x-backend-secret"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = deviceQuerySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const deviceId = parsed.data.deviceId;
    stopLiveIngest(deviceId);
    const session = await stopMonitorSession(deviceId);
    if (session) {
      void finalizeSessionRecording(session.id, request.log);
    }
    return reply.send({ session: session ? serializeSession(session) : null });
  });

  app.get("/api/live/sessions", async (request, reply) => {
    const query = deviceQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "deviceId required" });
    }
    const running = await getRunningSession(query.data.deviceId);
    const latest = running ?? (await getLatestSession(query.data.deviceId));
    return reply.send({
      session: latest ? serializeSession(latest) : null,
      isMonitoring: Boolean(running),
    });
  });

  app.get("/api/live/sessions/list", async (request, reply) => {
    const query = deviceQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "deviceId required" });
    }
    const limit = Number((request.query as { limit?: string }).limit ?? 20);
    const sessions = await listDeviceSessions(
      query.data.deviceId,
      Math.min(Math.max(limit, 1), 50),
    );
    return reply.send({ sessions: sessions.map(serializeSession) });
  });

  app.get("/api/live/fleet", async (_request, reply) => {
    const running = await listRunningSessions();
    const metrics = getLiveMetricsSnapshot();
    return reply.send({
      activeIngests: countActiveIngests(),
      maxConcurrent: maxConcurrentLiveIngest(),
      runningSessions: running.length,
      captureIntervalMs: captureIntervalMs(),
      baseCaptureIntervalMs: baseCaptureIntervalMs(),
      geminiMaxConcurrent: geminiLiveMaxConcurrent(),
      lastGemini429At: metrics.lastGemini429At,
      lastFailStreakAlertAt: metrics.lastFailStreakAlertAt,
    });
  });

  app.get("/api/live/fleet/situations/summary", async (request, reply) => {
    const sinceParam = (request.query as { since?: string }).since ?? null;
    const since = getLiveRetentionCutoff(sinceParam);
    const summary = await getFleetSituationSummary(since);
    return reply.send(summary);
  });

  app.get("/api/live/fleet/situations", async (request, reply) => {
    const q = request.query as {
      category?: string;
      limit?: string;
      offset?: string;
      since?: string;
    };
    const category = q.category ?? "";
    if (!isIncidentCategoryId(category)) {
      return reply.code(400).send({ error: "category required" });
    }
    const since = getLiveRetentionCutoff(q.since ?? null);
    const limit = Math.min(Math.max(Number(q.limit ?? 40), 1), 100);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    const summary = await getFleetSituationSummary(since);
    const stat = summary.stats.find((s) => s.category === category);
    const total = stat?.count ?? 0;
    const { rows, hasMore } = await listFleetIncidentsForCategory({
      since,
      category,
      limit,
      offset,
    });
    const incidents = await Promise.all(rows.map((row) => serializeFleetIncident(row)));
    return reply.send({
      incidents,
      total,
      limit,
      offset,
      hasMore,
      since: since.toISOString(),
      retentionDays: summary.retentionDays,
    });
  });

  app.get("/api/live/metrics", async (request, reply) => {
    if (!checkSecret(request.headers["x-backend-secret"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return reply.send(getLiveMetricsSnapshot());
  });

  app.post("/api/live/admin/prune-retention", async (request, reply) => {
    if (!checkSecret(request.headers["x-backend-secret"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const result = await pruneOldLiveData();
    return reply.send(result);
  });

  app.patch("/api/live/config", async (request, reply) => {
    if (!checkSecret(request.headers["x-backend-secret"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = configBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body" });
    }
    if (parsed.data.captureIntervalMs !== undefined) {
      setCaptureIntervalOverride(parsed.data.captureIntervalMs);
    }
    return reply.send({
      baseCaptureIntervalMs: baseCaptureIntervalMs(),
      captureIntervalMs: captureIntervalMs(),
    });
  });

  app.get("/api/live/dashboard/stream", async (request, reply) => {
    if (!checkSecret(request.headers["x-backend-secret"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const deviceId = (request.query as { deviceId?: string }).deviceId;
    const sessionId = (request.query as { sessionId?: string }).sessionId ?? null;
    if (!deviceId) {
      return reply.code(400).send({ error: "deviceId required" });
    }
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = async () => {
      const dash = await getLiveDashboard({
        deviceId,
        sessionId,
        snapshotLimit: 50,
        incidentLimit: 50,
      });
      const incidents = await Promise.all(
        dash.incidents.map((row) => serializeIncident(row, true)),
      );
      const latest = dash.snapshots[0] ?? null;
      const payload = JSON.stringify({
        session: dash.session ? serializeSession(dash.session) : null,
        isMonitoring: dash.isMonitoring,
        snapshots: dash.snapshots.map(serializeSnapshot),
        incidents,
        latest: latest ? serializeSnapshot(latest) : null,
      });
      reply.raw.write(`data: ${payload}\n\n`);
    };
    await send();
    const pollMs = Math.max(captureIntervalMs(), 12_000);
    const timer = setInterval(() => {
      void send().catch(() => {});
    }, pollMs);
    request.raw.on("close", () => clearInterval(timer));
  });

  app.get("/api/live/dashboard", async (request, reply) => {
    const deviceId = (request.query as { deviceId?: string }).deviceId;
    const sessionId = (request.query as { sessionId?: string }).sessionId ?? null;
    const snapshotLimit = Number((request.query as { snapshotLimit?: string }).snapshotLimit ?? 50);
    const incidentLimit = Number((request.query as { incidentLimit?: string }).incidentLimit ?? 50);
    if (!deviceId) {
      return reply.code(400).send({ error: "deviceId required" });
    }
    const dash = await getLiveDashboard({
      deviceId,
      sessionId,
      snapshotLimit: Math.min(Math.max(snapshotLimit, 1), 200),
      incidentLimit: Math.min(Math.max(incidentLimit, 1), 100),
    });
    const incidents = await Promise.all(
      dash.incidents.map((row) => serializeIncident(row, true)),
    );
    const latest = dash.snapshots[0] ?? null;
    return reply.send({
      session: dash.session ? serializeSession(dash.session) : null,
      isMonitoring: dash.isMonitoring,
      snapshots: dash.snapshots.map(serializeSnapshot),
      incidents,
      latest: latest ? serializeSnapshot(latest) : null,
    });
  });

  app.get("/api/live/sessions/recording-url", async (request, reply) => {
    const sessionId = (request.query as { sessionId?: string }).sessionId;
    if (!sessionId) {
      return reply.code(400).send({ error: "sessionId required" });
    }
    const session = await getSessionById(sessionId);
    if (!session?.recording_storage_path || session.recording_upload_status !== "ready") {
      return reply.code(404).send({ error: "Recording not ready" });
    }
    const url = await presignIncidentVideo(session.recording_storage_path, 3600);
    return reply.send({ url, sessionId });
  });

const exportBodySchema = z.object({
  title: z.string().max(500).optional(),
});

const configBodySchema = z.object({
  captureIntervalMs: z.number().int().min(10_000).max(120_000).nullable().optional(),
});

  app.post("/api/live/sessions/:sessionId/export-lesson", async (request, reply) => {
    if (!checkSecret(request.headers["x-backend-secret"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const parsed = exportBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body" });
    }
    try {
      const result = await exportLiveSessionToLesson(sessionId, request.log, {
        title: parsed.data.title,
      });
      return reply.code(result.created ? 201 : 200).send({
        lessonId: result.lessonId,
        status: result.created ? "ready" : "exists",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Export failed";
      return reply.code(400).send({ error: msg });
    }
  });

  app.get("/api/live/feed", async (request, reply) => {
    const deviceId = (request.query as { deviceId?: string }).deviceId;
    const limit = Number((request.query as { limit?: string }).limit ?? 50);
    if (!deviceId) {
      return reply.code(400).send({ error: "deviceId required" });
    }
    const snapshots = await getLiveFeed(deviceId, Math.min(Math.max(limit, 1), 200));
    return reply.send({
      snapshots: snapshots.map(serializeSnapshot),
    });
  });

  app.get("/api/live/latest", async (request, reply) => {
    const deviceId = (request.query as { deviceId?: string }).deviceId;
    if (!deviceId) {
      return reply.code(400).send({ error: "deviceId required" });
    }
    const snapshot = await getLatestLiveSnapshot(deviceId);
    return reply.send({
      snapshot: snapshot ? serializeSnapshot(snapshot) : null,
    });
  });

  app.get("/api/live/incidents", async (request, reply) => {
    const deviceId = (request.query as { deviceId?: string }).deviceId;
    const limit = Number((request.query as { limit?: string }).limit ?? 30);
    if (!deviceId) {
      return reply.code(400).send({ error: "deviceId required" });
    }
    const events = await getLiveIncidentEvents(deviceId, Math.min(Math.max(limit, 1), 100));
    const incidents = await Promise.all(events.map((row) => serializeIncident(row, true)));
    return reply.send({ incidents });
  });
}
