import { z } from "zod";

export const visionFrameDetectionSchema = z.object({
  label: z.string(),
  qoz_incident: z.string(),
  confidence: z.coerce.number(),
  bbox: z.array(z.coerce.number()).length(4),
  source_model: z.string().optional(),
  message: z.string().optional(),
});

export const visionFrameActionSchema = z.object({
  type: z.string(),
  bbox: z.array(z.coerce.number()).length(4),
});

export const visionFrameStatsSchema = z.object({
  looking_at_board: z.coerce.number().optional(),
  sleeping: z.coerce.number().optional(),
  total_students: z.coerce.number().optional(),
});

export const visionFrameAnalysisDtoSchema = z.object({
  detections: z.array(visionFrameDetectionSchema),
  actions: z.array(visionFrameActionSchema),
  engagement: z.coerce.number(),
  stats: visionFrameStatsSchema.optional(),
});

export type VisionFrameAnalysisDto = z.infer<typeof visionFrameAnalysisDtoSchema>;
export type VisionFrameDetection = z.infer<typeof visionFrameDetectionSchema>;
export type VisionFrameAction = z.infer<typeof visionFrameActionSchema>;

export const VISION_LIVE_UNDETECTED_INCIDENT_TYPES = ["wanted_person", "anpr"] as const;
