import { liveAnalysisPayloadSchema, type LiveAnalysisPayload } from "../types/live-analysis.js";

export function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

export function parseLiveAnalysisPayload(raw: string): LiveAnalysisPayload | null {
  try {
    const json = extractJson(raw);
    return liveAnalysisPayloadSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}
