import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { analyzeIncidentVideo } from "../services/gemini-analyze.js";
import { getIncidentById, updateIncidentAnalysis } from "../services/incidents-db.js";
import { presignIncidentVideo } from "../services/storage.js";

const bodySchema = z.object({
  incidentId: z.string().uuid(),
});

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
    try {
      const videoUrl = await presignIncidentVideo(incident.storage_path, 3600);
      const analysis = await analyzeIncidentVideo(videoUrl);
      const updated = await updateIncidentAnalysis(incidentId, analysis);
      return reply.send({ status: "ok", incident: updated });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Analysis failed";
      request.log.error({ err: e, incidentId }, "incident analyze failed");
      return reply.code(502).send({ error: msg });
    }
  });
}
