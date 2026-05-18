import type { FastifyBaseLogger } from "fastify";
import { maxConcurrentLiveIngest } from "./live-concurrency.js";
import { startLiveIngest, stopAllLiveIngests } from "./live-hls-ingest.js";
import {
  listRunningSessions,
  reconcileZombieSessionsOnBoot,
  setMonitorSessionZombieOnBoot,
} from "./live-monitor-db.js";
import { startRetentionScheduler } from "./live-retention.js";
import {
  startSessionRecording,
  stopAllSessionRecordings,
} from "./live-session-recorder.js";

function resumeOnBootEnabled(): boolean {
  const raw = process.env.LIVE_RESUME_ON_BOOT?.trim().toLowerCase();
  if (raw === "false" || raw === "0") return false;
  return true;
}

export async function bootstrapLiveMonitoring(log: FastifyBaseLogger): Promise<void> {
  try {
    stopAllLiveIngests();
    stopAllSessionRecordings();

    if (resumeOnBootEnabled()) {
      const running = await listRunningSessions();
      running.sort(
        (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
      );
      const limit = maxConcurrentLiveIngest();
      let resumed = 0;
      for (let i = 0; i < running.length; i += 1) {
        const session = running[i]!;
        if (i < limit) {
          startSessionRecording(session.id, session.hls_url);
          startLiveIngest(session, log);
          resumed += 1;
        } else {
          await setMonitorSessionZombieOnBoot(session.id);
        }
      }
      if (resumed > 0) {
        log.info({ resumed, total: running.length }, "live ingest resumed after boot");
      }
    } else {
      const count = await reconcileZombieSessionsOnBoot();
      if (count > 0) {
        log.info({ count }, "live sessions marked stopped after server boot");
      }
    }

    startRetentionScheduler(log);
  } catch (err) {
    log.warn({ err }, "live monitoring bootstrap skipped (DB tables missing?)");
  }
}
