import type { WebSocket } from "ws";
import { getEnv } from "../config/env.js";
import { incidentLiveSystemPrompt } from "../prompts/incident-live.js";
import { buildMockOverlay, recordLiveFrame } from "./fleet-registry.js";
import type { StreamOverlayMessage } from "../types/overlay.js";

function shouldUseMock(): boolean {
  const env = getEnv();
  if (env.GEMINI_LIVE_MODE === "mock") return true;
  if (env.GEMINI_LIVE_MODE === "live") return false;
  return !env.GEMINI_API_KEY;
}

function normalizeGeminiPayload(raw: string): StreamOverlayMessage | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (v.type === "overlay" && Array.isArray(v.boxes)) {
      return v as StreamOverlayMessage;
    }
    const boxes = v.boxes ?? v.detections;
    if (Array.isArray(boxes)) {
      return {
        type: "overlay",
        boxes: boxes as StreamOverlayMessage["boxes"],
        caption: typeof v.caption === "string" ? v.caption : undefined,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function attachLiveSession(
  clientSocket: WebSocket,
  deviceId: string,
): () => void {
  let mockTimer: ReturnType<typeof setInterval> | null = null;
  let upstream: WebSocket | null = null;

  const cleanup = () => {
    if (mockTimer) clearInterval(mockTimer);
    mockTimer = null;
    if (upstream && upstream.readyState <= 1) {
      upstream.close();
    }
    upstream = null;
  };

  if (shouldUseMock()) {
    mockTimer = setInterval(() => {
      if (clientSocket.readyState !== 1) return;
      recordLiveFrame(deviceId);
      clientSocket.send(JSON.stringify(buildMockOverlay()));
    }, 400);
    return cleanup;
  }

  const env = getEnv();
  const model = env.GEMINI_LIVE_MODEL;
  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${env.GEMINI_API_KEY}`;

  import("ws").then(({ WebSocket: WS }) => {
      upstream = new WS(url);
      upstream.on("open", () => {
        upstream?.send(
          JSON.stringify({
            setup: {
              model: `models/${model}`,
              systemInstruction: {
                parts: [{ text: incidentLiveSystemPrompt }],
              },
              generationConfig: { responseModalities: ["TEXT"] },
            },
          }),
        );
      });
      upstream.on("message", (data) => {
        const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        const overlay = normalizeGeminiPayload(raw);
        if (overlay && clientSocket.readyState === 1) {
          recordLiveFrame(deviceId);
          clientSocket.send(JSON.stringify(overlay));
        }
      });
      upstream.on("error", () => {
        if (mockTimer) return;
        mockTimer = setInterval(() => {
          if (clientSocket.readyState !== 1) return;
          recordLiveFrame(deviceId);
          clientSocket.send(JSON.stringify(buildMockOverlay()));
        }, 400);
      });
    })
    .catch(() => {
      mockTimer = setInterval(() => {
        if (clientSocket.readyState !== 1) return;
        recordLiveFrame(deviceId);
        clientSocket.send(JSON.stringify(buildMockOverlay()));
      }, 400);
    });

  clientSocket.on("message", (data) => {
    recordLiveFrame(deviceId);
    if (upstream?.readyState === 1) {
      upstream.send(data);
    }
  });

  return cleanup;
}
