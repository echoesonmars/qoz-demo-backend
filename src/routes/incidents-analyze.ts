import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { analyzeIncidentVideo } from "../services/gemini-analyze.js";
import { getIncidentById, updateIncidentAnalysis } from "../services/incidents-db.js";
import { presignIncidentVideo } from "../services/storage.js";

const bodySchema = z.object({
  incidentId: z.string().uuid(),
});

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
  try {
    const videoUrl = await presignIncidentVideo(incident.storage_path, 3600);
    log.info({ incidentId }, "analyze started");
    const analysis = await analyzeIncidentVideo(videoUrl);
    await updateIncidentAnalysis(incidentId, analysis);
    log.info({ incidentId, category: analysis.category }, "analyze completed");
  } catch (e) {
    log.error({ err: e, incidentId }, "incident analyze failed");
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

    void runAnalysis(incidentId, request.log);

    return reply.code(202).send({ status: "processing", incidentId });
  });
}
