import { INCIDENT_CATEGORY_IDS } from "../constants/incident-categories.js";
import { getDb } from "./db.js";
import { normalizeLiveIncidentType } from "./live-incident-normalize.js";
import { LIVE_RETENTION_DAYS } from "./live-retention.js";
import type { LiveIncidentEventRow } from "../types/live-analysis.js";

export type FleetCategoryStat = {
  category: string;
  count: number;
  lastAt: string | null;
  lastOffsetSec: null;
};

export type FleetIncidentWithSession = LiveIncidentEventRow & {
  session_status: string | null;
};

export async function listFleetIncidentSummaryRows(
  since: Date,
): Promise<{ incident_type: string; captured_at: Date }[]> {
  const sql = getDb();
  return sql<{ incident_type: string; captured_at: Date }[]>`
    select incident_type, captured_at
    from public.live_incident_events
    where captured_at >= ${since}
  `;
}

export function buildFleetCategoryStats(
  rows: { incident_type: string; captured_at: Date }[],
): FleetCategoryStat[] {
  const buckets = new Map<string, { count: number; lastAt: Date | null }>();
  for (const category of INCIDENT_CATEGORY_IDS) {
    buckets.set(category, { count: 0, lastAt: null });
  }

  for (const row of rows) {
    const category = normalizeLiveIncidentType(row.incident_type);
    if (!buckets.has(category)) continue;
    const bucket = buckets.get(category)!;
    bucket.count += 1;
    if (!bucket.lastAt || row.captured_at >= bucket.lastAt) {
      bucket.lastAt = row.captured_at;
    }
  }

  return INCIDENT_CATEGORY_IDS.map((category) => {
    const b = buckets.get(category)!;
    return {
      category,
      count: b.count,
      lastAt: b.lastAt?.toISOString() ?? null,
      lastOffsetSec: null,
    };
  });
}

export async function getFleetSituationSummary(since: Date): Promise<{
  stats: FleetCategoryStat[];
  retentionDays: number;
  since: string;
}> {
  const rows = await listFleetIncidentSummaryRows(since);
  return {
    stats: buildFleetCategoryStats(rows),
    retentionDays: LIVE_RETENTION_DAYS,
    since: since.toISOString(),
  };
}

async function fetchFleetIncidentBatch(
  since: Date,
  dbOffset: number,
  batchSize: number,
): Promise<FleetIncidentWithSession[]> {
  const sql = getDb();
  const rows = await sql<FleetIncidentWithSession[]>`
    select
      e.*,
      s.status as session_status
    from public.live_incident_events e
    left join public.live_monitor_sessions s on s.id = e.session_id
    where e.captured_at >= ${since}
    order by e.captured_at desc
    limit ${batchSize}
    offset ${dbOffset}
  `;
  return rows;
}

export async function listFleetIncidentsForCategory(input: {
  since: Date;
  category: string;
  limit: number;
  offset: number;
}): Promise<{
  rows: FleetIncidentWithSession[];
  hasMore: boolean;
}> {
  const batchSize = 250;
  let dbOffset = 0;
  let skipped = 0;
  const matched: FleetIncidentWithSession[] = [];
  let hasMore = false;

  while (matched.length < input.limit + 1) {
    const batch = await fetchFleetIncidentBatch(input.since, dbOffset, batchSize);
    if (batch.length === 0) break;

    for (const row of batch) {
      if (normalizeLiveIncidentType(row.incident_type) !== input.category) continue;
      if (skipped < input.offset) {
        skipped += 1;
        continue;
      }
      matched.push(row);
      if (matched.length > input.limit) {
        hasMore = true;
        break;
      }
    }

    if (hasMore) break;
    dbOffset += batch.length;
    if (batch.length < batchSize) break;
  }

  return {
    rows: matched.slice(0, input.limit),
    hasMore,
  };
}
