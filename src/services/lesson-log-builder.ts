import { getEnv } from "../config/env.js";
import { formatDurationMmSs } from "./lesson-analyze-schema.js";
import type { LessonFrameSnapshot } from "./lesson-frame-stats.js";
import type { LessonLanguage, WhisperResult } from "./lesson-whisper-client.js";

export type LessonLogWindow = {
  startSec: number;
  endSec: number;
  transcriptLines: string[];
  peopleMin: number;
  peopleMax: number;
  peopleAvg: number;
  sleepHits: number;
  phoneHits: number;
  avgEngagement: number;
  minEngagement: number;
  activityScore: number;
};

export type LessonLogMeta = {
  durationSec: number;
  detectedLanguage: LessonLanguage;
  frameCount: number;
  sampleSec: number;
  windowSec: number;
};

export type BuiltLessonLog = {
  meta: LessonLogMeta;
  windows: LessonLogWindow[];
  compiledText: string;
};

function detectLanguage(transcript: WhisperResult): LessonLanguage {
  const counts: Record<LessonLanguage, number> = { kk: 0, ru: 0, en: 0 };
  for (const seg of transcript.segments) {
    if (seg.language) {
      counts[seg.language] += seg.end_sec - seg.start_sec;
    }
  }
  if (counts.kk >= counts.ru && counts.kk >= counts.en && counts.kk > 0) return "kk";
  if (counts.en > counts.ru && counts.en > counts.kk) return "en";
  return "ru";
}

function windowActivityScore(w: LessonLogWindow): number {
  const transcriptLen = w.transcriptLines.join(" ").length;
  return w.sleepHits * 3 + w.phoneHits * 2 + w.peopleAvg + transcriptLen / 200 + (100 - w.avgEngagement) / 10;
}

function aggregateWindow(
  startSec: number,
  endSec: number,
  transcript: WhisperResult,
  frames: LessonFrameSnapshot[],
): LessonLogWindow {
  const transcriptLines: string[] = [];
  for (const seg of transcript.segments) {
    if (seg.end_sec <= startSec || seg.start_sec >= endSec) continue;
    transcriptLines.push(`- "${seg.text.trim()}"`);
  }

  const inWindow = frames.filter(
    (f) => f.timestampSec >= startSec && f.timestampSec < endSec,
  );

  let peopleMin = 0;
  let peopleMax = 0;
  let peopleSum = 0;
  let sleepHits = 0;
  let phoneHits = 0;
  let engagementSum = 0;
  let minEngagement = 100;

  if (inWindow.length > 0) {
    peopleMin = inWindow[0]!.metrics.personCount;
    peopleMax = inWindow[0]!.metrics.personCount;
    for (const f of inWindow) {
      peopleMin = Math.min(peopleMin, f.metrics.personCount);
      peopleMax = Math.max(peopleMax, f.metrics.personCount);
      peopleSum += f.metrics.personCount;
      sleepHits += f.metrics.sleepCount;
      phoneHits += f.metrics.phoneCount;
      engagementSum += f.metrics.engagement;
      minEngagement = Math.min(minEngagement, f.metrics.engagement);
    }
  }

  const peopleAvg = inWindow.length > 0 ? peopleSum / inWindow.length : 0;
  const avgEngagement = inWindow.length > 0 ? engagementSum / inWindow.length : 80;

  const window: LessonLogWindow = {
    startSec,
    endSec,
    transcriptLines,
    peopleMin,
    peopleMax,
    peopleAvg,
    sleepHits,
    phoneHits,
    avgEngagement,
    minEngagement: inWindow.length > 0 ? minEngagement : avgEngagement,
    activityScore: 0,
  };
  window.activityScore = windowActivityScore(window);
  return window;
}

function formatWindowBlock(w: LessonLogWindow): string {
  const start = formatDurationMmSs(w.startSec);
  const end = formatDurationMmSs(w.endSec);
  const transcript =
    w.transcriptLines.length > 0 ? w.transcriptLines.join("\n") : "- (нет речи в окне)";
  return `[${start} - ${end}]
Транскрипт:
${transcript}
Визуальные события:
- Людей: ${Math.round(w.peopleMin)}–${Math.round(w.peopleMax)} (средн. ${Math.round(w.peopleAvg)}).
- Сон: ${w.sleepHits}.
- Телефоны: ${w.phoneHits}.
- Вовлечённость: средн. ${Math.round(w.avgEngagement)}%, мин. ${Math.round(w.minEngagement)}%.`;
}

export function buildLessonWindows(
  transcript: WhisperResult,
  frames: LessonFrameSnapshot[],
  durationSec: number,
): LessonLogWindow[] {
  const windowSec = getEnv().LESSON_LOG_WINDOW_SEC;
  const windows: LessonLogWindow[] = [];
  for (let start = 0; start < durationSec; start += windowSec) {
    const end = Math.min(start + windowSec, durationSec);
    windows.push(aggregateWindow(start, end, transcript, frames));
  }
  if (windows.length === 0) {
    windows.push(aggregateWindow(0, durationSec, transcript, frames));
  }
  return windows;
}

export function compileLessonLogText(meta: LessonLogMeta, windows: LessonLogWindow[]): string {
  const header = `=== Lesson compiled log ===
Duration: ${formatDurationMmSs(meta.durationSec)} (${Math.round(meta.durationSec)} sec)
Language: ${meta.detectedLanguage}
Vision frames: ${meta.frameCount} (every ${meta.sampleSec}s)
Windows: ${meta.windowSec}s each
`;
  const body = windows.map(formatWindowBlock).join("\n\n");
  return `${header}\n${body}`;
}

export function truncateLessonLog(
  meta: LessonLogMeta,
  windows: LessonLogWindow[],
): { windows: LessonLogWindow[]; compiledText: string } {
  const maxChars = getEnv().LESSON_LOG_MAX_CHARS;
  const tailPreserveSec = getEnv().LESSON_LOG_TAIL_PRESERVE_SEC;
  const durationSec = meta.durationSec;
  const tailStartSec = Math.max(0, durationSec - tailPreserveSec);

  let selected = [...windows];
  let compiled = compileLessonLogText(meta, selected);

  if (compiled.length <= maxChars) {
    return { windows: selected, compiledText: compiled };
  }

  const head = selected[0];
  const tail = selected.filter((w) => w.startSec >= tailStartSec);
  const tailIds = new Set(tail.map((w) => w.startSec));
  if (head) tailIds.add(head.startSec);

  let middle = selected.filter((w) => !tailIds.has(w.startSec));
  middle.sort((a, b) => a.activityScore - b.activityScore);

  while (middle.length > 0) {
    const removed = middle.shift()!;
    selected = selected.filter((w) => w.startSec !== removed.startSec);
    compiled = compileLessonLogText(meta, selected);
    if (compiled.length <= maxChars) {
      break;
    }
  }

  if (compiled.length > maxChars) {
    const quiet = selected
      .filter((w) => !tailIds.has(w.startSec))
      .sort((a, b) => a.activityScore - b.activityScore);
    for (let i = 0; i < quiet.length && compiled.length > maxChars; i += 1) {
      selected = selected.filter((w) => w.startSec !== quiet[i]!.startSec);
      compiled = compileLessonLogText(meta, selected);
    }
  }

  if (compiled.length > maxChars) {
    const headWin = selected[0];
    const tailWins = selected.filter((w) => w.startSec >= tailStartSec);
    const headText = headWin ? formatWindowBlock(headWin) : "";
    const tailText = tailWins.map(formatWindowBlock).join("\n\n");
    const marker = "\n\n[... middle truncated ...]\n\n";
    const header = compileLessonLogText(meta, []).trim();
    compiled = `${header}\n\n${headText}${marker}${tailText}`;
    selected = [headWin, ...tailWins].filter((w): w is LessonLogWindow => w != null);
  }

  return { windows: selected, compiledText: compiled.slice(0, maxChars) };
}

export function buildLessonLog(
  transcript: WhisperResult,
  frames: LessonFrameSnapshot[],
  durationSec: number,
  sampleSec: number,
): BuiltLessonLog {
  const meta: LessonLogMeta = {
    durationSec,
    detectedLanguage: detectLanguage(transcript),
    frameCount: frames.length,
    sampleSec,
    windowSec: getEnv().LESSON_LOG_WINDOW_SEC,
  };
  const windows = buildLessonWindows(transcript, frames, durationSec);
  const truncated = truncateLessonLog(meta, windows);
  return {
    meta,
    windows: truncated.windows,
    compiledText: truncated.compiledText,
  };
}
