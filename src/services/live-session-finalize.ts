import fs from "node:fs/promises";
import type { FastifyBaseLogger } from "fastify";
import {
  getSessionById,
  updateSessionRecording,
} from "./live-monitor-db.js";
import { recordingFilePath, stopSessionRecording } from "./live-session-recorder.js";
import { uploadStorageFile } from "./storage.js";

export async function finalizeSessionRecording(
  sessionId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const session = await getSessionById(sessionId);
  if (!session) return;

  await updateSessionRecording({
    sessionId,
    storagePath: null,
    durationSec: null,
    bytes: null,
    uploadStatus: "uploading",
  });

  const { filePath, bytes } = await stopSessionRecording(sessionId);
  if (!filePath || bytes <= 0) {
    await updateSessionRecording({
      sessionId,
      storagePath: null,
      durationSec: null,
      bytes: 0,
      uploadStatus: "failed",
      errorMessage: "Запись видео не создана",
    });
    return;
  }

  const storagePath = `live-recordings/${sessionId}.mp4`;
  try {
    await uploadStorageFile(storagePath, filePath, "video/mp4");
    const durationSec = session.stopped_at
      ? Math.max(
          0,
          Math.floor(
            (session.stopped_at.getTime() - session.started_at.getTime()) / 1000,
          ),
        )
      : null;
    await updateSessionRecording({
      sessionId,
      storagePath,
      durationSec,
      bytes,
      uploadStatus: "ready",
    });
    log.info({ sessionId, bytes, storagePath }, "live recording uploaded");
  } catch (err) {
    log.error({ err, sessionId }, "live recording upload failed");
    await updateSessionRecording({
      sessionId,
      storagePath: null,
      durationSec: null,
      bytes,
      uploadStatus: "failed",
      errorMessage: err instanceof Error ? err.message : "Upload failed",
    });
  } finally {
    const path = filePath ?? recordingFilePath(sessionId);
    await fs.unlink(path).catch(() => {});
  }
}
