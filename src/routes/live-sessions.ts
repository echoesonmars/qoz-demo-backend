import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import {
  createMonitorSession,
  getLatestLiveSnapshot,
  getLatestSession,
  getLiveFeed,
  getLiveIncidentEvents,
  getRunningSession,
  stopMonitorSession,
  ZOMBIE_MESSAGE,
} from "../services/live-monitor-db.js";
import {
  getLastIngestError,
  startLiveIngest,
  stopLiveIngest,
  stopAllLiveIngests,
} from "../services/live-hls-ingest.js";

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

function serializeSession(row: {
  id: string;
  device_id: string;
  camera_id: string | null;
  hls_url: string;
  status: string;
  started_at: Date;
  stopped_at: Date | null;
  frame_count: number;
  last_frame_at: Date | null;
  error_message: string | null;
}) {
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

function serializeIncident(row: {
  id: string;
  snapshot_id: string;
  session_id: string;
  device_id: string;
  captured_at: Date;
  incident_type: string;
  confidence: string;
  location_context: string | null;
  description: string;
  timestamp_marker: string | null;
}) {
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
  };
}

export async function liveSessionsRoutes(app: FastifyInstance) {
  app.addHook("onClose", async () => {
    stopAllLiveIngests();
  });

  app.post("/api/live/sessions/start", async (request, reply) => {
    if (!checkSecret(request.headers["x-backend-secret"])) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = startBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const { deviceId, cameraId, hlsUrl } = parsed.data;
    const session = await createMonitorSession({ deviceId, cameraId, hlsUrl });
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
    stopLiveIngest(parsed.data.deviceId);
    const session = await stopMonitorSession(parsed.data.deviceId);
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
    return reply.send({
      incidents: events.map(serializeIncident),
    });
  });
}
