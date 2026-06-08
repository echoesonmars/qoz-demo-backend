import { getDb } from "./db.js";
import type { AnalyzeResult, IncidentCategoryHit, IncidentRow } from "../types/incidents.js";

function normalizeDetectedCategories(raw: unknown): IncidentCategoryHit[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: IncidentCategoryHit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.category !== "string") continue;
    if (typeof row.description !== "string") continue;
    const conf = Number(row.confidence);
    if (!Number.isFinite(conf)) continue;
    out.push({
      category: row.category as IncidentCategoryHit["category"],
      confidence: conf,
      description: row.description,
    });
  }
  return out;
}

function mapIncidentRow(row: IncidentRow): IncidentRow {
  return {
    ...row,
    confidence: row.confidence != null ? Number(row.confidence) : null,
    error_message: row.error_message ?? null,
    detected_categories: normalizeDetectedCategories(row.detected_categories),
  };
}

export async function getIncidentById(id: string): Promise<IncidentRow | null> {
  const sql = getDb();
  const [row] = await sql<IncidentRow[]>`
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
    where id = ${id}
    limit 1
  `;
  if (!row) return null;
  return mapIncidentRow(row);
}

export async function setIncidentAnalysisProcessing(id: string): Promise<void> {
  const sql = getDb();
  await sql`
    update public.incidents
    set
      analysis_status = 'processing',
      error_message = null
    where id = ${id}
  `;
}

export async function setIncidentAnalysisFailed(
  id: string,
  errorMessage: string,
): Promise<void> {
  const sql = getDb();
  await sql`
    update public.incidents
    set
      analysis_status = 'failed',
      error_message = ${errorMessage}
    where id = ${id}
  `;
}

export async function updateIncidentAnalysis(
  id: string,
  result: AnalyzeResult,
): Promise<IncidentRow> {
  const sql = getDb();
  const categoriesJson =
    result.categories && result.categories.length > 0 ? result.categories : [
    {
      category: result.category,
      confidence: result.confidence,
      description: result.description,
    },
  ];
  const [row] = await sql<IncidentRow[]>`
    update public.incidents
    set
      category = ${result.category},
      confidence = ${result.confidence},
      description = ${result.description},
      detected_categories = ${sql.json(categoriesJson)},
      analysis_status = 'completed',
      error_message = null
    where id = ${id}
    returning
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
  `;
  if (!row) {
    throw new Error("incident not found after update");
  }
  return mapIncidentRow(row);
}
