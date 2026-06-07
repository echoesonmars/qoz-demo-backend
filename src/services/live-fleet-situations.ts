import { INCIDENT_CATEGORY_IDS, isIncidentCategoryId } from "../constants/incident-categories.js";
import {
  filterJournalIncidentsForCategory,
  journalSummaryRowsFromIncidents,
  listCompletedJournalIncidentsSince,
  serializeJournalSituationItem,
} from "./journal-incident-categories.js";
import { getDb } from "./db.js";
import { normalizeLiveIncidentType } from "./live-incident-normalize.js";
import { LIVE_RETENTION_DAYS } from "./live-retention.js";
import type { IncidentRow } from "../types/incidents.js";
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

export type FleetSituationLiveRow = FleetIncidentWithSession & {
  source: "live";
  sortAt: Date;
};

export type FleetSituationJournalRow = IncidentRow & {
  source: "journal";
  sortAt: Date;
};

export type FleetSituationMergedRow = FleetSituationLiveRow | FleetSituationJournalRow;

type SummaryRow = {
  category: string;
  capturedAt: Date;
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

function liveSummaryRows(
  rows: { incident_type: string; captured_at: Date }[],
): SummaryRow[] {
  const out: SummaryRow[] = [];
  for (const row of rows) {
    const category = normalizeLiveIncidentType(row.incident_type);
    if (!isIncidentCategoryId(category)) continue;
    out.push({ category, capturedAt: row.captured_at });
  }
  return out;
}

export function buildFleetCategoryStats(rows: SummaryRow[]): FleetCategoryStat[] {
  const buckets = new Map<string, { count: number; lastAt: Date | null }>();
  for (const category of INCIDENT_CATEGORY_IDS) {
    buckets.set(category, { count: 0, lastAt: null });
  }

  for (const row of rows) {
    if (!buckets.has(row.category)) continue;
    const bucket = buckets.get(row.category)!;
    bucket.count += 1;
    if (!bucket.lastAt || row.capturedAt >= bucket.lastAt) {
      bucket.lastAt = row.capturedAt;
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
  const [liveRows, journalRows] = await Promise.all([
    listFleetIncidentSummaryRows(since),
    listCompletedJournalIncidentsSince(since),
  ]);
  const merged = [
    ...liveSummaryRows(liveRows),
    ...journalSummaryRowsFromIncidents(journalRows),
  ];
  return {
    stats: buildFleetCategoryStats(merged),
    retentionDays: LIVE_RETENTION_DAYS,
    since: since.toISOString(),
  };
}

async function listAllLiveIncidentsForCategory(
  since: Date,
  category: string,
): Promise<FleetSituationLiveRow[]> {
  const batchSize = 500;
  let dbOffset = 0;
  const matched: FleetSituationLiveRow[] = [];

  while (true) {
    const sql = getDb();
    const batch = await sql<FleetIncidentWithSession[]>`
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
    if (batch.length === 0) break;

    for (const row of batch) {
      if (normalizeLiveIncidentType(row.incident_type) !== category) continue;
      matched.push({
        ...row,
        source: "live",
        sortAt: row.captured_at,
      });
    }

    dbOffset += batch.length;
    if (batch.length < batchSize) break;
  }

  return matched;
}

function listJournalRowsForCategory(
  rows: IncidentRow[],
  category: string,
): FleetSituationJournalRow[] {
  if (!isIncidentCategoryId(category)) return [];
  const filtered = filterJournalIncidentsForCategory(rows, category);
  return filtered.map((row) => {
    const createdAt =
      row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
    return {
      ...row,
      source: "journal",
      sortAt: createdAt,
    };
  });
}

export async function listFleetIncidentsForCategory(input: {
  since: Date;
  category: string;
  limit: number;
  offset: number;
}): Promise<{
  rows: FleetSituationMergedRow[];
  total: number;
  hasMore: boolean;
}> {
  const [liveRows, journalRows] = await Promise.all([
    listAllLiveIncidentsForCategory(input.since, input.category),
    listCompletedJournalIncidentsSince(input.since),
  ]);

  const merged = [...liveRows, ...listJournalRowsForCategory(journalRows, input.category)].sort(
    (a, b) => b.sortAt.getTime() - a.sortAt.getTime(),
  );

  const total = merged.length;
  const page = merged.slice(input.offset, input.offset + input.limit);
  const hasMore = input.offset + page.length < total;

  return {
    rows: page,
    total,
    hasMore,
  };
}

export { serializeJournalSituationItem };
