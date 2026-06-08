import type { IncidentCategoryId } from "../constants/incident-categories.js";

export type IncidentCategory = IncidentCategoryId | "pending" | "intruder";

export type IncidentAnalysisStatus = "processing" | "failed" | "completed";

export type IncidentCategoryHit = {
  category: IncidentCategoryId;
  confidence: number;
  description: string;
};

export type IncidentRow = {
  id: string;
  category: IncidentCategory;
  analysis_status?: IncidentAnalysisStatus;
  error_message?: string | null;
  storage_path: string;
  title: string | null;
  camera_label: string | null;
  description: string | null;
  confidence: number | null;
  detected_categories?: IncidentCategoryHit[];
  created_at: Date | string;
};

export type AnalyzeResult = {
  category: IncidentCategoryId;
  confidence: number;
  description: string;
  categories?: IncidentCategoryHit[];
};
