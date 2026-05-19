import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { insertLesson, repairLiveArchiveLesson } from "./lessons-db.js";
import { getSessionById } from "./live-monitor-db.js";
import { buildLiveArchiveLessonTitle } from "./live-archive-title.js";
import { copyStorageObject } from "./storage.js";
import { getDb } from "./db.js";

export function autoExportLessonOnStop(): boolean {
  const raw = process.env.LIVE_AUTO_EXPORT_LESSON?.trim().toLowerCase();
  if (raw === "false" || raw === "0") return false;
  return true;
}

export async function getLessonIdByLiveSession(
  sessionId: string,
): Promise<string | null> {
  const sql = getDb();
  const rows = await sql<{ id: string }[]>`
    select id from public.lesson_analyses
    where source_live_session_id = ${sessionId}
    order by created_at desc
    limit 1
  `;
  return rows[0]?.id ?? null;
}

function resolveArchiveTitle(
  session: NonNullable<Awaited<ReturnType<typeof getSessionById>>>,
  options?: { title?: string | null },
): string {
  const custom = options?.title?.trim();
  if (custom) return custom;
  return buildLiveArchiveLessonTitle(
    session.device_id,
    session.started_at,
    session.camera_id,
  );
}

export async function exportLiveSessionToLesson(
  sessionId: string,
  log: FastifyBaseLogger,
  options?: { title?: string | null },
): Promise<{ lessonId: string; created: boolean }> {
  const session = await getSessionById(sessionId);
  if (!session?.recording_storage_path || session.recording_upload_status !== "ready") {
    throw new Error("Запись сессии ещё не готова");
  }

  const title = resolveArchiveTitle(session, options);
  const existing = await getLessonIdByLiveSession(sessionId);
  if (existing) {
    await repairLiveArchiveLesson(existing, title);
    return { lessonId: existing, created: false };
  }

  const lessonPath = `lessons/${randomUUID()}.mp4`;
  await copyStorageObject(session.recording_storage_path, lessonPath);
  const lesson = await insertLesson({
    storage_path: lessonPath,
    title,
    source_live_session_id: sessionId,
    status: "ready",
  });
  log.info({ sessionId, lessonId: lesson.id }, "live session archived (no gemini re-analyze)");
  return { lessonId: lesson.id, created: true };
}
