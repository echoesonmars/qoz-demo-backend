import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { INCIDENT_CATEGORY_IDS } from "../constants/incident-categories.js";
import { incidentAnalyzeSystemPrompt } from "../prompts/incident-analyze.js";
import type { AnalyzeResult } from "../types/incidents.js";
import { downloadVideo } from "./video-download.js";

const analyzeSchema = z.object({
  category: z.enum(INCIDENT_CATEGORY_IDS),
  confidence: z.coerce.number().min(0).max(100),
  description: z.string().min(1).max(2000),
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
  const fallbacks = (process.env.GEMINI_ANALYZE_FALLBACK_MODELS ?? "gemini-2.5-flash,gemini-2.0-flash")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([env.GEMINI_ANALYZE_MODEL, ...fallbacks])];
}

async function uploadVideoToGemai(
  ai: GoogleGenAI,
  buffer: Buffer,
  mimeType: string,
): Promise<{ uri: string; mimeType: string; fileName: string }> {
  const file = await ai.files.upload({
    file: new Blob([new Uint8Array(buffer)], { type: mimeType }),
    config: {
      mimeType,
      displayName: `incident-${Date.now()}.mp4`,
    },
  });
  if (!file.name) {
    throw new Error("Gemini file upload returned no name");
  }
  let current = file;
  for (let attempt = 0; attempt < 45; attempt++) {
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
): Promise<AnalyzeResult> {
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { text: incidentAnalyzeSystemPrompt },
          { fileData: { fileUri, mimeType } },
          { text: "Верни JSON по схеме из инструкции." },
        ],
      },
    ],
  });
  const text = response.text;
  if (!text) {
    throw new Error("Empty response from Gemini");
  }
  const parsed = analyzeSchema.parse(JSON.parse(extractJson(text)));
  return {
    category: parsed.category,
    confidence: parsed.confidence,
    description: parsed.description,
    categories: [
      {
        category: parsed.category,
        confidence: parsed.confidence,
        description: parsed.description,
      },
    ],
  };
}

export async function analyzeIncidentVideo(videoUrl: string): Promise<AnalyzeResult> {
  const env = getEnv();
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const { buffer, mimeType } = await downloadVideo(videoUrl);
  const { uri, mimeType: uploadedMime, fileName } = await uploadVideoToGemai(
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

  const msg = lastError instanceof Error ? lastError.message : "Analysis failed";
  throw new Error(msg);
}
