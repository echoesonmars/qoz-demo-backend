import assert from "node:assert/strict";
import test from "node:test";

test("incidentVideoScaleFilter all frames uses native fps", async () => {
  const { incidentVideoScaleFilter } = await import(
    "../dist/services/incident-video-frames.js"
  );
  assert.equal(incidentVideoScaleFilter(true, 1), "scale=640:480");
});

test("incidentVideoScaleFilter sampled mode uses fps filter", async () => {
  const { incidentVideoScaleFilter } = await import(
    "../dist/services/incident-video-frames.js"
  );
  assert.equal(incidentVideoScaleFilter(false, 2), "fps=2,scale=640:480");
});
