import assert from "node:assert/strict";
import test from "node:test";

test("expandJournalCategories uses detected_categories", async () => {
  const { expandJournalCategories } = await import(
    "../dist/services/journal-incident-categories.js"
  );

  const row = {
    id: "1",
    category: "phone_usage",
    analysis_status: "completed",
    error_message: null,
    storage_path: "incidents/a.mp4",
    title: null,
    camera_label: null,
    description: "phone",
    confidence: 90,
    detected_categories: [
      { category: "phone_usage", confidence: 90, description: "phone" },
      { category: "sleep", confidence: 80, description: "sleep" },
    ],
    created_at: new Date("2026-06-01T10:00:00Z"),
  };

  const cats = expandJournalCategories(row);
  assert.deepEqual(cats.sort(), ["phone_usage", "sleep"]);
});

test("expandJournalCategories falls back to primary category", async () => {
  const { expandJournalCategories } = await import(
    "../dist/services/journal-incident-categories.js"
  );

  const row = {
    id: "2",
    category: "fall",
    analysis_status: "completed",
    error_message: null,
    storage_path: "incidents/b.mp4",
    title: null,
    camera_label: null,
    description: "fall",
    confidence: 75,
    created_at: new Date("2026-06-01T10:00:00Z"),
  };

  assert.deepEqual(expandJournalCategories(row), ["fall"]);
});

test("expandJournalCategories excludes pending and intruder", async () => {
  const { expandJournalCategories } = await import(
    "../dist/services/journal-incident-categories.js"
  );

  const pending = {
    id: "3",
    category: "pending",
    analysis_status: "processing",
    error_message: null,
    storage_path: "incidents/c.mp4",
    title: null,
    camera_label: null,
    description: null,
    confidence: null,
    created_at: new Date("2026-06-01T10:00:00Z"),
  };

  assert.deepEqual(expandJournalCategories(pending), []);
});

test("buildFleetCategoryStats merges live and journal rows", async () => {
  const { buildFleetCategoryStats } = await import("../dist/services/live-fleet-situations.js");

  const stats = buildFleetCategoryStats([
    { category: "phone_usage", capturedAt: new Date("2026-06-05T12:00:00Z") },
    { category: "phone_usage", capturedAt: new Date("2026-06-05T13:00:00Z") },
    { category: "sleep", capturedAt: new Date("2026-06-04T10:00:00Z") },
  ]);

  const phone = stats.find((s) => s.category === "phone_usage");
  const sleep = stats.find((s) => s.category === "sleep");
  const fight = stats.find((s) => s.category === "fight");

  assert.equal(phone?.count, 2);
  assert.equal(phone?.lastAt, "2026-06-05T13:00:00.000Z");
  assert.equal(sleep?.count, 1);
  assert.equal(fight?.count, 0);
});

test("journalSummaryRowsFromIncidents expands multi-category counts", async () => {
  const { journalSummaryRowsFromIncidents } = await import(
    "../dist/services/journal-incident-categories.js"
  );

  const rows = journalSummaryRowsFromIncidents([
    {
      id: "1",
      category: "phone_usage",
      analysis_status: "completed",
      error_message: null,
      storage_path: "incidents/a.mp4",
      title: null,
      camera_label: null,
      description: "both",
      confidence: 90,
      detected_categories: [
        { category: "phone_usage", confidence: 90, description: "phone" },
        { category: "sleep", confidence: 80, description: "sleep" },
      ],
      created_at: new Date("2026-06-05T15:00:00Z"),
    },
  ]);

  assert.equal(rows.length, 2);
  assert.ok(rows.some((r) => r.category === "phone_usage"));
  assert.ok(rows.some((r) => r.category === "sleep"));
});

test("journalIncidentMatchesCategory filters by category", async () => {
  const { journalIncidentMatchesCategory } = await import(
    "../dist/services/journal-incident-categories.js"
  );

  const row = {
    id: "1",
    category: "phone_usage",
    analysis_status: "completed",
    error_message: null,
    storage_path: "incidents/a.mp4",
    title: null,
    camera_label: null,
    description: "both",
    confidence: 90,
    detected_categories: [
      { category: "phone_usage", confidence: 90, description: "phone" },
      { category: "sleep", confidence: 80, description: "sleep" },
    ],
    created_at: new Date("2026-06-05T15:00:00Z"),
  };

  assert.equal(journalIncidentMatchesCategory(row, "phone_usage"), true);
  assert.equal(journalIncidentMatchesCategory(row, "sleep"), true);
  assert.equal(journalIncidentMatchesCategory(row, "fight"), false);
});
