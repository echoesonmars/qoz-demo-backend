import assert from "node:assert/strict";
import test from "node:test";

test("map empty vision dto to live payload passes schema", async () => {
  const { mapVisionDtoToLivePayload } = await import(
    "../dist/services/vision-map-live-payload.js"
  );
  const { liveAnalysisPayloadSchema } = await import("../dist/types/live-analysis.js");

  const dto = {
    detections: [],
    actions: [],
    engagement: 68.4,
    stats: { total_students: 12, looking_at_board: 10, sleeping: 0 },
  };
  const payload = mapVisionDtoToLivePayload(dto);
  const parsed = liveAnalysisPayloadSchema.safeParse(payload);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.analytics_meta.target_language, "ru");
  assert.equal(parsed.data.classroom_visual_behavior.students_count_detected, 12);
});

test("map detection phone_usage to incident", async () => {
  const { mapVisionDtoToLivePayload } = await import(
    "../dist/services/vision-map-live-payload.js"
  );

  const dto = {
    detections: [
      {
        label: "phone",
        qoz_incident: "phone_usage",
        confidence: 0.81,
        bbox: [1, 2, 3, 4],
        source_model: "yolov8n",
      },
    ],
    actions: [],
    engagement: 55,
  };
  const payload = mapVisionDtoToLivePayload(dto);
  assert.equal(payload.detected_incidents.length, 1);
  assert.equal(payload.detected_incidents[0].type, "phone_usage");
  assert.equal(payload.classroom_visual_behavior.active_phone_users, 1);
});
