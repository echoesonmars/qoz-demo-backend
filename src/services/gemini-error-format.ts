type GeminiQuotaViolation = {
  quotaMetric?: string;
  quotaId?: string;
  quotaValue?: string;
  quotaDimensions?: { model?: string };
};

function parseGeminiErrorPayload(raw: string): {
  message: string;
  violations: GeminiQuotaViolation[];
} {
  const jsonStart = raw.indexOf("{");
  if (jsonStart < 0) return { message: raw, violations: [] };
  try {
    const parsed = JSON.parse(raw.slice(jsonStart)) as {
      error?: {
        message?: string;
        details?: Array<{
          "@type"?: string;
          violations?: GeminiQuotaViolation[];
        }>;
      };
    };
    const violations =
      parsed.error?.details?.find((d) => d.violations)?.violations ?? [];
    return {
      message: parsed.error?.message ?? raw,
      violations,
    };
  } catch {
    return { message: raw, violations: [] };
  }
}

export function formatUserFacingGeminiError(err: unknown): string {
  const full = err instanceof Error ? err.message : String(err);
  const { message: raw, violations } = parseGeminiErrorPayload(full);

  if (/429|RESOURCE_EXHAUSTED|quota exceeded|rate.?limit/i.test(full)) {
    const retry = full.match(/retry in ([\d.]+)/i);
    const waitSec = retry ? Math.ceil(Number(retry[1])) : 0;
    const wait =
      waitSec >= 60
        ? ` Повторите через ~${Math.ceil(waitSec / 60)} мин.`
        : waitSec > 0
          ? ` Повторите через ~${waitSec} с.`
          : "";

    const freeTier = violations.find((v) =>
      /free_tier/i.test(v.quotaMetric ?? v.quotaId ?? ""),
    );
    if (freeTier) {
      const model = freeTier.quotaDimensions?.model ?? "модели";
      const limit = freeTier.quotaValue ?? "?";
      return (
        `Gemini считает этот API-ключ бесплатным тарифом: лимит ${limit} запросов/день для ${model} исчерпан. ` +
        `Оплата в Google Cloud не всегда включает платный Gemini API — в AI Studio для проекта ключа нужен Pay-as-you-go. ` +
        `Мониторинг камер (~6 запросов/мин на камеру) быстро съедает 500/день.${wait}`
      );
    }

    const rpm = violations.find((v) => /PerMinute|RPM/i.test(v.quotaId ?? ""));
    if (rpm) {
      return `Превышен лимит запросов в минуту Gemini (${rpm.quotaDimensions?.model ?? "модель"}). Уменьшите число камер или увеличьте LIVE_CAPTURE_INTERVAL_MS.${wait}`;
    }

    return `Лимит Gemini API (429). Проверьте https://ai.dev/rate-limit и биллинг проекта API-ключа.${wait}`;
  }

  if (/404|NOT_FOUND|not found/i.test(raw) && /model/i.test(raw)) {
    if (/live-preview/i.test(raw)) {
      return "gemini-3.1-flash-live-preview только для Live WebSocket. Для снимков задайте GEMINI_LIVE_FRAME_MODEL=gemini-3.1-flash-lite.";
    }
    return `Модель Gemini недоступна для этого ключа. Проверьте GEMINI_LIVE_FRAME_MODEL на сервере. (${raw.slice(0, 120)})`;
  }

  if (raw.length > 280) {
    return `${raw.slice(0, 280)}…`;
  }

  return raw;
}
