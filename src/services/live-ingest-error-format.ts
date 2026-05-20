import { formatUserFacingGeminiError } from "./gemini-error-format.js";
import { formatUserFacingVisionError } from "./vision-error-format.js";

export function formatUserFacingLiveIngestError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (
    /vision HTTP|vision DTO|vision map zod|VISION_LIVE_URL is not configured|^Сервис анализа кадра|^Не удалось подключиться к qoz-vision/i.test(
      raw,
    )
  ) {
    return formatUserFacingVisionError(err);
  }
  return formatUserFacingGeminiError(err);
}
