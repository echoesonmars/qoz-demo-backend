export type LessonLanguage = "kk" | "ru" | "en";

export type LessonStatus = "pending" | "ready" | "failed";

export type LessonOverview = {
  duration: string;
  overall_engagement_score: number;
  pedagogical_style: string;
  presentation_sync: string;
};

export type LessonTimePhase = {
  phase: string;
  start_time: string;
  end_time: string;
  description: string;
};

export type LessonIncidentSummary = {
  type: string;
  count: number;
  severity: string;
  description: string;
};

export type LessonTimelineEvent = {
  timestamp: string;
  event_type: string;
  description: string;
};

export type LessonAnalysisReport = {
  detected_language: LessonLanguage;
  lesson_overview: LessonOverview;
  time_management: LessonTimePhase[];
  incidents_summary: LessonIncidentSummary[];
  timeline: LessonTimelineEvent[];
};

export type LessonRow = {
  id: string;
  status: LessonStatus;
  storage_path: string;
  title: string | null;
  detected_language: LessonLanguage | null;
  analysis: LessonAnalysisReport | null;
  error_message: string | null;
  created_at: Date | string;
  source_live_session_id?: string | null;
};
