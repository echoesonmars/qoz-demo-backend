import Fastify from "fastify";
import { getBootConfig, getEnv } from "./config/env.js";
import { registerCors } from "./plugins/cors.js";
import { agentChatRoutes } from "./routes/agent-chat.js";
import { camerasInfrastructureRoutes } from "./routes/cameras-infrastructure.js";
import { devicesFleetRoutes } from "./routes/devices-fleet.js";
import { incidentsAnalyzeRoutes } from "./routes/incidents-analyze.js";
import { lessonsAnalyzeRoutes } from "./routes/lessons-analyze.js";
import { liveRoutes } from "./routes/live.js";
import { liveSessionsRoutes } from "./routes/live-sessions.js";
import { bootstrapLiveMonitoring } from "./services/live-session-bootstrap.js";
import { checkLiveHealth } from "./services/live-health.js";

let apiReady = false;
let liveHealth: Awaited<ReturnType<typeof checkLiveHealth>> | null = null;

async function main() {
  const boot = getBootConfig();
  if (boot.HOST === "127.0.0.1" || boot.HOST === "localhost") {
    console.warn(
      `[qoz-backend] HOST=${boot.HOST} blocks Railway healthchecks; use HOST=0.0.0.0`,
    );
  }

  const app = Fastify({ logger: true });

  app.get("/health", async () => {
    if (apiReady && !liveHealth) {
      liveHealth = await checkLiveHealth().catch(() => null);
    }
    const checks = liveHealth;
    const env = getEnv();
    const liveNeedsVisionHealthy =
      env.VISION_LIVE_MODE === "live" || env.VISION_LIVE_DRIVER === "on";
    const coreOk =
      checks &&
      checks.ffmpeg.ok &&
      checks.storage.ok &&
      checks.tmp.ok &&
      checks.gemini.ok &&
      (!liveNeedsVisionHealthy || checks.vision.ok);
    const allOk = !checks || Boolean(coreOk);
    return {
      ok: apiReady && allOk,
      ready: apiReady,
      live: checks,
    };
  });

  try {
    await registerCors(app);
    await agentChatRoutes(app);
    await incidentsAnalyzeRoutes(app);
    await lessonsAnalyzeRoutes(app);
    await devicesFleetRoutes(app);
    await camerasInfrastructureRoutes(app);
    await liveRoutes(app);
    await liveSessionsRoutes(app);
    await bootstrapLiveMonitoring(app.log);
    apiReady = true;
    app.log.info("API routes registered");
  } catch (err) {
    app.log.error(
      { err },
      "API routes not registered — check DATABASE_URL, S3 keys, BACKEND_INTERNAL_SECRET (min 16 chars)",
    );
  }

  await app.listen({ port: boot.PORT, host: boot.HOST });
  app.log.info(`Qoz backend listening on ${boot.HOST}:${boot.PORT}`);
}

main().catch((err) => {
  console.error("[qoz-backend] FATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
