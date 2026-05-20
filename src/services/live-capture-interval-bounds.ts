export function liveCaptureIntervalMinFloorMs(): number {
  const raw = Number(process.env.LIVE_CAPTURE_MIN_INTERVAL_MS ?? 250);
  if (!Number.isFinite(raw)) return 250;
  return Math.min(60_000, Math.max(200, Math.floor(raw)));
}
