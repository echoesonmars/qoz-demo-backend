export function formatUserFacingVisionError(err: unknown): string {
  const full = err instanceof Error ? err.message : String(err);
  if (/vision timeout|TimeoutError|aborted/i.test(full)) {
    return "Сервис анализа кадра (vision) не ответил вовремя. Проверьте VISION_LIVE_URL и нагрузку.";
  }
  if (/VISION_LIVE_URL is not configured/i.test(full)) {
    return "Не задан VISION_LIVE_URL для режима vision.";
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(full)) {
    return "Не удалось подключиться к qoz-vision. Убедитесь, что сервис запущен и URL доступен с бэкенда.";
  }
  if (full.length > 280) {
    return `${full.slice(0, 280)}…`;
  }
  return full;
}
