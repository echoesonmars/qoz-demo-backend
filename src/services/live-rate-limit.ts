const WINDOW_MS = 60_000;
const MAX_STARTS_PER_DEVICE = Math.max(
  1,
  Number.parseInt(process.env.LIVE_START_RATE_LIMIT_PER_MIN ?? "6", 10) || 6,
);

const hits = new Map<string, number[]>();

export function assertLiveStartRateLimit(deviceId: string): void {
  const now = Date.now();
  const list = hits.get(deviceId) ?? [];
  const recent = list.filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_STARTS_PER_DEVICE) {
    throw new Error(
      `Слишком частые запуски мониторинга для этой камеры (макс. ${MAX_STARTS_PER_DEVICE} в минуту)`,
    );
  }
  recent.push(now);
  hits.set(deviceId, recent);
}
