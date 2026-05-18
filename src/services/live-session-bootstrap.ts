import type { FastifyBaseLogger } from "fastify";
import { reconcileZombieSessionsOnBoot } from "./live-monitor-db.js";

export async function bootstrapLiveMonitoring(log: FastifyBaseLogger): Promise<void> {
  try {
    const count = await reconcileZombieSessionsOnBoot();
    if (count > 0) {
      log.info({ count }, "live sessions marked stopped after server boot");
    }
  } catch (err) {
    log.warn({ err }, "live monitoring bootstrap skipped (DB tables missing?)");
  }
}
