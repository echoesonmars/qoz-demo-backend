import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getEnv } from "../config/env.js";
import { resolveFfmpegPath } from "./live-hls-capture.js";
import { downloadVideo } from "./video-download.js";

function incidentTmpRoot(): string {
  const custom = getEnv().INCIDENT_ANALYZE_TMP_DIR.trim();
  return custom || os.tmpdir();
}

export function incidentVideoScaleFilter(allFrames: boolean, sampleFps: number): string {
  if (allFrames) {
    return "scale=640:480";
  }
  return `fps=${sampleFps},scale=640:480`;
}

function runFfmpegExtractFrames(
  sourcePath: string,
  outPattern: string,
  vf: string,
  maxFrames: number,
  signal?: AbortSignal,
): Promise<void> {
  const ffmpeg = resolveFfmpegPath();
  const timeoutMs = getEnv().INCIDENT_ANALYZE_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      sourcePath,
      "-vf",
      vf,
    ];
    if (maxFrames > 0) {
      args.push("-frames:v", String(maxFrames));
    }
    args.push(outPattern);

    const proc = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("FFmpeg incident extract timeout"));
    }, timeoutMs);

    const onAbort = () => {
      proc.kill("SIGKILL");
      reject(new Error("Incident analyze aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `FFmpeg exited with code ${code ?? "unknown"}`));
        return;
      }
      resolve();
    });
  });
}

async function readFrameJpegs(dir: string): Promise<Buffer[]> {
  const names = await fs.readdir(dir);
  const frames = names
    .filter((n) => /^frame_\d+\.jpg$/i.test(n))
    .sort((a, b) => a.localeCompare(b));
  const out: Buffer[] = [];
  for (const name of frames) {
    const buf = await fs.readFile(path.join(dir, name));
    if (buf.length > 0) {
      out.push(buf);
    }
  }
  return out;
}

export async function extractIncidentVideoFrameBuffers(
  videoUrl: string,
  signal?: AbortSignal,
): Promise<Buffer[]> {
  const env = getEnv();
  const maxFrames = env.INCIDENT_VISION_MAX_FRAMES;
  const sampleFps = env.INCIDENT_VISION_SAMPLE_FPS;
  const allFrames = env.INCIDENT_VISION_ALL_FRAMES;
  const vf = incidentVideoScaleFilter(allFrames, sampleFps);

  const workDir = await fs.mkdtemp(path.join(incidentTmpRoot(), "qoz-incident-"));
  try {
    const { buffer } = await downloadVideo(videoUrl, signal);
    const sourcePath = path.join(workDir, "source.mp4");
    await fs.writeFile(sourcePath, buffer);
    const outPattern = path.join(workDir, "frame_%04d.jpg");
    await runFfmpegExtractFrames(sourcePath, outPattern, vf, maxFrames, signal);
    const frames = await readFrameJpegs(workDir);
    if (frames.length === 0) {
      throw new Error("No frames extracted from incident video");
    }
    return frames;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
