import type { LiveIncidentEventRow } from "../types/live-analysis.js";

const DEDUP_WINDOW_SEC = Number.parseInt(
  process.env.LIVE_INCIDENT_DEDUP_SEC ?? "30",
  10,
) || 30;

export function dedupeIncidentRows(
  rows: LiveIncidentEventRow[],
): LiveIncidentEventRow[] {
  const sorted = [...rows].sort(
    (a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime(),
  );
  const kept: LiveIncidentEventRow[] = [];
  for (const row of sorted) {
    const t = new Date(row.captured_at).getTime();
    const dup = kept.some((k) => {
      if (k.incident_type !== row.incident_type) return false;
      return Math.abs(new Date(k.captured_at).getTime() - t) <= DEDUP_WINDOW_SEC * 1000;
    });
    if (!dup) kept.push(row);
  }
  return kept.sort(
    (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime(),
  );
}
