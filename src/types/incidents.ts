import type { IncidentCategoryId } from "../constants/incident-categories.js";

export type IncidentCategory = IncidentCategoryId | "pending" | "intruder";

export type IncidentRow = {
  id: string;
  category: IncidentCategory;
  storage_path: string;
  title: string | null;
  camera_label: string | null;
  description: string | null;
  confidence: number | null;
  created_at: Date | string;
};

export type AnalyzeResult = {
  category: IncidentCategoryId;
  confidence: number;
  description: string;
};
