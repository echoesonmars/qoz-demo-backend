import { listRunningSessions } from "./live-monitor-db.js";
import { countActiveRecorders } from "./live-session-recorder.js";

const MAX_INGEST = Math.max(
  1,
  Number.parseInt(process.env.MAX_CONCURRENT_LIVE_INGEST ?? "5", 10) || 5,
);

export async function assertCanStartLiveSession(): Promise<void> {
  const running = await listRunningSessions();
  const recorders = countActiveRecorders();
  const total = Math.max(running.length, recorders);
  if (total >= MAX_INGEST) {
    throw new Error(
      `Достигнут лимит одновременного мониторинга (${MAX_INGEST}). Остановите другую камеру.`,
    );
  }
}

export function maxConcurrentLiveIngest(): number {
  return MAX_INGEST;
}
