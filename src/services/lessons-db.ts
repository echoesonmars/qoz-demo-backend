import { getDb } from "./db.js";
import type { LessonAnalysisReport, LessonRow } from "../types/lessons.js";

export async function getLessonById(id: string): Promise<LessonRow | null> {
  const sql = getDb();
  const [row] = await sql<LessonRow[]>`
    select
      id,
      status,
      storage_path,
      title,
      detected_language,
      analysis,
      error_message,
      created_at
    from public.lesson_analyses
    where id = ${id}
    limit 1
  `;
  if (!row) return null;
  return {
    ...row,
    analysis: row.analysis as LessonAnalysisReport | null,
  };
}

export async function updateLessonAnalysis(
  id: string,
  report: LessonAnalysisReport,
): Promise<LessonRow> {
  const sql = getDb();
  const [row] = await sql<LessonRow[]>`
    update public.lesson_analyses
    set
      status = 'ready',
      detected_language = ${report.detected_language},
      analysis = ${sql.json(report)},
      error_message = null
    where id = ${id}
    returning
      id,
      status,
      storage_path,
      title,
      detected_language,
      analysis,
      error_message,
      created_at
  `;
  if (!row) {
    throw new Error("lesson not found after update");
  }
  return {
    ...row,
    analysis: row.analysis as LessonAnalysisReport | null,
  };
}

export async function markLessonFailed(id: string, message: string): Promise<void> {
  const sql = getDb();
  await sql`
    update public.lesson_analyses
    set status = 'failed', error_message = ${message.slice(0, 2000)}
    where id = ${id}
  `;
}

export async function resetLessonPending(id: string): Promise<void> {
  const sql = getDb();
  await sql`
    update public.lesson_analyses
    set status = 'pending', error_message = null
    where id = ${id}
  `;
}
