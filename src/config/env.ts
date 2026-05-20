import { z } from "zod";

const bootSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().min(1).default("0.0.0.0"),
});

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(8080),
    HOST: z.string().min(1).default("0.0.0.0"),
    DATABASE_URL: z.string().min(1),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_ANALYZE_MODEL: z.string().default("gemini-3.1-flash-lite"),
    GEMINI_LIVE_MODEL: z.string().default("gemini-3.1-flash-live-preview"),
    GEMINI_LIVE_FRAME_MODEL: z.string().default("gemini-3.1-flash-lite"),
    GEMINI_LIVE_MODE: z.enum(["auto", "mock", "live"]).default("auto"),
    VISION_LIVE_URL: z.string().optional().default(""),
    VISION_LIVE_MODE: z.enum(["off", "live", "fallback"]).default("off"),
    VISION_LIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    VISION_LIVE_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
    VISION_LIVE_MAX_CONCURRENT: z.coerce.number().int().min(1).default(4),
    VISION_INTERNAL_SECRET: z.string().optional().default(""),
    VISION_LIVE_DRIVER: z.enum(["off", "on"]).default("off"),
    SUPABASE_S3_ACCESS_KEY_ID: z.string().min(1),
    SUPABASE_S3_SECRET_ACCESS_KEY: z.string().min(1),
    SUPABASE_S3_ENDPOINT: z.string().url(),
    SUPABASE_S3_REGION: z.string().default("ap-south-1"),
    STORAGE_BUCKET: z.string().default("records"),
    BACKEND_INTERNAL_SECRET: z.string().min(16),
    ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  })
  .superRefine((e, ctx) => {
    const driverOn = e.VISION_LIVE_DRIVER === "on";
    if (driverOn && !e.VISION_LIVE_URL.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "VISION_LIVE_URL is required when VISION_LIVE_DRIVER is on",
        path: ["VISION_LIVE_URL"],
      });
    }
    if (!driverOn && e.VISION_LIVE_MODE !== "off" && !e.VISION_LIVE_URL.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "VISION_LIVE_URL is required when VISION_LIVE_MODE is not off",
        path: ["VISION_LIVE_URL"],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
export type BootConfig = z.infer<typeof bootSchema>;

let cached: Env | null = null;

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

export function getBootConfig(): BootConfig {
  return bootSchema.parse(process.env);
}

export function getEnv(): Env {
  if (!cached) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      throw new Error(`Invalid environment:\n${formatZodError(result.error)}`);
    }
    cached = result.data;
  }
  return cached;
}

export function getAllowedOrigins(): string[] {
  return getEnv()
    .ALLOWED_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}
