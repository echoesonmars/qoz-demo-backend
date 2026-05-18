import { getDb } from "./db.js";
import type {
  LiveAnalysisPayload,
  LiveDetectedIncident,
  LiveIncidentEventRow,
  LiveMonitorSessionRow,
  LiveSnapshotRow,
} from "../types/live-analysis.js";

const ZOMBIE_MESSAGE = "Сессия прервана: перезапуск сервера";

export async function reconcileZombieSessionsOnBoot(): Promise<number> {
  const sql = getDb();
  const rows = await sql<{ count: string }[]>`
    with updated as (
      update public.live_monitor_sessions
      set
        status = 'stopped',
        stopped_at = now(),
        error_message = ${ZOMBIE_MESSAGE}
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

export async function insertLiveSnapshot(input: {
  sessionId: string;
  deviceId: string;
  payload: LiveAnalysisPayload;
  sessionOffsetSec: number;
}): Promise<LiveSnapshotRow> {
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
    await insertIncidentEvents({
      snapshotId: snapshot.id,
      sessionId: input.sessionId,
      deviceId: input.deviceId,
      capturedAt: snapshot.captured_at,
      incidents: input.payload.detected_incidents,
    });
  }
  return snapshot;
}

async function insertIncidentEvents(input: {
  snapshotId: string;
  sessionId: string;
  deviceId: string;
  capturedAt: Date;
  incidents: LiveDetectedIncident[];
}): Promise<void> {
  const sql = getDb();
  for (const inc of input.incidents) {
    await sql`
      insert into public.live_incident_events (
        snapshot_id,
        session_id,
        device_id,
        captured_at,
        incident_type,
        confidence,
        location_context,
        description,
        timestamp_marker
      )
      values (
        ${input.snapshotId},
        ${input.sessionId},
        ${input.deviceId},
        ${input.capturedAt},
        ${inc.type},
        ${inc.confidence},
        ${inc.location_context ?? ""},
        ${inc.description},
        ${inc.timestamp_marker ?? "frame_static"}
      )
    `;
  }
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
  return sql<LiveIncidentEventRow[]>`
    select *
    from public.live_incident_events
    where device_id = ${deviceId}
    order by captured_at desc
    limit ${limit}
  `;
}

export async function listRunningSessions(): Promise<LiveMonitorSessionRow[]> {
  const sql = getDb();
  return sql<LiveMonitorSessionRow[]>`
    select * from public.live_monitor_sessions where status = 'running'
  `;
}

export { ZOMBIE_MESSAGE };
