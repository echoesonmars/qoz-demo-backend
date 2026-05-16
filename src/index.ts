import Fastify from "fastify";
import { getEnv } from "./config/env.js";
import { registerCors } from "./plugins/cors.js";
import { devicesFleetRoutes } from "./routes/devices-fleet.js";
import { incidentsAnalyzeRoutes } from "./routes/incidents-analyze.js";
import { liveRoutes } from "./routes/live.js";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true }));

await registerCors(app);
await incidentsAnalyzeRoutes(app);
await devicesFleetRoutes(app);
await liveRoutes(app);

const env = getEnv();
await app.listen({ port: env.PORT, host: env.HOST });
app.log.info(`Qoz backend listening on ${env.HOST}:${env.PORT}`);
