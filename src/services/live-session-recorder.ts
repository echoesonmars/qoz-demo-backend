import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveFfmpegPath } from "./live-hls-capture.js";
import { buildFfmpegHlsInput } from "./live-hls-url.js";

type RecorderHandle = {
  proc: ChildProcess;
  filePath: string;
};

const recorders = new Map<string, RecorderHandle>();

function tmpDir(): string {
  return process.env.LIVE_RECORDING_TMP_DIR?.trim() || os.tmpdir();
}

export function recordingFilePath(sessionId: string): string {
  return path.join(tmpDir(), `live-${sessionId}.mp4`);
}

export function startSessionRecording(sessionId: string, hlsUrl: string): void {
  stopSessionRecording(sessionId);
  const filePath = recordingFilePath(sessionId);
  const ffmpeg = resolveFfmpegPath();
  const { preInputArgs, inputUrl } = buildFfmpegHlsInput(hlsUrl);
  const proc = spawn(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      ...preInputArgs,
      "-i",
      inputUrl,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      "-y",
      filePath,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  recorders.set(sessionId, { proc, filePath });
}

function waitExit(proc: ChildProcess, ms: number): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    proc.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

export async function stopSessionRecording(
  sessionId: string,
): Promise<{ filePath: string | null; bytes: number }> {
  const handle = recorders.get(sessionId);
  if (!handle) {
    const filePath = recordingFilePath(sessionId);
    try {
      const stat = await fs.stat(filePath);
      return { filePath, bytes: stat.size };
    } catch {
      return { filePath: null, bytes: 0 };
    }
  }
  recorders.delete(sessionId);
  handle.proc.kill("SIGINT");
  await waitExit(handle.proc, 25_000);
  try {
    const stat = await fs.stat(handle.filePath);
    return { filePath: handle.filePath, bytes: stat.size };
  } catch {
    return { filePath: null, bytes: 0 };
  }
}

export function stopAllSessionRecordings(): void {
  for (const sessionId of [...recorders.keys()]) {
    const handle = recorders.get(sessionId);
    if (handle) {
      handle.proc.kill("SIGKILL");
      recorders.delete(sessionId);
    }
  }
}

export function countActiveRecorders(): number {
  return recorders.size;
}

export function pruneOrphanRecorders(runningSessionIds: ReadonlySet<string>): number {
  let removed = 0;
  for (const sessionId of [...recorders.keys()]) {
    if (runningSessionIds.has(sessionId)) continue;
    const handle = recorders.get(sessionId);
    if (handle) {
      handle.proc.kill("SIGKILL");
      recorders.delete(sessionId);
      removed += 1;
    }
  }
  return removed;
}
