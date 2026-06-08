import { z } from "zod";
import type { LessonAnalysisReport } from "../types/lessons.js";

const timeCode = z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/);

export const lessonAnalyzeSchema = z.object({
  detected_language: z.enum(["kk", "ru", "en"]),
  lesson_overview: z.object({
    duration: timeCode,
    overall_engagement_score: z.coerce.number().min(0).max(100),
    pedagogical_style: z.string().min(1).max(4000),
    presentation_sync: z.string().min(1).max(4000),
  }),
  time_management: z
    .array(
      z.object({
        phase: z.string().min(1).max(200),
        start_time: timeCode,
        end_time: timeCode,
        description: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(30),
  incidents_summary: z
    .array(
      z.object({
        type: z.string().min(1).max(200),
        count: z.coerce.number().int().min(0).max(999),
        severity: z.enum(["Low", "Medium", "High"]),
        description: z.string().min(1).max(2000),
      }),
    )
    .max(50),
  timeline: z
    .array(
      z.object({
        timestamp: timeCode,
        event_type: z.enum(["Interaction", "Infraction", "Engagement Drop", "Phase"]),
        description: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(80),
});

export function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

export function parseLessonAnalysisReport(text: string): LessonAnalysisReport {
  return lessonAnalyzeSchema.parse(JSON.parse(extractJson(text)));
}

export function formatDurationMmSs(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
