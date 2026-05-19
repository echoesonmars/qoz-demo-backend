import { getDb } from "./db.js";
import type { LessonAnalysisReport, LessonRow } from "../types/lessons.js";

export async function getLessonById(id: string): Promise<LessonRow | null> {
  const sql = getDb();
  const [row] = await sql<(LessonRow & { source_live_session_id: string | null })[]>`
    select
      id,
      status,
      storage_path,
      title,
      detected_language,
      analysis,
      error_message,
      created_at,
      source_live_session_id
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

export async function repairLiveArchiveLesson(
  id: string,
  title: string,
): Promise<void> {
  const sql = getDb();
  await sql`
    update public.lesson_analyses
    set
      status = 'ready',
      error_message = null,
      title = ${title}
    where id = ${id}
      and source_live_session_id is not null
  `;
}

export async function insertLesson(input: {
  storage_path: string;
  title?: string | null;
  source_live_session_id?: string | null;
  status?: "pending" | "ready";
}): Promise<LessonRow> {
  const sql = getDb();
  const status = input.status ?? "pending";
  const [row] = await sql<LessonRow[]>`
    insert into public.lesson_analyses (
      status,
      storage_path,
      title,
      source_live_session_id,
      error_message
    )
    values (
      ${status},
      ${input.storage_path},
      ${input.title ?? null},
      ${input.source_live_session_id ?? null},
      null
    )
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
    throw new Error("insert lesson failed");
  }
  return {
    ...row,
    analysis: row.analysis as LessonAnalysisReport | null,
  };
}
