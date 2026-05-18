import assert from "node:assert/strict";
import test from "node:test";

test("payload size limit rejects oversized json", async () => {
  const { assertPayloadWithinLimit, maxLivePayloadBytes } = await import(
    "../dist/services/live-upload-limits.js"
  );
  const big = { x: "a".repeat(maxLivePayloadBytes()) };
  assert.throws(() => assertPayloadWithinLimit(big));
  assert.doesNotThrow(() => assertPayloadWithinLimit({ ok: true }));
});

test("jpeg size limit", async () => {
  const { assertJpegWithinLimit, maxLiveJpegBytes } = await import(
    "../dist/services/live-upload-limits.js"
  );
  const ok = Buffer.alloc(100);
  assert.equal(assertJpegWithinLimit(ok)?.length, 100);
  const huge = Buffer.alloc(maxLiveJpegBytes() + 1);
  assert.throws(() => assertJpegWithinLimit(huge));
});
