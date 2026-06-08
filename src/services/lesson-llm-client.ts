import { getEnv } from "../config/env.js";
import { lessonAnalyzePipelineSystemPrompt } from "../prompts/lesson-analyze-pipeline.js";
import type { LessonAnalysisReport } from "../types/lessons.js";
import {
  formatDurationMmSs,
  lessonAnalyzeSchema,
  parseLessonAnalysisReport,
} from "./lesson-analyze-schema.js";
import type { BuiltLessonLog } from "./lesson-log-builder.js";

export type LessonReportMeta = {
  durationSec: number;
  totalSleepHits: number;
  totalPhoneHits: number;
  avgEngagement: number;
};

function summarizeMeta(log: BuiltLessonLog): LessonReportMeta {
  let sleep = 0;
  let phone = 0;
  let engagementSum = 0;
  for (const w of log.windows) {
    sleep += w.sleepHits;
    phone += w.phoneHits;
    engagementSum += w.avgEngagement;
  }
  const avgEngagement = log.windows.length > 0 ? engagementSum / log.windows.length : 80;
  return {
    durationSec: log.meta.durationSec,
    totalSleepHits: sleep,
    totalPhoneHits: phone,
    avgEngagement,
  };
}

function phaseLabel(index: number, total: number): string {
  if (index === 0) return "Intro";
  if (index === total - 1) return "Summary";
  if (index === 1) return "Theory";
  if (index === total - 2) return "Practice";
  return `Block ${index + 1}`;
}

export function synthesizeLessonReportFromLog(log: BuiltLessonLog): LessonAnalysisReport {
  const meta = summarizeMeta(log);
  const lang = log.meta.detectedLanguage;
  const duration = formatDurationMmSs(log.meta.durationSec);
  const windows = log.windows.length > 0 ? log.windows : [];

  const time_management = windows.map((w, i) => ({
    phase: phaseLabel(i, windows.length),
    start_time: formatDurationMmSs(w.startSec),
    end_time: formatDurationMmSs(w.endSec),
    description:
      lang === "kk"
        ? `${Math.round(w.peopleAvg)} оқушы. Engagement ${Math.round(w.avgEngagement)}%.`
        : `~${Math.round(w.peopleAvg)} человек. Вовлечённость ${Math.round(w.avgEngagement)}%.`,
  }));

  if (time_management.length === 0) {
    time_management.push({
      phase: "Lesson",
      start_time: "0:00",
      end_time: duration,
      description: lang === "kk" ? "Сабақ" : "Урок",
    });
  }

  const incidents_summary: LessonAnalysisReport["incidents_summary"] = [];
  if (meta.totalSleepHits > 0) {
    incidents_summary.push({
      type: lang === "kk" ? "Ұйқы" : "Сон",
      count: meta.totalSleepHits,
      severity: meta.totalSleepHits >= 5 ? "High" : "Medium",
      description:
        lang === "kk"
          ? `Vision: ${meta.totalSleepHits} рет ұйқы белгісі.`
          : `Vision: зафиксировано ${meta.totalSleepHits} эпизодов сна.`,
    });
  }
  if (meta.totalPhoneHits > 0) {
    incidents_summary.push({
      type: lang === "kk" ? "Телефон" : "Телефон",
      count: meta.totalPhoneHits,
      severity: meta.totalPhoneHits >= 3 ? "Medium" : "Low",
      description:
        lang === "kk"
          ? `Vision: ${meta.totalPhoneHits} телефон детекциясы.`
          : `Vision: ${meta.totalPhoneHits} детекций телефона.`,
    });
  }

  const timeline: LessonAnalysisReport["timeline"] = [];
  for (const w of windows) {
    if (w.sleepHits > 0 || w.phoneHits > 0 || w.avgEngagement < 60) {
      const ts = formatDurationMmSs(w.startSec);
      if (w.sleepHits > 0) {
        timeline.push({
          timestamp: ts,
          event_type: "Infraction",
          description:
            lang === "kk"
              ? `Ұйқы белгілері: ${w.sleepHits}`
              : `Признаки сна: ${w.sleepHits}`,
        });
      }
      if (w.phoneHits > 0) {
        timeline.push({
          timestamp: ts,
          event_type: "Infraction",
          description:
            lang === "kk"
              ? `Телефон: ${w.phoneHits}`
              : `Телефоны: ${w.phoneHits}`,
        });
      }
      if (w.avgEngagement < 60) {
        timeline.push({
          timestamp: ts,
          event_type: "Engagement Drop",
          description:
            lang === "kk"
              ? `Engagement ${Math.round(w.avgEngagement)}%`
              : `Вовлечённость ${Math.round(w.avgEngagement)}%`,
        });
      }
    }
    if (w.transcriptLines.length > 0 && timeline.length < 80) {
      timeline.push({
        timestamp: formatDurationMmSs(w.startSec),
        event_type: "Interaction",
        description: w.transcriptLines[0]!.replace(/^-\s*"/, "").replace(/"$/, ""),
      });
    }
  }

  if (timeline.length === 0) {
    timeline.push({
      timestamp: "0:00",
      event_type: "Phase",
      description: lang === "kk" ? "Сабақ басталды" : "Начало урока",
    });
  }

  const report: LessonAnalysisReport = {
    detected_language: lang,
    lesson_overview: {
      duration,
      overall_engagement_score: Math.round(meta.avgEngagement),
      pedagogical_style:
        lang === "kk"
          ? "Pipeline log: мұғалім монологы мен практика аралас."
          : "Pipeline log: сочетание объяснения и самостоятельной работы.",
      presentation_sync:
        lang === "kk"
          ? "Тranskript пен vision статистикасына сүйенеді."
          : "На основе транскрипта и vision-статистики из лога.",
    },
    time_management,
    incidents_summary,
    timeline: timeline.slice(0, 80),
  };

  return lessonAnalyzeSchema.parse(report);
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function fetchLlmJson(
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const env = getEnv();
  const url = env.LOCAL_LLM_URL.trim();
  if (!url) {
    throw new Error("LOCAL_LLM_URL is not configured");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.LESSON_LLM_MODEL,
      messages,
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty LLM response");
  }
  return content;
}

export async function synthesizeLessonReport(
  log: BuiltLessonLog,
  signal?: AbortSignal,
): Promise<LessonAnalysisReport> {
  const env = getEnv();

  if (env.LESSON_LLM_PLACEHOLDER) {
    return synthesizeLessonReportFromLog(log);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: lessonAnalyzePipelineSystemPrompt },
    { role: "user", content: log.compiledText },
  ];

  let lastError: unknown;
  const maxAttempts = env.LESSON_LLM_MAX_RETRIES + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const raw = await fetchLlmJson(messages, signal);
      return parseLessonAnalysisReport(raw);
    } catch (err) {
      lastError = err;
      const zodMsg = err instanceof Error ? err.message : String(err);
      messages.push({
        role: "user",
        content: `Fix this JSON error: ${zodMsg}`,
      });
    }
  }

  const msg = lastError instanceof Error ? lastError.message : "LLM lesson synthesis failed";
  throw new Error(msg);
}
