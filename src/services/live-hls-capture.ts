import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);

const FFMPEG_TIMEOUT_MS = 28_000;

export function resolveFfmpegPath(): string {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) return fromEnv;
  try {
    const bundled = require("ffmpeg-static") as string | undefined;
    if (bundled) return bundled;
  } catch {
    return "ffmpeg";
  }
  return "ffmpeg";
}

function isTransientCaptureError(message: string): boolean {
  return /Failed to resolve hostname|name resolution|Input\/output error|FFmpeg timeout|Connection refused|Connection timed out/i.test(
    message,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function captureHlsFrameWithRetry(
  hlsUrl: string,
  signal?: AbortSignal,
  attempts = 4,
): Promise<Buffer> {
  let last: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) {
      throw new Error("Capture aborted");
    }
    try {
      return await captureHlsFrame(hlsUrl, signal);
    } catch (err) {
      last = err instanceof Error ? err : new Error(String(err));
      if (!isTransientCaptureError(last.message) || i === attempts - 1) {
        throw last;
      }
      await sleep(2000 * (i + 1));
    }
  }
  throw last ?? new Error("Capture failed");
}

export function captureHlsFrame(hlsUrl: string, signal?: AbortSignal): Promise<Buffer> {
  const ffmpeg = resolveFfmpegPath();
  return new Promise((resolve, reject) => {
    const proc = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        hlsUrl,
        "-vframes",
        "1",
        "-f",
        "image2",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const chunks: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("FFmpeg timeout"));
    }, FFMPEG_TIMEOUT_MS);

    const onAbort = () => {
      proc.kill("SIGKILL");
      reject(new Error("Capture aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if ("code" in err && err.code === "ENOENT") {
        reject(
          new Error(
            "FFmpeg не найден. Установите ffmpeg в PATH или задайте FFMPEG_PATH / пересоберите backend с ffmpeg-static.",
          ),
        );
        return;
      }
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0 || chunks.length === 0) {
        reject(new Error(stderr.trim() || `FFmpeg exited with code ${code ?? "unknown"}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}
