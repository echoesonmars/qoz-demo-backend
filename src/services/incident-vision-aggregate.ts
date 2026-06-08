import type { IncidentCategoryId } from "../constants/incident-categories.js";
import { INCIDENT_CATEGORY_IDS } from "../constants/incident-categories.js";
import type { AnalyzeResult, IncidentCategoryHit } from "../types/incidents.js";
import type { VisionFrameAnalysisDto } from "../types/vision-frame-dto.js";
import {
  collectCategoryScoresFromDto,
  INCIDENT_DESCRIPTION_RU,
} from "./vision-incident-category-map.js";

type CategoryStats = {
  hits: number;
  maxScore: number;
};

const TEMPORAL_WINDOW_SIZE = 4;
const TEMPORAL_MIN_HITS = 2;
const FIGHT_KILL_SWITCH_MIN_HITS = 2;

const CATEGORY_TEMPORAL_MIN_HITS: Partial<Record<IncidentCategoryId, number>> = {
  fight: 1,
  smoking: 2,
  smoke: 3,
  fire: 3,
};

const CATEGORY_MIN_HIT_RATIO: Partial<Record<IncidentCategoryId, number>> = {
  smoke: 0.35,
  fire: 0.35,
  smoking: 0.06,
  fight: 0.012,
  lost_property: 0.025,
};

const LONG_INCIDENT_FRAME_COUNT = 60;

export function minQualifiedHits(
  cat: IncidentCategoryId,
  totalFrames: number,
): number {
  const ratio = CATEGORY_MIN_HIT_RATIO[cat];
  if (cat === "smoking") {
    if (totalFrames <= LONG_INCIDENT_FRAME_COUNT) {
      return Math.max(2, Math.ceil(totalFrames * (ratio ?? 0.06)));
    }
    return 2;
  }
  if (cat === "fight") {
    if (totalFrames <= 30) {
      return 1;
    }
    return Math.max(6, Math.ceil(totalFrames * (ratio ?? 0.012)));
  }
  if (cat === "weapon" && totalFrames > LONG_INCIDENT_FRAME_COUNT) {
    return 2;
  }
  if (cat === "lost_property" && totalFrames > LONG_INCIDENT_FRAME_COUNT) {
    return Math.max(3, Math.ceil(totalFrames * (ratio ?? 0.025)));
  }
  if (ratio !== undefined && totalFrames > 0) {
    return Math.max(1, Math.ceil(totalFrames * ratio));
  }
  return 1;
}

export function temporalMinHitsForVideo(
  cat: IncidentCategoryId,
  totalFrames: number,
): number {
  if (cat === "fight" && totalFrames > 30) {
    return 2;
  }
  return temporalMinHits(cat);
}

function categoryMeetsHitThreshold(
  cat: IncidentCategoryId,
  hits: number,
  totalFrames: number,
): boolean {
  return hits >= minQualifiedHits(cat, totalFrames);
}

function applyWeaponDominanceRules(
  stats: Map<IncidentCategoryId, CategoryStats>,
  totalFrames: number,
): void {
  const weapon = stats.get("weapon");
  if (!weapon || weapon.hits < 2 || weapon.maxScore < 0.48) {
    return;
  }
  const fight = stats.get("fight");
  if (fight) {
    stats.delete("fight");
  }
  const smoking = stats.get("smoking");
  if (smoking && smoking.maxScore < 0.58) {
    stats.delete("smoking");
  }
  const lost = stats.get("lost_property");
  if (lost && lost.hits / totalFrames < 0.04) {
    stats.delete("lost_property");
  }
}

function applyCrossCategoryRules(
  stats: Map<IncidentCategoryId, CategoryStats>,
  totalFrames: number,
): void {
  applyWeaponDominanceRules(stats, totalFrames);

  if (stats.has("weapon")) {
    return;
  }

  if (totalFrames <= LONG_INCIDENT_FRAME_COUNT) {
    return;
  }
  const smoking = stats.get("smoking");
  if (!smoking || smoking.hits < 2) {
    return;
  }
  const fight = stats.get("fight");
  if (fight && fight.hits / totalFrames < 0.02) {
    stats.delete("fight");
  }
  const lost = stats.get("lost_property");
  if (lost && lost.hits / totalFrames < 0.03) {
    stats.delete("lost_property");
  }
}

const SEVERITY_WEIGHTS: Partial<Record<IncidentCategoryId, number>> = {
  weapon: 5,
  fight: 3,
  fire: 2,
  smoke: 2,
  fence_climbing: 2.5,
  wanted_person: 2.5,
  fall: 1,
  crowd: 1,
  lost_property: 0.5,
  sleep: 0.5,
  phone_usage: 0.5,
  smoking: 0.5,
  anpr: 0.5,
};

const CATEGORY_MIN_CONF: Partial<Record<IncidentCategoryId, number>> = {
  weapon: 0.55,
  fight: 0.45,
  fire: 0.70,
  smoke: 0.70,
  smoking: 0.42,
  fall: 0.52,
};

function effectiveMinConf(cat: IncidentCategoryId, globalMin: number): number {
  return CATEGORY_MIN_CONF[cat] ?? globalMin;
}

function temporalMinHits(cat: IncidentCategoryId): number {
  return CATEGORY_TEMPORAL_MIN_HITS[cat] ?? TEMPORAL_MIN_HITS;
}

function buildTemporalStats(
  dtos: VisionFrameAnalysisDto[],
  minConf: number,
): Map<IncidentCategoryId, CategoryStats> {
  const stats = new Map<IncidentCategoryId, CategoryStats>();
  const totalFrames = dtos.length;

  for (const cat of INCIDENT_CATEGORY_IDS) {
    const window: boolean[] = [];
    let inQualifiedRun = false;
    const windowMinHits = temporalMinHitsForVideo(cat, totalFrames);

    for (const dto of dtos) {
      const inFrame = collectCategoryScoresFromDto(dto);
      const score = inFrame.get(cat);
      const present =
        score !== undefined && score >= effectiveMinConf(cat, minConf);

      window.push(present);
      if (window.length > TEMPORAL_WINDOW_SIZE) {
        window.shift();
      }

      const hitsInWindow = window.filter(Boolean).length;
      if (hitsInWindow >= windowMinHits) {
        inQualifiedRun = true;
      }

      if (inQualifiedRun && present && score !== undefined) {
        const prev = stats.get(cat) ?? { hits: 0, maxScore: 0 };
        prev.hits += 1;
        prev.maxScore = Math.max(prev.maxScore, score);
        stats.set(cat, prev);
      }
    }
  }

  return stats;
}

function applyKillSwitches(stats: Map<IncidentCategoryId, CategoryStats>): void {
  const fight = stats.get("fight");
  if (fight && fight.hits >= FIGHT_KILL_SWITCH_MIN_HITS) {
    stats.delete("crowd");
  }
}

function weightedCategoryScore(
  cat: IncidentCategoryId,
  stats: CategoryStats,
  totalFrames: number,
): number {
  const base = stats.hits * stats.maxScore;
  const multiplier = SEVERITY_WEIGHTS[cat] ?? 1;
  let score = base * multiplier;

  if (cat === "fight") {
    const hitRatio = totalFrames > 0 ? stats.hits / totalFrames : 0;
    if (hitRatio > 0.8 && stats.maxScore < 0.65) {
      score *= 0.45;
    }
  }

  if (
    cat !== "weapon" &&
    cat !== "fight" &&
    stats.hits === 1 &&
    stats.maxScore < 0.6
  ) {
    score = 0;
  }

  if (!categoryMeetsHitThreshold(cat, stats.hits, totalFrames)) {
    score = 0;
  }

  return score;
}

function hitDescription(
  cat: IncidentCategoryId,
  stats: CategoryStats,
  totalFrames: number,
): string {
  const baseDesc =
    INCIDENT_DESCRIPTION_RU[cat]?.trim() || `Инцидент типа ${cat} (vision).`;
  return `${baseDesc} Зафиксировано на ${stats.hits} из ${totalFrames} кадров.`;
}

function buildCategoryHit(
  cat: IncidentCategoryId,
  stats: CategoryStats,
  totalFrames: number,
): IncidentCategoryHit {
  return {
    category: cat,
    confidence: Math.min(100, Math.max(0, Math.round(stats.maxScore * 100))),
    description: hitDescription(cat, stats, totalFrames),
  };
}

export function summarizeRawCategoryHits(
  dtos: VisionFrameAnalysisDto[],
): { category: IncidentCategoryId; frames: number; maxScore: number }[] {
  const byCat = new Map<IncidentCategoryId, { frames: number; maxScore: number }>();
  for (const dto of dtos) {
    const inFrame = collectCategoryScoresFromDto(dto);
    for (const [cat, score] of inFrame) {
      const prev = byCat.get(cat) ?? { frames: 0, maxScore: 0 };
      prev.frames += 1;
      prev.maxScore = Math.max(prev.maxScore, score);
      byCat.set(cat, prev);
    }
  }
  return [...byCat.entries()]
    .map(([category, stats]) => ({ category, ...stats }))
    .sort((a, b) => b.maxScore - a.maxScore || b.frames - a.frames);
}

export function explainEmptyAggregate(
  dtos: VisionFrameAnalysisDto[],
  minConf: number,
): string {
  const raw = summarizeRawCategoryHits(dtos);
  if (raw.length === 0) {
    return `Проанализировано ${dtos.length} кадров: модели не дали ни одной категории инцидента. Проверьте qoz-vision (yolo11m + pose + heuristics, specialized heavy.pt, SPECIALIZED_ROTATE_PER_FRAME).`;
  }
  const top = raw
    .slice(0, 4)
    .map(
      (r) =>
        `${r.category} ${Math.round(r.maxScore * 100)}% (${r.frames}/${dtos.length} кадр.)`,
    )
    .join(", ");
  const smoking = raw.find((r) => r.category === "smoking");
  const smokingHint =
    smoking === undefined
      ? " Курение: 0 кадров в vision (проверьте smoking/small.pt на incident-upload)."
      : ` Курение (сырое): ${Math.round(smoking.maxScore * 100)}% (${smoking.frames}/${dtos.length}).`;
  return `Проанализировано ${dtos.length} кадров. Слабые сигналы: ${top}.${smokingHint} Не прошли правила агрегации (нужно ≥2 кадра в окне и conf ≥${Math.round(minConf * 100)}%).`;
}

export function aggregateIncidentFrames(
  dtos: VisionFrameAnalysisDto[],
  minConf: number,
): AnalyzeResult | null {
  if (dtos.length === 0) {
    return null;
  }

  const stats = buildTemporalStats(dtos, minConf);
  const totalFrames = dtos.length;
  for (const [cat, s] of [...stats.entries()]) {
    if (!categoryMeetsHitThreshold(cat, s.hits, totalFrames)) {
      stats.delete(cat);
    }
  }
  if (stats.size === 0) {
    return null;
  }

  applyCrossCategoryRules(stats, totalFrames);
  applyKillSwitches(stats);
  if (stats.size === 0) {
    return null;
  }

  const ranked: { cat: IncidentCategoryId; stats: CategoryStats; weight: number }[] = [];

  for (const [cat, s] of stats) {
    const weight = weightedCategoryScore(cat, s, dtos.length);
    if (weight > 0) {
      ranked.push({ cat, stats: s, weight });
    }
  }

  if (ranked.length === 0) {
    return null;
  }

  ranked.sort((a, b) => b.weight - a.weight);

  const categories = ranked.map(({ cat, stats: s }) =>
    buildCategoryHit(cat, s, dtos.length),
  );

  const primary = categories[0]!;
  const description =
    categories.length === 1
      ? primary.description
      : categories.map((c) => c.description).join("\n\n");

  return {
    category: primary.category,
    confidence: primary.confidence,
    description,
    categories,
  };
}
