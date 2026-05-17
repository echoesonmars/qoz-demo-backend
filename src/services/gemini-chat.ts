import { GoogleGenAI } from "@google/genai";
import { getEnv } from "../config/env.js";
import { agentChatSystemPrompt } from "../prompts/agent-chat.js";

export type ChatTurn = {
  role: "user" | "agent";
  body: string;
};

function analyzeModels(): string[] {
  const env = getEnv();
  const fallbacks = (process.env.GEMINI_ANALYZE_FALLBACK_MODELS ?? "gemini-2.5-flash,gemini-2.0-flash")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([env.GEMINI_ANALYZE_MODEL, ...fallbacks])];
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

function toGeminiContents(messages: ChatTurn[]) {
  return messages.map((m) => ({
    role: m.role === "user" ? ("user" as const) : ("model" as const),
    parts: [{ text: m.body }],
  }));
}

async function generateReply(ai: GoogleGenAI, model: string, messages: ChatTurn[]): Promise<string> {
  const response = await ai.models.generateContent({
    model,
    config: { systemInstruction: agentChatSystemPrompt },
    contents: toGeminiContents(messages),
  });
  const text = response.text?.trim();
  if (!text) {
    throw new Error("Empty response from Gemini");
  }
  return text;
}

export async function runAgentChat(messages: ChatTurn[]): Promise<string> {
  const env = getEnv();
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") {
    throw new Error("Last message must be from user");
  }

  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const models = analyzeModels();
  let lastError: unknown;

  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await generateReply(ai, model, messages);
      } catch (err) {
        lastError = err;
        if (!isRetryableError(err) || attempt === 2) break;
        await sleep(1500 * (attempt + 1));
      }
    }
  }

  const msg = lastError instanceof Error ? lastError.message : "Chat failed";
  throw new Error(msg);
}
