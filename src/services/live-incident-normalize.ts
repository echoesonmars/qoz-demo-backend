import {
  INCIDENT_CATEGORY_IDS,
  type IncidentCategoryId,
} from "../constants/incident-categories.js";

export type NormalizedIncidentCategory = IncidentCategoryId | "intruder";

const KNOWN = new Set<string>(INCIDENT_CATEGORY_IDS);

const ALIASES: Record<string, NormalizedIncidentCategory> = {
  phone: "phone_usage",
  phones: "phone_usage",
  phoneusage: "phone_usage",
  mobile: "phone_usage",
  smartphone: "phone_usage",
  sleeping: "sleep",
  asleep: "sleep",
  nap: "sleep",
  fight: "fight",
  fighting: "fight",
  brawl: "fight",
  weapon: "weapon",
  weapons: "weapon",
  gun: "weapon",
  knife: "weapon",
  fall: "fall",
  fallen: "fall",
  smoking: "smoking",
  smoke: "smoke",
  cigarette: "smoking",
  fire: "fire",
  flame: "fire",
  crowd: "crowd",
  gathering: "crowd",
  intruder: "intruder",
  stranger: "intruder",
  unknown: "intruder",
  lost_property: "lost_property",
  lostproperty: "lost_property",
  abandoned: "lost_property",
  wanted_person: "wanted_person",
  wantedperson: "wanted_person",
  fence_climbing: "fence_climbing",
  fenceclimbing: "fence_climbing",
  climbing: "fence_climbing",
  anpr: "anpr",
  license_plate: "anpr",
  plate: "anpr",
};

function slug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function normalizeLiveIncidentType(raw: string): NormalizedIncidentCategory {
  const s = slug(raw);
  if (!s) return "intruder";
  if (KNOWN.has(s)) return s as IncidentCategoryId;
  if (ALIASES[s]) return ALIASES[s];
  for (const [key, value] of Object.entries(ALIASES)) {
    if (s.includes(key) || key.includes(s)) return value;
  }
  return "intruder";
}
