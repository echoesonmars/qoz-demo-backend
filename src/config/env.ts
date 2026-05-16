import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_ANALYZE_MODEL: z.string().default("gemini-3.1-flash-lite"),
  GEMINI_LIVE_MODEL: z.string().default("gemini-3.1-flash-live-preview"),
  GEMINI_LIVE_MODE: z.enum(["auto", "mock", "live"]).default("auto"),
  SUPABASE_S3_ACCESS_KEY_ID: z.string().min(1),
  SUPABASE_S3_SECRET_ACCESS_KEY: z.string().min(1),
  SUPABASE_S3_ENDPOINT: z.string().url(),
  SUPABASE_S3_REGION: z.string().default("ap-south-1"),
  STORAGE_BUCKET: z.string().default("records"),
  BACKEND_INTERNAL_SECRET: z.string().min(16),
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) {
    cached = envSchema.parse(process.env);
  }
  return cached;
}

export function getAllowedOrigins(): string[] {
  return getEnv()
    .ALLOWED_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}
