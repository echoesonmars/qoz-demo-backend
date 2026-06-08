import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { getEnv } from "../config/env.js";
import { validateReservedStoragePath } from "../lib/storage-path.js";
import { uploadStorageFile } from "../services/storage.js";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

function storagePrefixFromPath(storagePath: string): "incidents" | "lessons" | null {
  if (storagePath.startsWith("incidents/")) return "incidents";
  if (storagePath.startsWith("lessons/")) return "lessons";
  return null;
}

export async function storageUploadRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  app.post("/api/storage/upload", async (request, reply) => {
    const secret = request.headers["x-backend-secret"];
    if (secret !== getEnv().BACKEND_INTERNAL_SECRET) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    let storagePath = "";
    let contentType = "video/mp4";
    let tmpPath = "";
    let bytesWritten = 0;

    try {
      for await (const part of request.parts()) {
        if (part.type === "field") {
          const v = String(part.value ?? "").trim();
          if (part.fieldname === "storagePath") storagePath = v;
          if (part.fieldname === "contentType" && v) contentType = v;
          continue;
        }
        if (part.type !== "file" || part.fieldname !== "file") {
          continue;
        }
        tmpPath = path.join(os.tmpdir(), `qoz-upload-${randomUUID()}`);
        await pipeline(part.file, createWriteStream(tmpPath));
        const stat = await fs.stat(tmpPath);
        bytesWritten = stat.size;
      }

      if (!storagePath || !tmpPath) {
        return reply.code(400).send({ error: "file and storagePath required" });
      }

      const prefix = storagePrefixFromPath(storagePath);
      if (!prefix || !validateReservedStoragePath(storagePath, prefix)) {
        return reply.code(400).send({ error: "Invalid storagePath" });
      }

      if (bytesWritten <= 0) {
        return reply.code(400).send({ error: "Empty file" });
      }
      if (bytesWritten > MAX_UPLOAD_BYTES) {
        return reply.code(413).send({ error: "File too large" });
      }

      await uploadStorageFile(storagePath, tmpPath, contentType);
      return reply.send({ ok: true, storagePath, bytes: bytesWritten });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      request.log.error({ err: e, storagePath }, "storage upload failed");
      return reply.code(503).send({ error: msg });
    } finally {
      if (tmpPath) {
        await fs.unlink(tmpPath).catch(() => undefined);
      }
    }
  });
}
