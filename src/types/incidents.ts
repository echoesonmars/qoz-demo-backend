export type IncidentCategory =
  | "fight"
  | "weapon"
  | "smoking"
  | "intruder"
  | "pending";

export type IncidentRow = {
  id: string;
  category: IncidentCategory;
  storage_path: string;
  title: string | null;
  camera_label: string | null;
  description: string | null;
  confidence: number | null;
  created_at: string;
};

export type AnalyzeResult = {
  category: Exclude<IncidentCategory, "pending">;
  confidence: number;
  description: string;
};
