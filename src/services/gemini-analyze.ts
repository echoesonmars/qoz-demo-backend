import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { incidentAnalyzeSystemPrompt } from "../prompts/incident-analyze.js";
import type { AnalyzeResult } from "../types/incidents.js";

const analyzeSchema = z.object({
  category: z.enum(["fight", "weapon", "smoking", "intruder"]),
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

export async function analyzeIncidentVideo(videoUrl: string): Promise<AnalyzeResult> {
  const env = getEnv();
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: env.GEMINI_ANALYZE_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: incidentAnalyzeSystemPrompt },
          {
            fileData: {
              fileUri: videoUrl,
              mimeType: "video/mp4",
            },
          },
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
  return parsed;
}
