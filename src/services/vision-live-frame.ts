import { randomUUID } from "node:crypto";

import { getEnv } from "../config/env.js";
import type { LiveAnalysisPayload } from "../types/live-analysis.js";
import { visionFrameAnalysisDtoSchema } from "../types/vision-frame-dto.js";
import { recordVisionHttpError } from "./live-metrics.js";
import { formatUserFacingVisionError } from "./vision-error-format.js";
import { mapVisionDtoToLivePayload } from "./vision-map-live-payload.js";

export type VisionFrameRequestContext = {
  sessionId?: string;
  deviceId?: string;
};

function visionBaseUrl(): string {
  return getEnv().VISION_LIVE_URL.trim().replace(/\/$/, "");
}

function mergeSignal(timeoutMs: number, outer?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs);
  if (!outer) {
    return t;
  }
  return AbortSignal.any([t, outer]);
}

export async function analyzeLiveFrameWithVision(
  jpeg: Buffer,
  signal?: AbortSignal,
  ctx?: VisionFrameRequestContext,
): Promise<LiveAnalysisPayload | null> {
  const env = getEnv();
  if (env.VISION_LIVE_MODE === "off") {
    return null;
  }
  const base = visionBaseUrl();
  if (!base) {
    throw new Error("VISION_LIVE_URL is not configured");
  }

  const url = `${base}/api/analyze/frame`;
  const retries = env.VISION_LIVE_MAX_RETRIES;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const t0 = Date.now();
    try {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "frame.jpg");
      const headers: Record<string, string> = { "X-Request-Id": randomUUID() };
      if (ctx?.sessionId) {
        headers["X-Session-Id"] = ctx.sessionId;
      }
      if (ctx?.deviceId) {
        headers["X-Device-Id"] = ctx.deviceId;
      }
      const secret = env.VISION_INTERNAL_SECRET.trim();
      if (secret) {
        headers["X-Vision-Internal-Secret"] = secret;
      }

      const res = await fetch(url, {
        method: "POST",
        body: form,
        headers,
        signal: mergeSignal(env.VISION_LIVE_TIMEOUT_MS, signal),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        recordVisionHttpError({
          deviceId: ctx?.deviceId,
          sessionId: ctx?.sessionId,
          status: res.status,
          durationMs: Date.now() - t0,
        });
        const err = new Error(`vision HTTP ${res.status}: ${text.slice(0, 400)}`);
        throw err;
      }

      const json: unknown = await res.json();
      const dtoParsed = visionFrameAnalysisDtoSchema.safeParse(json);
      if (!dtoParsed.success) {
        lastErr = new Error(`vision DTO: ${dtoParsed.error.message}`);
        continue;
      }

      let payload: LiveAnalysisPayload;
      try {
        payload = mapVisionDtoToLivePayload(dtoParsed.data);
      } catch (e) {
        lastErr = e;
        continue;
      }

      return payload;
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) {
        break;
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }

  if (lastErr) {
    throw new Error(formatUserFacingVisionError(lastErr));
  }
  return null;
}

export function isVisionLiveEnabled(): boolean {
  return getEnv().VISION_LIVE_MODE !== "off" && getEnv().VISION_LIVE_URL.trim().length > 0;
}
