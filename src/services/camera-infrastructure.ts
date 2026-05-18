import { getDb } from "./db.js";

export type CameraInfrastructureRow = {
  device_id: string;
  status: string;
  frame_count: number;
  last_frame_at: Date | null;
  started_at: Date;
};

const RECENT_MS = 15 * 60 * 1000;

export async function listCameraInfrastructureStatus(): Promise<CameraInfrastructureRow[]> {
  const sql = getDb();
  return sql<CameraInfrastructureRow[]>`
    select distinct on (device_id)
      device_id,
      status,
      frame_count,
      last_frame_at,
      started_at
    from public.live_monitor_sessions
    order by device_id, started_at desc
  `;
}

export function isDeviceOnline(row: CameraInfrastructureRow | undefined): boolean {
  if (!row) return false;
  if (row.status === "running") return true;
  if (row.frame_count <= 0 || !row.last_frame_at) return false;
  return Date.now() - new Date(row.last_frame_at).getTime() < RECENT_MS;
}

export function telemetryFromRow(row: CameraInfrastructureRow | undefined): number {
  if (!row || !isDeviceOnline(row)) return 0;
  if (row.status === "running") {
    const age = row.last_frame_at
      ? Date.now() - new Date(row.last_frame_at).getTime()
      : 60_000;
    if (age < 15_000) return Math.min(100, 40 + Math.round(row.frame_count * 2));
    return Math.min(100, Math.max(12, Math.round(row.frame_count)));
  }
  return Math.min(60, Math.round(row.frame_count));
}
