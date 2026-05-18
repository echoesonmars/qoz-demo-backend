type MetricSample = {
  at: string;
  kind: "ingest_tick" | "dashboard" | "gemini_429";
  deviceId?: string;
  sessionId?: string;
  durationMs: number;
  extra?: Record<string, string | number | boolean>;
};

const MAX_SAMPLES = 80;
const samples: MetricSample[] = [];
let lastGemini429At: string | null = null;
let lastFailStreakAlertAt: string | null = null;

export function recordIngestTick(input: {
  deviceId: string;
  sessionId: string;
  durationMs: number;
  failStreak: number;
}): void {
  push({
    at: new Date().toISOString(),
    kind: "ingest_tick",
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    durationMs: input.durationMs,
    extra: { failStreak: input.failStreak },
  });
  if (input.failStreak >= 5) {
    lastFailStreakAlertAt = new Date().toISOString();
  }
}

export function recordDashboardQuery(durationMs: number, deviceId: string): void {
  push({
    at: new Date().toISOString(),
    kind: "dashboard",
    deviceId,
    durationMs,
  });
}

export function recordGemini429(deviceId: string): void {
  lastGemini429At = new Date().toISOString();
  push({
    at: new Date().toISOString(),
    kind: "gemini_429",
    deviceId,
    durationMs: 0,
  });
}

function push(sample: MetricSample): void {
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }
}

export function getLiveMetricsSnapshot(): {
  samples: MetricSample[];
  lastGemini429At: string | null;
  lastFailStreakAlertAt: string | null;
} {
  return {
    samples: [...samples],
    lastGemini429At,
    lastFailStreakAlertAt,
  };
}
