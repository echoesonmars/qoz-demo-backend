import type { IncidentCategoryId } from "../constants/incident-categories.js";
import { liveAnalysisPayloadSchema, type LiveAnalysisPayload } from "../types/live-analysis.js";
import type { VisionFrameAnalysisDto } from "../types/vision-frame-dto.js";
import {
  INCIDENT_DESCRIPTION_RU,
  mapActionToCategory,
  mapDetectionToCategory,
} from "./vision-incident-category-map.js";

const TIMESTAMP_MARKER = "frame_static";
const TARGET_LANG = "ru";
const LOCATION_CTX = "кадр целиком";

function confidenceTier(score: number): "high" | "medium" | "low" {
  if (score >= 0.72) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function tierWeight(t: "high" | "medium" | "low"): number {
  if (t === "high") return 3;
  if (t === "medium") return 2;
  return 1;
}

function focusDescriptionRu(engagement: number): string {
  if (engagement >= 70) {
    return "Большинство учеников смотрят к доске; активность в норме.";
  }
  if (engagement >= 40) {
    return "Часть класса отвлечена; внимание к фронту снижено.";
  }
  return "Низкая вовлечённость; значительная часть класса не ориентирована на фронт.";
}

function buildIncidents(dto: VisionFrameAnalysisDto) {
  const byType = new Map<
    IncidentCategoryId,
    { tier: "high" | "medium" | "low"; score: number; description: string }
  >();

  const consider = (type: IncidentCategoryId, score: number) => {
    const tier = confidenceTier(score);
    const prev = byType.get(type);
    if (!prev || tierWeight(tier) > tierWeight(prev.tier) || (tier === prev.tier && score > prev.score)) {
      const desc = INCIDENT_DESCRIPTION_RU[type]?.trim() || `Инцидент типа ${type} (vision).`;
      byType.set(type, { tier, score, description: desc });
    }
  };

  for (const d of dto.detections) {
    const cat = mapDetectionToCategory(d);
    if (!cat) continue;
    consider(cat, d.confidence);
  }

  for (const a of dto.actions) {
    const cat = mapActionToCategory(a);
    if (!cat) continue;
    consider(cat, 0.55);
  }

  return [...byType.entries()].map(([type, v]) => ({
    type,
    confidence: v.tier,
    location_context: LOCATION_CTX,
    description: v.description,
    timestamp_marker: TIMESTAMP_MARKER,
  }));
}

export function mapVisionDtoToLivePayload(dto: VisionFrameAnalysisDto): LiveAnalysisPayload {
  const engagement = Math.min(100, Math.max(0, Math.round(Number(dto.engagement))));

  const peopleFromDetections = dto.detections.filter(
    (d) => d.label === "person" || d.qoz_incident === "person",
  ).length;

  const studentsCount = Math.max(peopleFromDetections, Math.round(dto.stats?.total_students ?? 0));

  const activePhoneUsers = dto.detections.filter((d) => mapDetectionToCategory(d) === "phone_usage").length;

  const sleepingFromYolo = dto.detections.filter((d) => mapDetectionToCategory(d) === "sleep").length;
  const sleepingFromStats = dto.stats?.sleeping != null ? Math.round(dto.stats.sleeping) : 0;
  const sleepingCount = Math.max(sleepingFromYolo, sleepingFromStats);

  const raw: LiveAnalysisPayload = {
    analytics_meta: {
      target_language: TARGET_LANG,
      overall_engagement_score: engagement,
    },
    classroom_visual_behavior: {
      students_count_detected: studentsCount,
      active_phone_users: activePhoneUsers,
      sleeping_count: sleepingCount,
      general_focus_description: focusDescriptionRu(engagement),
    },
    detected_incidents: buildIncidents(dto),
  };

  const parsed = liveAnalysisPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`vision map zod: ${parsed.error.message}`);
  }
  return parsed.data;
}
