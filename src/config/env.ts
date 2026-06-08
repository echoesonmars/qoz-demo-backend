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
    INCIDENT_ANALYZE_MODE: z.enum(["gemini", "vision"]).default("vision"),
    INCIDENT_VISION_MAX_FRAMES: z.coerce.number().int().min(0).max(10_000).default(0),
    INCIDENT_VISION_ALL_FRAMES: z
      .string()
      .optional()
      .default("true")
      .transform((s) => {
        const v = s.trim().toLowerCase();
        return v !== "false" && v !== "0" && v !== "no";
      }),
    INCIDENT_VISION_SAMPLE_FPS: z.coerce.number().min(0.2).max(60).default(1),
    INCIDENT_VISION_MIN_CONF: z.coerce.number().min(0).max(1).default(0.4),
    INCIDENT_ANALYZE_TMP_DIR: z.string().optional().default(""),
    INCIDENT_ANALYZE_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
    LESSON_ANALYZE_MODE: z.enum(["gemini", "pipeline"]).default("gemini"),
    LESSON_ANALYZE_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),
    LESSON_ANALYZE_TMP_DIR: z.string().optional().default(""),
    LOCAL_WHISPER_URL: z.string().optional().default("http://localhost:8000/api/transcribe"),
    LOCAL_VISION_URL: z.string().optional().default(""),
    LOCAL_LLM_URL: z.string().optional().default("http://localhost:8001/v1/chat/completions"),
    LESSON_WHISPER_PLACEHOLDER: z
      .string()
      .optional()
      .default("true")
      .transform((s) => {
        const v = s.trim().toLowerCase();
        return v !== "false" && v !== "0" && v !== "no";
      }),
    LESSON_LLM_PLACEHOLDER: z
      .string()
      .optional()
      .default("true")
      .transform((s) => {
        const v = s.trim().toLowerCase();
        return v !== "false" && v !== "0" && v !== "no";
      }),
    LESSON_VISION_SAMPLE_SEC: z.coerce.number().int().min(1).max(120).default(10),
    LESSON_LOG_WINDOW_SEC: z.coerce.number().int().min(60).max(900).default(300),
    LESSON_VISION_MAX_CONCURRENT: z.coerce.number().int().min(1).max(32).default(4),
    LESSON_VISION_RUN_ALL_SPECIALIZED: z
      .string()
      .optional()
      .default("false")
      .transform((s) => {
        const v = s.trim().toLowerCase();
        return v === "true" || v === "1" || v === "yes";
      }),
    LESSON_LOG_MAX_CHARS: z.coerce.number().int().min(10_000).max(500_000).default(120_000),
    LESSON_LOG_TAIL_PRESERVE_SEC: z.coerce.number().int().min(60).max(3600).default(600),
    LESSON_LLM_MODEL: z.string().default("Qwen/Qwen2.5-32B-Instruct-AWQ"),
    LESSON_LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    LESSON_PIPELINE_SAVE_DEBUG_LOG: z
      .string()
      .optional()
      .default("false")
      .transform((s) => {
        const v = s.trim().toLowerCase();
        return v === "true" || v === "1" || v === "yes";
      }),
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
    if (e.INCIDENT_ANALYZE_MODE === "vision" && !e.VISION_LIVE_URL.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "VISION_LIVE_URL is required when INCIDENT_ANALYZE_MODE is vision",
        path: ["VISION_LIVE_URL"],
      });
    }
    if (e.LESSON_ANALYZE_MODE === "pipeline") {
      const visionUrl = e.LOCAL_VISION_URL.trim() || e.VISION_LIVE_URL.trim();
      if (!visionUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "LOCAL_VISION_URL or VISION_LIVE_URL is required when LESSON_ANALYZE_MODE is pipeline",
          path: ["LOCAL_VISION_URL"],
        });
      }
      if (!e.LESSON_LLM_PLACEHOLDER && !e.LOCAL_LLM_URL.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "LOCAL_LLM_URL is required when LESSON_LLM_PLACEHOLDER is false",
          path: ["LOCAL_LLM_URL"],
        });
      }
      if (!e.LESSON_WHISPER_PLACEHOLDER && !e.LOCAL_WHISPER_URL.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "LOCAL_WHISPER_URL is required when LESSON_WHISPER_PLACEHOLDER is false",
          path: ["LOCAL_WHISPER_URL"],
        });
      }
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
