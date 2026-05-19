import type { FastifyBaseLogger } from "fastify";
import { getDb } from "./db.js";

export const LIVE_RETENTION_DAYS = Math.max(
  1,
  Number.parseInt(process.env.LIVE_RETENTION_DAYS ?? "30", 10) || 30,
);

export function getLiveRetentionCutoff(sinceIso?: string | null): Date {
  if (sinceIso) {
    const parsed = Date.parse(sinceIso);
    if (Number.isFinite(parsed)) return new Date(parsed);
  }
  return new Date(Date.now() - LIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export async function pruneOldLiveData(): Promise<{
  snapshots: number;
  incidents: number;
  sessions: number;
}> {
  const sql = getDb();
  const cutoff = getLiveRetentionCutoff();
  const inc = await sql<{ count: string }[]>`
    with deleted as (
      delete from public.live_incident_events
      where captured_at < ${cutoff}
      returning 1
    )
    select count(*)::text as count from deleted
  `;
  const snap = await sql<{ count: string }[]>`
    with deleted as (
      delete from public.live_analysis_snapshots
      where captured_at < ${cutoff}
      returning 1
    )
    select count(*)::text as count from deleted
  `;
  const sess = await sql<{ count: string }[]>`
    with deleted as (
      delete from public.live_monitor_sessions
      where started_at < ${cutoff}
        and status in ('stopped', 'error')
        and recording_upload_status is distinct from 'uploading'
      returning 1
    )
    select count(*)::text as count from deleted
  `;
  return {
    incidents: Number(inc[0]?.count ?? 0),
    snapshots: Number(snap[0]?.count ?? 0),
    sessions: Number(sess[0]?.count ?? 0),
  };
}

const CRON_HOURS = Math.max(
  1,
  Number.parseInt(process.env.LIVE_RETENTION_CRON_HOURS ?? "24", 10) || 24,
);

export function startRetentionScheduler(log: FastifyBaseLogger): void {
  const run = () => {
    void pruneOldLiveData()
      .then((r) => log.info({ ...r, retentionDays: LIVE_RETENTION_DAYS }, "live retention pruned"))
      .catch((err) => log.warn({ err }, "live retention prune failed"));
  };
  run();
  setInterval(run, CRON_HOURS * 60 * 60 * 1000);
}
