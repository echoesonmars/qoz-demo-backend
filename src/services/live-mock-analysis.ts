import type { LiveAnalysisPayload } from "../types/live-analysis.js";

export function buildMockLiveAnalysis(tick: number): LiveAnalysisPayload {
  const score = 58 + Math.round(18 * Math.sin(tick / 4));
  const phones = tick % 5 === 0 ? 2 : tick % 3 === 0 ? 1 : 0;
  const sleeping = tick % 7 === 0 ? 1 : 0;
  const incidents =
    tick % 6 === 0
      ? [
          {
            type: "phone_usage" as const,
            confidence: "medium" as const,
            location_context: "задние ряды, центр",
            description: "Ученик держит смартфон под партой, взгляд направлен вниз.",
            timestamp_marker: "frame_static",
          },
        ]
      : [];

  return {
    analytics_meta: {
      target_language: "ru",
      overall_engagement_score: Math.min(100, Math.max(0, score)),
    },
    classroom_visual_behavior: {
      students_count_detected: 18 + (tick % 4),
      active_phone_users: phones,
      sleeping_count: sleeping,
      general_focus_description:
        score >= 70
          ? "Большинство учеников смотрят к доске; активность в норме."
          : "Часть класса отвлечена; внимание к фронту снижено.",
    },
    detected_incidents: incidents,
  };
}
