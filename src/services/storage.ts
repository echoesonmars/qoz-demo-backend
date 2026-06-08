import {
  CopyObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import https from "node:https";
import { getEnv } from "../config/env.js";

const S3_REQUEST_TIMEOUT_MS = 600_000;
const S3_UPLOAD_RETRIES = 4;

function isS3TransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /bad record mac|SSL routines|ECONNRESET|ETIMEDOUT|socket hang up|EPIPE/i.test(msg);
}

async function withS3Retry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < S3_UPLOAD_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isS3TransientError(err) || attempt >= S3_UPLOAD_RETRIES - 1) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw last;
}

export function createS3Client(): S3Client {
  const env = getEnv();
  return new S3Client({
    forcePathStyle: true,
    region: env.SUPABASE_S3_REGION,
    endpoint: env.SUPABASE_S3_ENDPOINT,
    credentials: {
      accessKeyId: env.SUPABASE_S3_ACCESS_KEY_ID,
      secretAccessKey: env.SUPABASE_S3_SECRET_ACCESS_KEY,
    },
    requestHandler: new NodeHttpHandler({
      httpsAgent: new https.Agent({ keepAlive: false, maxSockets: 1 }),
      connectionTimeout: 30_000,
      requestTimeout: S3_REQUEST_TIMEOUT_MS,
    }),
  });
}

export async function presignStorageUpload(
  storagePath: string,
  contentType: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const env = getEnv();
  const client = createS3Client();
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: storagePath,
      ContentType: contentType,
    }),
    { expiresIn: expiresInSeconds },
  );
}

export async function presignIncidentVideo(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const env = getEnv();
  const client = createS3Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: storagePath,
    }),
    { expiresIn: expiresInSeconds },
  );
}

export async function uploadStorageObject(
  storagePath: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const env = getEnv();
  const client = createS3Client();
  await withS3Retry(() =>
    client.send(
      new PutObjectCommand({
        Bucket: env.STORAGE_BUCKET,
        Key: storagePath,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
      }),
    ),
  );
}

export async function uploadStorageFile(
  storagePath: string,
  localFilePath: string,
  contentType: string,
): Promise<number> {
  const stat = await fs.stat(localFilePath);
  const env = getEnv();
  const client = createS3Client();
  await withS3Retry(() =>
    client.send(
      new PutObjectCommand({
        Bucket: env.STORAGE_BUCKET,
        Key: storagePath,
        Body: createReadStream(localFilePath),
        ContentType: contentType,
        ContentLength: stat.size,
      }),
    ),
  );
  return stat.size;
}

export async function copyStorageObject(
  fromPath: string,
  toPath: string,
): Promise<void> {
  const env = getEnv();
  const client = createS3Client();
  await client.send(
    new CopyObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      CopySource: `${env.STORAGE_BUCKET}/${fromPath}`,
      Key: toPath,
    }),
  );
}
