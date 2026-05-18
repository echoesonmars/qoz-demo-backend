import { z } from "zod";
import { INCIDENT_CATEGORY_IDS } from "../constants/incident-categories.js";

const incidentConfidence = z.enum(["high", "medium", "low"]);

export const liveDetectedIncidentSchema = z.object({
  type: z.enum(INCIDENT_CATEGORY_IDS),
  confidence: incidentConfidence,
  location_context: z.string().optional().default(""),
  description: z.string().min(1),
  timestamp_marker: z.string().optional().default("frame_static"),
});

export const liveAnalysisPayloadSchema = z.object({
  analytics_meta: z.object({
    target_language: z.string(),
    overall_engagement_score: z.coerce.number().min(0).max(100),
  }),
  classroom_visual_behavior: z.object({
    students_count_detected: z.coerce.number().int().min(0),
    active_phone_users: z.coerce.number().int().min(0),
    sleeping_count: z.coerce.number().int().min(0),
    general_focus_description: z.string(),
  }),
  detected_incidents: z.array(liveDetectedIncidentSchema),
});

export type LiveAnalysisPayload = z.infer<typeof liveAnalysisPayloadSchema>;
export type LiveDetectedIncident = z.infer<typeof liveDetectedIncidentSchema>;

export type LiveMonitorSessionRow = {
  id: string;
  device_id: string;
  camera_id: string | null;
  hls_url: string;
  status: "running" | "stopped" | "error";
  started_at: Date;
  stopped_at: Date | null;
  frame_count: number;
  last_frame_at: Date | null;
  error_message: string | null;
};

export type LiveSnapshotRow = {
  id: string;
  session_id: string;
  device_id: string;
  captured_at: Date;
  payload: LiveAnalysisPayload;
  engagement_score: number | null;
  incident_count: number;
  session_offset_sec: number | null;
};

export type LiveIncidentEventRow = {
  id: string;
  snapshot_id: string;
  session_id: string;
  device_id: string;
  captured_at: Date;
  incident_type: string;
  confidence: string;
  location_context: string | null;
  description: string;
  timestamp_marker: string | null;
};
