export const INCIDENT_CATEGORY_IDS = [
  "fight",
  "weapon",
  "fall",
  "smoking",
  "phone_usage",
  "sleep",
  "lost_property",
  "crowd",
  "wanted_person",
  "fence_climbing",
  "anpr",
  "fire",
  "smoke",
] as const;

export type IncidentCategoryId = (typeof INCIDENT_CATEGORY_IDS)[number];

export const INCIDENT_CATEGORY_ID_SET = new Set<string>(INCIDENT_CATEGORY_IDS);

export function isIncidentCategoryId(value: string): value is IncidentCategoryId {
  return INCIDENT_CATEGORY_ID_SET.has(value);
}
