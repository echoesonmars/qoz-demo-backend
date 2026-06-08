import type { IncidentCategoryId } from "../constants/incident-categories.js";
import { isIncidentCategoryId } from "../constants/incident-categories.js";
import type { VisionFrameAction, VisionFrameDetection } from "../types/vision-frame-dto.js";

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

export const INCIDENT_DESCRIPTION_RU: Record<IncidentCategoryId, string> = {
  fight: "По оценке vision: возможна потасовка или тесный контакт нескольких людей.",
  weapon: "По оценке vision: возможное оружие в кадре (нож, пистолет и т.п.).",
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

export function mapDetectionToCategory(d: VisionFrameDetection): IncidentCategoryId | null {
  const key = (d.qoz_incident || d.label || "").trim();
  if (QOZ_TO_CATEGORY[key] !== undefined) {
    return QOZ_TO_CATEGORY[key];
  }
  if (isIncidentCategoryId(key)) {
    return key;
  }
  return null;
}

export function mapActionToCategory(a: VisionFrameAction): IncidentCategoryId | null {
  return ACTION_TO_INCIDENT[a.type] ?? null;
}

export function collectCategoryScoresFromDto(
  dto: { detections: VisionFrameDetection[]; actions: VisionFrameAction[] },
): Map<IncidentCategoryId, number> {
  const byCat = new Map<IncidentCategoryId, number>();
  for (const d of dto.detections) {
    const cat = mapDetectionToCategory(d);
    if (!cat) continue;
    const prev = byCat.get(cat) ?? 0;
    byCat.set(cat, Math.max(prev, d.confidence));
  }
  for (const a of dto.actions) {
    const cat = mapActionToCategory(a);
    if (!cat) continue;
    const prev = byCat.get(cat) ?? 0;
    byCat.set(cat, Math.max(prev, 0.70));
  }
  return byCat;
}
