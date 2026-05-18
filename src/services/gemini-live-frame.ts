import { GoogleGenAI } from "@google/genai";
import { getEnv } from "../config/env.js";
import { buildClassroomVisualLivePrompt } from "../prompts/classroom-visual-live.js";
import { parseLiveAnalysisPayload } from "./live-analysis-parse.js";
import type { LiveAnalysisPayload } from "../types/live-analysis.js";

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

function liveFrameAnalyzeModels(): string[] {
  const env = getEnv();
  const fallbacks = (process.env.GEMINI_LIVE_FRAME_FALLBACK_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([env.GEMINI_LIVE_FRAME_MODEL, ...fallbacks])];
}

export async function analyzeLiveFrame(jpeg: Buffer): Promise<LiveAnalysisPayload | null> {
  const env = getEnv();
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const prompt = buildClassroomVisualLivePrompt("ru");
  const base64 = jpeg.toString("base64");
  let lastError: unknown;

  for (const model of liveFrameAnalyzeModels()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: base64,
                  },
                },
                { text: "Верни только JSON по схеме из инструкции." },
              ],
            },
          ],
        });
        const text = response.text;
        if (!text) {
          lastError = new Error("Empty Gemini response");
          continue;
        }
        const parsed = parseLiveAnalysisPayload(text);
        if (parsed) return parsed;
        lastError = new Error("Invalid JSON from Gemini");
      } catch (err) {
        lastError = err;
        if (!isRetryableError(err) || attempt === 1) break;
        await sleep(1200 * (attempt + 1));
      }
    }
  }

  if (lastError instanceof Error) {
    const models = liveFrameAnalyzeModels().join(", ");
    throw new Error(`${lastError.message} (модели снимков: ${models})`);
  }
  return null;
}
