import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { dedupeIncidentRows } from "./live-incident-dedup.js";
import { assertJpegWithinLimit, assertPayloadWithinLimit } from "./live-upload-limits.js";
import { uploadStorageObject } from "./storage.js";
import type {
  LiveAnalysisPayload,
  LiveDetectedIncident,
  LiveIncidentEventRow,
  LiveMonitorSessionRow,
  LiveSnapshotRow,
} from "../types/live-analysis.js";

const ZOMBIE_MESSAGE = "Сессия прервана: перезапуск сервера";

export async function setMonitorSessionZombieOnBoot(sessionId: string): Promise<void> {
  const sql = getDb();
  await sql`
    update public.live_monitor_sessions
    set
      status = 'stopped',
      stopped_at = now(),
      error_message = ${ZOMBIE_MESSAGE},
      recording_upload_status = case
        when recording_upload_status = 'uploading' then 'failed'
        else recording_upload_status
      end
    where id = ${sessionId} and status = 'running'
  `;
}

export async function reconcileZombieSessionsOnBoot(): Promise<number> {
  const sql = getDb();
  const rows = await sql<{ count: string }[]>`
    with updated as (
      update public.live_monitor_sessions
      set
        status = 'stopped',
        stopped_at = now(),
        error_message = ${ZOMBIE_MESSAGE},
        recording_upload_status = case
          when recording_upload_status = 'uploading' then 'failed'
          else recording_upload_status
        end
      where status = 'running'
      returning 1
    )
    select count(*)::text as count from updated
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function getRunningSession(
  deviceId: string,
): Promise<LiveMonitorSessionRow | null> {
  const sql = getDb();
  const rows = await sql<LiveMonitorSessionRow[]>`
    select *
    from public.live_monitor_sessions
    where device_id = ${deviceId} and status = 'running'
    order by started_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getSessionById(
  sessionId: string,
): Promise<LiveMonitorSessionRow | null> {
  const sql = getDb();
  const rows = await sql<LiveMonitorSessionRow[]>`
    select * from public.live_monitor_sessions where id = ${sessionId} limit 1
  `;
  return rows[0] ?? null;
}

export async function getLatestSession(
  deviceId: string,
): Promise<LiveMonitorSessionRow | null> {
  const sql = getDb();
  const rows = await sql<LiveMonitorSessionRow[]>`
    select *
    from public.live_monitor_sessions
    where device_id = ${deviceId}
    order by started_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function listDeviceSessions(
  deviceId: string,
  limit = 20,
): Promise<LiveMonitorSessionRow[]> {
  const sql = getDb();
  return sql<LiveMonitorSessionRow[]>`
    select *
    from public.live_monitor_sessions
    where device_id = ${deviceId}
    order by started_at desc
    limit ${limit}
  `;
}

export async function createMonitorSession(input: {
  deviceId: string;
  cameraId: string;
  hlsUrl: string;
}): Promise<LiveMonitorSessionRow> {
  const sql = getDb();
  await sql`
    update public.live_monitor_sessions
    set status = 'stopped', stopped_at = now(), error_message = 'Заменена новой сессией'
    where device_id = ${input.deviceId} and status = 'running'
  `;
  const rows = await sql<LiveMonitorSessionRow[]>`
    insert into public.live_monitor_sessions (device_id, camera_id, hls_url, status)
    values (${input.deviceId}, ${input.cameraId}, ${input.hlsUrl}, 'running')
    returning *
  `;
  return rows[0]!;
}

export async function stopMonitorSession(
  deviceId: string,
  message?: string,
): Promise<LiveMonitorSessionRow | null> {
  const sql = getDb();
  const rows = await sql<LiveMonitorSessionRow[]>`
    update public.live_monitor_sessions
    set
      status = 'stopped',
      stopped_at = now(),
      error_message = coalesce(${message ?? null}, error_message)
    where device_id = ${deviceId} and status = 'running'
    returning *
  `;
  return rows[0] ?? null;
}

export async function updateSessionRecording(input: {
  sessionId: string;
  storagePath: string | null;
  durationSec: number | null;
  bytes: number | null;
  uploadStatus: "pending" | "uploading" | "ready" | "failed" | null;
  errorMessage?: string | null;
}): Promise<void> {
  const sql = getDb();
  await sql`
    update public.live_monitor_sessions
    set
      recording_storage_path = coalesce(${input.storagePath}, recording_storage_path),
      recording_duration_sec = coalesce(${input.durationSec}, recording_duration_sec),
      recording_bytes = coalesce(${input.bytes}, recording_bytes),
      recording_upload_status = coalesce(${input.uploadStatus}, recording_upload_status),
      recording_uploaded_at = case
        when ${input.uploadStatus} = 'ready' then now()
        else recording_uploaded_at
      end,
      error_message = coalesce(${input.errorMessage ?? null}, error_message)
    where id = ${input.sessionId}
  `;
}

export async function setMonitorSessionError(
  sessionId: string,
  errorMessage: string,
): Promise<void> {
  const sql = getDb();
  await sql`
    update public.live_monitor_sessions
    set status = 'error', stopped_at = now(), error_message = ${errorMessage}
    where id = ${sessionId} and status = 'running'
  `;
}

export async function touchMonitorSessionFrame(sessionId: string): Promise<void> {
  const sql = getDb();
  await sql`
    update public.live_monitor_sessions
    set
      frame_count = frame_count + 1,
      last_frame_at = now()
    where id = ${sessionId}
  `;
}

type PreparedIncident = LiveDetectedIncident & {
  id: string;
  evidence_storage_path: string | null;
};

async function prepareIncidentsWithEvidence(
  sessionId: string,
  incidents: LiveDetectedIncident[],
  frameJpeg: Buffer | null,
  uploadEvidence: boolean,
): Promise<PreparedIncident[]> {
  const out: PreparedIncident[] = [];
  for (const inc of incidents) {
    const id = randomUUID();
    let evidence_storage_path: string | null = null;
    const jpeg = assertJpegWithinLimit(frameJpeg);
    if (uploadEvidence && jpeg && jpeg.length > 0) {
      evidence_storage_path = `live-evidence/${sessionId}/${id}.jpg`;
      await uploadStorageObject(evidence_storage_path, jpeg, "image/jpeg");
    }
    out.push({ id, ...inc, evidence_storage_path });
  }
  return out;
}

async function insertIncidentEventsBatch(input: {
  snapshotId: string;
  sessionId: string;
  deviceId: string;
  capturedAt: Date;
  incidents: PreparedIncident[];
}): Promise<void> {
  if (input.incidents.length === 0) return;
  const sql = getDb();
  const rows = input.incidents.map((inc) => ({
    id: inc.id,
    snapshot_id: input.snapshotId,
    session_id: input.sessionId,
    device_id: input.deviceId,
    captured_at: input.capturedAt,
    incident_type: inc.type,
    confidence: inc.confidence,
    location_context: inc.location_context ?? "",
    description: inc.description,
    timestamp_marker: inc.timestamp_marker ?? "frame_static",
    evidence_storage_path: inc.evidence_storage_path,
  }));
  await sql`
    insert into public.live_incident_events ${sql(rows, "id", "snapshot_id", "session_id", "device_id", "captured_at", "incident_type", "confidence", "location_context", "description", "timestamp_marker", "evidence_storage_path")}
  `;
}

export async function insertLiveSnapshot(input: {
  sessionId: string;
  deviceId: string;
  payload: LiveAnalysisPayload;
  sessionOffsetSec: number;
  frameJpeg?: Buffer | null;
  uploadEvidence?: boolean;
}): Promise<LiveSnapshotRow> {
  assertPayloadWithinLimit(input.payload);
  const sql = getDb();
  const score = input.payload.analytics_meta.overall_engagement_score;
  const incidentCount = input.payload.detected_incidents.length;
  const rows = await sql<LiveSnapshotRow[]>`
    insert into public.live_analysis_snapshots (
      session_id,
      device_id,
      payload,
      engagement_score,
      incident_count,
      session_offset_sec
    )
    values (
      ${input.sessionId},
      ${input.deviceId},
      ${sql.json(input.payload)},
      ${score},
      ${incidentCount},
      ${input.sessionOffsetSec}
    )
    returning *
  `;
  const snapshot = rows[0]!;
  if (input.payload.detected_incidents.length > 0) {
    const prepared = await prepareIncidentsWithEvidence(
      input.sessionId,
      input.payload.detected_incidents,
      input.frameJpeg ?? null,
      input.uploadEvidence ?? false,
    );
    await insertIncidentEventsBatch({
      snapshotId: snapshot.id,
      sessionId: input.sessionId,
      deviceId: input.deviceId,
      capturedAt: snapshot.captured_at,
      incidents: prepared,
    });
  }
  return snapshot;
}

export async function getSnapshotsForSession(
  sessionId: string,
  limit: number,
): Promise<LiveSnapshotRow[]> {
  const sql = getDb();
  return sql<LiveSnapshotRow[]>`
    select *
    from public.live_analysis_snapshots
    where session_id = ${sessionId}
    order by captured_at desc
    limit ${limit}
  `;
}

export async function getIncidentsForSession(
  sessionId: string,
  limit: number,
): Promise<LiveIncidentEventRow[]> {
  const sql = getDb();
  const rows = await sql<LiveIncidentEventRow[]>`
    select *
    from public.live_incident_events
    where session_id = ${sessionId}
    order by captured_at desc
    limit ${limit}
  `;
  return dedupeIncidentRows(rows);
}

export async function getLiveFeed(
  deviceId: string,
  limit: number,
): Promise<LiveSnapshotRow[]> {
  const sql = getDb();
  return sql<LiveSnapshotRow[]>`
    select *
    from public.live_analysis_snapshots
    where device_id = ${deviceId}
    order by captured_at desc
    limit ${limit}
  `;
}

export async function getLatestLiveSnapshot(
  deviceId: string,
): Promise<LiveSnapshotRow | null> {
  const sql = getDb();
  const rows = await sql<LiveSnapshotRow[]>`
    select *
    from public.live_analysis_snapshots
    where device_id = ${deviceId}
    order by captured_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getLiveIncidentEvents(
  deviceId: string,
  limit: number,
): Promise<LiveIncidentEventRow[]> {
  const sql = getDb();
  const rows = await sql<LiveIncidentEventRow[]>`
    select *
    from public.live_incident_events
    where device_id = ${deviceId}
    order by captured_at desc
    limit ${limit}
  `;
  return dedupeIncidentRows(rows);
}

export async function getLiveDashboard(input: {
  deviceId: string;
  sessionId?: string | null;
  snapshotLimit?: number;
  incidentLimit?: number;
}): Promise<{
  session: LiveMonitorSessionRow | null;
  isMonitoring: boolean;
  snapshots: LiveSnapshotRow[];
  incidents: LiveIncidentEventRow[];
}> {
  const { recordDashboardQuery } = await import("./live-metrics.js");
  const t0 = Date.now();
  const snapshotLimit = input.snapshotLimit ?? 50;
  const incidentLimit = input.incidentLimit ?? 50;
  let session: LiveMonitorSessionRow | null = null;
  if (input.sessionId) {
    session = await getSessionById(input.sessionId);
  } else {
    session = (await getRunningSession(input.deviceId)) ?? (await getLatestSession(input.deviceId));
  }
  if (!session) {
    return { session: null, isMonitoring: false, snapshots: [], incidents: [] };
  }
  const isMonitoring = session.status === "running";
  const [snapshots, incidents] = await Promise.all([
    getSnapshotsForSession(session.id, snapshotLimit),
    getIncidentsForSession(session.id, incidentLimit),
  ]);
  recordDashboardQuery(Date.now() - t0, input.deviceId);
  return { session, isMonitoring, snapshots, incidents };
}

export async function listRunningSessions(): Promise<LiveMonitorSessionRow[]> {
  const sql = getDb();
  return sql<LiveMonitorSessionRow[]>`
    select * from public.live_monitor_sessions where status = 'running'
  `;
}

export { ZOMBIE_MESSAGE };
