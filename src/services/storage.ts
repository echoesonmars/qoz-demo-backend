import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "../config/env.js";

function createS3Client(): S3Client {
  const env = getEnv();
  return new S3Client({
    forcePathStyle: true,
    region: env.SUPABASE_S3_REGION,
    endpoint: env.SUPABASE_S3_ENDPOINT,
    credentials: {
      accessKeyId: env.SUPABASE_S3_ACCESS_KEY_ID,
      secretAccessKey: env.SUPABASE_S3_SECRET_ACCESS_KEY,
    },
  });
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
