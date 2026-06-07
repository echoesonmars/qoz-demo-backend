import {
  INCIDENT_CATEGORY_IDS,
  type IncidentCategoryId,
  isIncidentCategoryId,
} from "../constants/incident-categories.js";
import { getDb } from "./db.js";
import type { IncidentCategoryHit, IncidentRow } from "../types/incidents.js";

function normalizeDetectedCategories(raw: unknown): IncidentCategoryHit[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: IncidentCategoryHit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.category !== "string") continue;
    if (!isIncidentCategoryId(row.category)) continue;
    if (typeof row.description !== "string") continue;
    const conf = Number(row.confidence);
    if (!Number.isFinite(conf)) continue;
    out.push({
      category: row.category,
      confidence: conf,
      description: row.description,
    });
  }
  return out;
}

function mapJournalRow(row: IncidentRow): IncidentRow {
  return {
    ...row,
    confidence: row.confidence != null ? Number(row.confidence) : null,
    error_message: row.error_message ?? null,
    detected_categories: normalizeDetectedCategories(row.detected_categories),
  };
}

export function expandJournalCategories(row: IncidentRow): IncidentCategoryId[] {
  if (row.detected_categories && row.detected_categories.length > 0) {
    const seen = new Set<IncidentCategoryId>();
    for (const hit of row.detected_categories) {
      if (isIncidentCategoryId(hit.category)) {
        seen.add(hit.category);
      }
    }
    return [...seen];
  }
  if (row.category === "pending" || row.category === "intruder") {
    return [];
  }
  if (isIncidentCategoryId(row.category)) {
    return [row.category];
  }
  return [];
}

export function journalIncidentMatchesCategory(
  row: IncidentRow,
  category: IncidentCategoryId,
): boolean {
  return expandJournalCategories(row).includes(category);
}

export function journalSummaryRowsFromIncidents(
  rows: IncidentRow[],
): { category: IncidentCategoryId; capturedAt: Date }[] {
  const out: { category: IncidentCategoryId; capturedAt: Date }[] = [];
  for (const row of rows) {
    const createdAt =
      row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
    for (const category of expandJournalCategories(row)) {
      out.push({ category, capturedAt: createdAt });
    }
  }
  return out;
}

export async function listCompletedJournalIncidentsSince(
  since: Date,
): Promise<IncidentRow[]> {
  const sql = getDb();
  const rows = await sql<IncidentRow[]>`
    select
      id,
      category,
      analysis_status,
      error_message,
      storage_path,
      title,
      camera_label,
      description,
      confidence,
      detected_categories,
      created_at
    from public.incidents
    where analysis_status = 'completed'
      and category != 'pending'
      and created_at >= ${since}
    order by created_at desc
  `;
  return rows.map(mapJournalRow);
}

export function filterJournalIncidentsForCategory(
  rows: IncidentRow[],
  category: IncidentCategoryId,
): IncidentRow[] {
  return rows.filter((row) => journalIncidentMatchesCategory(row, category));
}

export function serializeJournalSituationItem(
  row: IncidentRow,
  category: IncidentCategoryId,
): {
  source: "journal";
  incidentId: string;
  category: IncidentCategoryId;
  title: string | null;
  cameraLabel: string | null;
  description: string | null;
  confidence: number | null;
  createdAt: string;
  storagePath: string;
} {
  const hits = row.detected_categories ?? [];
  const hit = hits.find((h) => h.category === category);
  const createdAt =
    row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return {
    source: "journal",
    incidentId: row.id,
    category,
    title: row.title,
    cameraLabel: row.camera_label,
    description: hit?.description ?? row.description,
    confidence: hit?.confidence ?? row.confidence,
    createdAt: createdAt.toISOString(),
    storagePath: row.storage_path,
  };
}

export { INCIDENT_CATEGORY_IDS };
