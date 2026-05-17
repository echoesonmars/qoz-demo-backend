import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { lessonAnalyzeSystemPrompt } from "../prompts/lesson-analyze.js";
import type { LessonAnalysisReport } from "../types/lessons.js";

const timeCode = z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/);

const lessonAnalyzeSchema = z.object({
  detected_language: z.enum(["kk", "ru", "en"]),
  lesson_overview: z.object({
    duration: timeCode,
    overall_engagement_score: z.coerce.number().min(0).max(100),
    pedagogical_style: z.string().min(1).max(4000),
    presentation_sync: z.string().min(1).max(4000),
  }),
  time_management: z
    .array(
      z.object({
        phase: z.string().min(1).max(200),
        start_time: timeCode,
        end_time: timeCode,
        description: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(30),
  incidents_summary: z
    .array(
      z.object({
        type: z.string().min(1).max(200),
        count: z.coerce.number().int().min(0).max(999),
        severity: z.enum(["Low", "Medium", "High"]),
        description: z.string().min(1).max(2000),
      }),
    )
    .max(50),
  timeline: z
    .array(
      z.object({
        timestamp: timeCode,
        event_type: z.enum(["Interaction", "Infraction", "Engagement Drop", "Phase"]),
        description: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(80),
});

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = "status" in err ? Number((err as { status?: number }).status) : 0;
  if (status === 429 || status === 503 || status === 500) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /high demand|UNAVAILABLE|RESOURCE_EXHAUSTED|429|503/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function analyzeModels(): string[] {
  const env = getEnv();
  const primary =
    process.env.GEMINI_LESSON_ANALYZE_MODEL?.trim() || env.GEMINI_ANALYZE_MODEL;
  const fallbacks = (
    process.env.GEMINI_LESSON_ANALYZE_FALLBACK_MODELS ??
    process.env.GEMINI_ANALYZE_FALLBACK_MODELS ??
    "gemini-2.5-flash,gemini-2.0-flash"
  )
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

async function downloadVideo(
  videoUrl: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(videoUrl);
  if (!res.ok) {
    throw new Error(`Video download failed: HTTP ${res.status}`);
  }
  const mimeType = (res.headers.get("content-type") ?? "video/mp4").split(";")[0];
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error("Video download returned empty body");
  }
  return { buffer, mimeType };
}

async function uploadVideoToGemini(
  ai: GoogleGenAI,
  buffer: Buffer,
  mimeType: string,
): Promise<{ uri: string; mimeType: string; fileName: string }> {
  const file = await ai.files.upload({
    file: new Blob([new Uint8Array(buffer)], { type: mimeType }),
    config: {
      mimeType,
      displayName: `lesson-${Date.now()}.mp4`,
    },
  });
  if (!file.name) {
    throw new Error("Gemini file upload returned no name");
  }
  let current = file;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (current.state === "ACTIVE" && current.uri) {
      return { uri: current.uri, mimeType, fileName: file.name };
    }
    if (current.state === "FAILED") {
      throw new Error("Gemini file processing failed");
    }
    await sleep(2000);
    current = await ai.files.get({ name: file.name });
  }
  throw new Error("Gemini file processing timed out");
}

async function generateAnalysis(
  ai: GoogleGenAI,
  model: string,
  fileUri: string,
  mimeType: string,
): Promise<LessonAnalysisReport> {
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { text: lessonAnalyzeSystemPrompt },
          { fileData: { fileUri, mimeType } },
          { text: "Return JSON matching the schema in the instructions." },
        ],
      },
    ],
  });
  const text = response.text;
  if (!text) {
    throw new Error("Empty response from Gemini");
  }
  return lessonAnalyzeSchema.parse(JSON.parse(extractJson(text)));
}

export async function analyzeLessonVideo(videoUrl: string): Promise<LessonAnalysisReport> {
  const env = getEnv();
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const { buffer, mimeType } = await downloadVideo(videoUrl);
  const { uri, mimeType: uploadedMime, fileName } = await uploadVideoToGemini(
    ai,
    buffer,
    mimeType,
  );

  let lastError: unknown;
  const models = analyzeModels();

  try {
    for (const model of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await generateAnalysis(ai, model, uri, uploadedMime);
        } catch (err) {
          lastError = err;
          if (!isRetryableError(err) || attempt === 2) break;
          await sleep(1500 * (attempt + 1));
        }
      }
    }
  } finally {
    await ai.files.delete({ name: fileName }).catch(() => {});
  }

  const msg = lastError instanceof Error ? lastError.message : "Lesson analysis failed";
  throw new Error(msg);
}
