import type { VisionFrameAnalysisDto } from "../types/vision-frame-dto.js";

export type LessonFrameMetrics = {
  personCount: number;
  sleepCount: number;
  phoneCount: number;
  engagement: number;
  lookingAtBoard: number;
  totalStudents: number;
};

export type LessonFrameSnapshot = {
  frameIndex: number;
  timestampSec: number;
  metrics: LessonFrameMetrics;
};

function countDetections(
  dto: VisionFrameAnalysisDto,
  labels: string[],
): number {
  let count = 0;
  for (const d of dto.detections) {
    const key = (d.qoz_incident || d.label || "").trim().toLowerCase();
    if (labels.includes(key)) {
      count += 1;
    }
  }
  return count;
}

function countActions(dto: VisionFrameAnalysisDto, types: string[]): number {
  let count = 0;
  for (const a of dto.actions) {
    if (types.includes(a.type)) {
      count += 1;
    }
  }
  return count;
}

export function computeFrameEngagement(sleepCount: number, phoneCount: number): number {
  let engagement = 80;
  engagement -= sleepCount * 10;
  engagement -= phoneCount * 5;
  return Math.max(0, Math.min(100, engagement));
}

export function extractLessonFrameMetrics(dto: VisionFrameAnalysisDto): LessonFrameMetrics {
  const personCount = countDetections(dto, ["person"]);
  const sleepFromDetections = countDetections(dto, ["sleep"]);
  const sleepFromActions = countActions(dto, ["sleeping"]);
  const sleepCount = Math.max(
    sleepFromDetections,
    sleepFromActions,
    dto.stats?.sleeping ?? 0,
  );
  const phoneCount = countDetections(dto, ["phone_usage"]);
  const engagement = computeFrameEngagement(sleepCount, phoneCount);
  const totalStudents = dto.stats?.total_students ?? personCount;
  const lookingAtBoard = dto.stats?.looking_at_board ?? 0;

  return {
    personCount: totalStudents > 0 ? totalStudents : personCount,
    sleepCount,
    phoneCount,
    engagement,
    lookingAtBoard,
    totalStudents,
  };
}

export function snapshotFromDto(
  frameIndex: number,
  timestampSec: number,
  dto: VisionFrameAnalysisDto,
): LessonFrameSnapshot {
  return {
    frameIndex,
    timestampSec,
    metrics: extractLessonFrameMetrics(dto),
  };
}
