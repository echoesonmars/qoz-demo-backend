import fs from "node:fs/promises";

import { getEnv } from "../config/env.js";
import { probeMediaDurationSec } from "./lesson-video-media.js";

export type LessonLanguage = "kk" | "ru" | "en";

export type WhisperSegment = {
  start_sec: number;
  end_sec: number;
  text: string;
  language?: LessonLanguage;
};

export type WhisperResult = {
  segments: WhisperSegment[];
  duration_sec: number;
  placeholder: boolean;
};

const STUB_SEGMENT_SEC = 30;

const STUB_TEXTS = [
  "Сәлеметсіздер ме, балалар. Бүгін сабақты бастаймыз.",
  "Итак, сегодня мы проходим новую тему. Откройте тетради.",
  "Формула дискриминанта записана на доске. Посмотрите внимательно.",
  "Теперь решайте задачи самостоятельно. Я пройду по рядам.",
  "Кто может ответить на вопрос? Поднимите руку.",
  "Отлично. Переходим к следующему примеру.",
  "Проверьте решение с соседом и обсудите ошибки.",
  "Внимание: на доске другой способ решения.",
  "Сделайте паузу. Запишите домашнее задание.",
  "Подведём итоги: что мы узнали сегодня?",
  "Домашнее задание: упражнения 12–15. До свидания.",
];

function stubTextForIndex(index: number, total: number): string {
  if (index === 0) return STUB_TEXTS[0]!;
  if (index >= total - 1) return STUB_TEXTS[STUB_TEXTS.length - 1]!;
  const mid = Math.floor((index / Math.max(total - 1, 1)) * (STUB_TEXTS.length - 2));
  return STUB_TEXTS[Math.min(mid + 1, STUB_TEXTS.length - 2)]!;
}

export function buildLocalWhisperStub(durationSec: number): WhisperResult {
  const segments: WhisperSegment[] = [];
  let start = 0;
  let index = 0;
  const totalSegments = Math.max(1, Math.ceil(durationSec / STUB_SEGMENT_SEC));

  while (start < durationSec) {
    const end = Math.min(start + STUB_SEGMENT_SEC, durationSec);
    segments.push({
      start_sec: start,
      end_sec: end,
      text: stubTextForIndex(index, totalSegments),
      language: index === 0 ? "kk" : "ru",
    });
    start = end;
    index += 1;
  }

  return {
    segments,
    duration_sec: durationSec,
    placeholder: true,
  };
}

export async function transcribeLessonAudio(
  wavPath: string,
  signal?: AbortSignal,
): Promise<WhisperResult> {
  const env = getEnv();
  const durationSec = await probeMediaDurationSec(wavPath, signal);

  if (env.LESSON_WHISPER_PLACEHOLDER) {
    return buildLocalWhisperStub(durationSec);
  }

  const url = env.LOCAL_WHISPER_URL.trim();
  if (!url) {
    throw new Error("LOCAL_WHISPER_URL is not configured");
  }

  const wav = await fs.readFile(wavPath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");

  const res = await fetch(url, {
    method: "POST",
    body: form,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Whisper HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  const json = (await res.json()) as WhisperResult;
  if (!Array.isArray(json.segments) || json.segments.length === 0) {
    throw new Error("Whisper returned no segments");
  }

  return {
    segments: json.segments,
    duration_sec: json.duration_sec ?? durationSec,
    placeholder: json.placeholder ?? false,
  };
}
