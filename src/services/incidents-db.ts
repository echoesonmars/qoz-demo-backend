import { getDb } from "./db.js";
import type { AnalyzeResult, IncidentRow } from "../types/incidents.js";

export async function getIncidentById(id: string): Promise<IncidentRow | null> {
  const sql = getDb();
  const [row] = await sql<IncidentRow[]>`
    select
      id,
      category,
      storage_path,
      title,
      camera_label,
      description,
      confidence,
      created_at
    from public.incidents
    where id = ${id}
    limit 1
  `;
  if (!row) return null;
  return {
    ...row,
    confidence: row.confidence != null ? Number(row.confidence) : null,
  };
}

export async function updateIncidentAnalysis(
  id: string,
  result: AnalyzeResult,
): Promise<IncidentRow> {
  const sql = getDb();
  const [row] = await sql<IncidentRow[]>`
    update public.incidents
    set
      category = ${result.category},
      confidence = ${result.confidence},
      description = ${result.description}
    where id = ${id}
    returning
      id,
      category,
      storage_path,
      title,
      camera_label,
      description,
      confidence,
      created_at
  `;
  if (!row) {
    throw new Error("incident not found after update");
  }
  return {
    ...row,
    confidence: row.confidence != null ? Number(row.confidence) : null,
  };
}
