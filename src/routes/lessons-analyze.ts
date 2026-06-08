import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { analyzeLessonPipeline } from "../services/analyze-lesson-pipeline.js";
import { analyzeLessonVideo } from "../services/gemini-lesson-analyze.js";
import {
  getLessonById,
  markLessonFailed,
  setLessonProcessing,
  updateLessonAnalysis,
} from "../services/lessons-db.js";
import { presignIncidentVideo } from "../services/storage.js";

const bodySchema = z.object({
  lessonId: z.string().uuid(),
});

const activeJobs = new Map<string, AbortController>();

function userFacingAnalyzeError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return "Ошибка анализа урока";
}

export async function runAnalysis(lessonId: string, log: FastifyBaseLogger): Promise<void> {
  const lesson = await getLessonById(lessonId);
  if (!lesson) {
    log.warn({ lessonId }, "lesson analyze skipped: not found");
    return;
  }
  if (lesson.source_live_session_id) {
    log.info({ lessonId }, "lesson analyze skipped: live archive");
    return;
  }
  if (lesson.status === "ready") {
    log.info({ lessonId, status: lesson.status }, "lesson analyze skipped: already ready");
    return;
  }

  const env = getEnv();
  const mode = env.LESSON_ANALYZE_MODE;
  const abort = new AbortController();
  activeJobs.set(lessonId, abort);

  try {
    await setLessonProcessing(lessonId);
    const videoUrl = await presignIncidentVideo(lesson.storage_path, 3600);
    log.info({ lessonId, mode }, "lesson analyze started");

    let analysis;
    if (mode === "gemini") {
      if (!env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is required for LESSON_ANALYZE_MODE=gemini");
      }
      analysis = await analyzeLessonVideo(videoUrl);
    } else {
      analysis = await analyzeLessonPipeline(videoUrl, abort.signal, { lessonId, log });
    }

    if (abort.signal.aborted) {
      return;
    }

    await updateLessonAnalysis(lessonId, analysis);
    log.info(
      { lessonId, language: analysis.detected_language, mode },
      "lesson analyze completed",
    );
  } catch (e) {
    if (abort.signal.aborted) {
      log.info({ lessonId }, "lesson analyze cancelled");
      return;
    }
    const message = userFacingAnalyzeError(e);
    await markLessonFailed(lessonId, message).catch(() => {});
    log.error({ err: e, lessonId, message }, "lesson analyze failed");
  } finally {
    activeJobs.delete(lessonId);
  }
}

export async function lessonsAnalyzeRoutes(app: FastifyInstance) {
  app.post("/api/lessons/analyze", async (request, reply) => {
    const secret = request.headers["x-backend-secret"];
    if (secret !== getEnv().BACKEND_INTERNAL_SECRET) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const { lessonId } = parsed.data;
    const lesson = await getLessonById(lessonId);
    if (!lesson) {
      return reply.code(404).send({ error: "Lesson not found" });
    }
    if (lesson.source_live_session_id) {
      return reply.send({ status: "ok", lesson, skipped: "live_archive" });
    }
    if (lesson.status === "ready") {
      return reply.send({ status: "ok", lesson });
    }
    if (activeJobs.has(lessonId)) {
      return reply.code(202).send({ status: "already_processing", lessonId });
    }
    if (lesson.status !== "pending") {
      return reply.send({ status: "ok", lesson });
    }

    void runAnalysis(lessonId, request.log);

    return reply.code(202).send({ status: "processing", lessonId });
  });

  app.post("/api/lessons/analyze/cancel", async (request, reply) => {
    const secret = request.headers["x-backend-secret"];
    if (secret !== getEnv().BACKEND_INTERNAL_SECRET) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const { lessonId } = parsed.data;
    const job = activeJobs.get(lessonId);
    if (job) {
      job.abort();
      activeJobs.delete(lessonId);
    }
    await markLessonFailed(lessonId, "Анализ остановлен");
    return reply.send({ status: "cancelled", lessonId });
  });
}
