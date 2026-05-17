import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { analyzeLessonVideo } from "../services/gemini-lesson-analyze.js";
import {
  getLessonById,
  markLessonFailed,
  updateLessonAnalysis,
} from "../services/lessons-db.js";
import { presignIncidentVideo } from "../services/storage.js";

const bodySchema = z.object({
  lessonId: z.string().uuid(),
});

async function runAnalysis(lessonId: string, log: FastifyBaseLogger): Promise<void> {
  const lesson = await getLessonById(lessonId);
  if (!lesson) {
    log.warn({ lessonId }, "lesson analyze skipped: not found");
    return;
  }
  if (lesson.status !== "pending") {
    log.info({ lessonId, status: lesson.status }, "lesson analyze skipped: not pending");
    return;
  }
  try {
    const videoUrl = await presignIncidentVideo(lesson.storage_path, 3600);
    log.info({ lessonId }, "lesson analyze started");
    const analysis = await analyzeLessonVideo(videoUrl);
    await updateLessonAnalysis(lessonId, analysis);
    log.info(
      { lessonId, language: analysis.detected_language },
      "lesson analyze completed",
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Lesson analysis failed";
    log.error({ err: e, lessonId }, "lesson analyze failed");
    await markLessonFailed(lessonId, message);
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
    if (lesson.status !== "pending") {
      return reply.send({ status: "ok", lesson });
    }

    void runAnalysis(lessonId, request.log);

    return reply.code(202).send({ status: "processing", lessonId });
  });
}
