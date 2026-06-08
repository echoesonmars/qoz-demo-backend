import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { analyzeIncidentVideoWithVision } from "../services/analyze-incident-vision.js";
import { analyzeIncidentVideo } from "../services/gemini-analyze.js";
import {
  getIncidentById,
  setIncidentAnalysisFailed,
  setIncidentAnalysisProcessing,
  updateIncidentAnalysis,
} from "../services/incidents-db.js";
import { presignIncidentVideo } from "../services/storage.js";
import type { AnalyzeResult } from "../types/incidents.js";

const bodySchema = z.object({
  incidentId: z.string().uuid(),
});

const activeJobs = new Map<string, AbortController>();

function userFacingAnalyzeError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return "Ошибка анализа видео";
}

async function runAnalysis(incidentId: string, log: FastifyBaseLogger): Promise<void> {
  const incident = await getIncidentById(incidentId);
  if (!incident) {
    log.warn({ incidentId }, "analyze skipped: incident not found");
    return;
  }
  if (incident.category !== "pending") {
    log.info({ incidentId, category: incident.category }, "analyze skipped: already processed");
    return;
  }

  const env = getEnv();
  const mode = env.INCIDENT_ANALYZE_MODE;
  const abort = new AbortController();
  activeJobs.set(incidentId, abort);

  try {
    await setIncidentAnalysisProcessing(incidentId);
    const videoUrl = await presignIncidentVideo(incident.storage_path, 3600);
    log.info({ incidentId, mode }, "incident analyze started");

    let analysis: AnalyzeResult;
    let analysisSource: "vision" | "gemini";

    if (mode === "gemini") {
      if (!env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is required for INCIDENT_ANALYZE_MODE=gemini");
      }
      analysis = await analyzeIncidentVideo(videoUrl);
      analysisSource = "gemini";
    } else {
      const { result, meta } = await analyzeIncidentVideoWithVision(
        videoUrl,
        log,
        incidentId,
        abort.signal,
      );
      if (!result) {
        throw new Error(
          meta.emptyReason ?? "Категория инцидента не определена после агрегации кадров",
        );
      }
      analysis = result;
      analysisSource = "vision";
      log.info(
        {
          incidentId,
          analysisSource,
          visionCategory: result.category,
          visionCategories: (result.categories ?? []).map((c) => c.category),
          ...meta,
        },
        "incident analyze vision result",
      );
    }

    if (abort.signal.aborted) {
      return;
    }

    await updateIncidentAnalysis(incidentId, analysis);
    log.info({ incidentId, category: analysis.category, analysisSource }, "incident analyze completed");
  } catch (e) {
    if (abort.signal.aborted) {
      log.info({ incidentId }, "incident analyze cancelled");
      return;
    }
    const message = userFacingAnalyzeError(e);
    await setIncidentAnalysisFailed(incidentId, message).catch(() => {});
    log.error({ err: e, incidentId, message }, "incident analyze failed");
  } finally {
    activeJobs.delete(incidentId);
  }
}

export async function incidentsAnalyzeRoutes(app: FastifyInstance) {
  app.post("/api/incidents/analyze", async (request, reply) => {
    const secret = request.headers["x-backend-secret"];
    if (secret !== getEnv().BACKEND_INTERNAL_SECRET) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const { incidentId } = parsed.data;
    const incident = await getIncidentById(incidentId);
    if (!incident) {
      return reply.code(404).send({ error: "Incident not found" });
    }
    if (incident.category !== "pending") {
      return reply.send({ status: "ok", incident });
    }
    if (activeJobs.has(incidentId)) {
      return reply.code(202).send({ status: "already_processing", incidentId });
    }

    void runAnalysis(incidentId, request.log);

    return reply.code(202).send({ status: "processing", incidentId });
  });

  app.post("/api/incidents/analyze/cancel", async (request, reply) => {
    const secret = request.headers["x-backend-secret"];
    if (secret !== getEnv().BACKEND_INTERNAL_SECRET) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const { incidentId } = parsed.data;
    const job = activeJobs.get(incidentId);
    if (job) {
      job.abort();
      activeJobs.delete(incidentId);
    }
    await setIncidentAnalysisFailed(incidentId, "Анализ остановлен");
    return reply.send({ status: "cancelled", incidentId });
  });
}
