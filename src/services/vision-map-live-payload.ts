import type { IncidentCategoryId } from "../constants/incident-categories.js";
import { isIncidentCategoryId } from "../constants/incident-categories.js";
import { liveAnalysisPayloadSchema, type LiveAnalysisPayload } from "../types/live-analysis.js";
import type { VisionFrameAction, VisionFrameAnalysisDto, VisionFrameDetection } from "../types/vision-frame-dto.js";

const TIMESTAMP_MARKER = "frame_static";
const TARGET_LANG = "ru";
const LOCATION_CTX = "кадр целиком";

const QOZ_TO_CATEGORY: Record<string, IncidentCategoryId | null> = {
  person: null,
  phone_usage: "phone_usage",
  lost_property: "lost_property",
  crowd: "crowd",
  fight: "fight",
  weapon: "weapon",
  fall: "fall",
  smoking: "smoking",
  sleep: "sleep",
  fire: "fire",
  smoke: "smoke",
  fence_climbing: "fence_climbing",
};

const ACTION_TO_INCIDENT: Record<string, IncidentCategoryId> = {
  fall: "fall",
  sleeping: "sleep",
  fight: "fight",
  climbing_fence: "fence_climbing",
};

const INCIDENT_DESCRIPTION_RU: Record<IncidentCategoryId, string> = {
  fight: "По оценке vision: возможна потасовка или тесный контакт нескольких людей.",
  weapon: "По оценке vision: зафиксирован класс, связанный с оружием.",
  fall: "По оценке vision: возможное падение человека.",
  smoking: "По оценке vision: возможное курение.",
  phone_usage: "По оценке vision: возможное использование телефона.",
  sleep: "По оценке vision: возможный сон или сильная усталость позой.",
  lost_property: "По оценке vision: неохваченный объект / багаж в кадре.",
  crowd: "По оценке vision: скопление людей выше порога.",
  wanted_person: "По данным vision этот тип не определяется.",
  fence_climbing: "По оценке vision: возможное преодоление ограждения.",
  anpr: "По данным vision этот тип не определяется.",
  fire: "По оценке vision: возможный признак огня.",
  smoke: "По оценке vision: возможный дым.",
};

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

function mapDetectionToCategory(d: VisionFrameDetection): IncidentCategoryId | null {
  const key = (d.qoz_incident || d.label || "").trim();
  if (QOZ_TO_CATEGORY[key] !== undefined) {
    return QOZ_TO_CATEGORY[key];
  }
  if (isIncidentCategoryId(key)) {
    return key;
  }
  return null;
}

function mapActionToCategory(a: VisionFrameAction): IncidentCategoryId | null {
  return ACTION_TO_INCIDENT[a.type] ?? null;
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

  const sleepingFromStats = dto.stats?.sleeping != null ? Math.round(dto.stats.sleeping) : 0;
  const sleepingFromActions = dto.actions.filter((a) => a.type === "sleeping").length;
  const sleepingCount = Math.max(sleepingFromStats, sleepingFromActions);

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
