import assert from "node:assert/strict";
import test from "node:test";

const phoneFrame = {
  detections: [
    { label: "phone", qoz_incident: "phone_usage", confidence: 0.85, bbox: [0, 0, 1, 1] },
  ],
  actions: [],
  engagement: 50,
};

test("aggregate prefers stable signal over single-frame noise", async () => {
  const { aggregateIncidentFrames } = await import(
    "../dist/services/incident-vision-aggregate.js"
  );

  const dtos = [
    phoneFrame,
    phoneFrame,
    phoneFrame,
    phoneFrame,
    phoneFrame,
    {
      detections: [
        {
          label: "baggage",
          qoz_incident: "lost_property",
          confidence: 0.95,
          bbox: [0, 0, 1, 1],
        },
      ],
      actions: [],
      engagement: 50,
    },
  ];

  const result = aggregateIncidentFrames(dtos, 0.4);
  assert.ok(result);
  assert.equal(result.category, "phone_usage");
  assert.ok(result.confidence >= 80);
  assert.match(result.description, /\d+ из 6 кадров/);
});

test("explainEmptyAggregate lists weak raw signals", async () => {
  const { explainEmptyAggregate } = await import(
    "../dist/services/incident-vision-aggregate.js"
  );

  const dtos = [
    {
      detections: [
        { label: "fall", qoz_incident: "fall", confidence: 0.48, bbox: [0, 0, 1, 1] },
      ],
      actions: [],
      engagement: 50,
    },
    {
      detections: [],
      actions: [],
      engagement: 50,
    },
  ];

  const msg = explainEmptyAggregate(dtos, 0.4);
  assert.match(msg, /fall 48%/);
  assert.match(msg, /1\/2 кадр/);
});

test("aggregate returns null when no hits above threshold", async () => {
  const { aggregateIncidentFrames } = await import(
    "../dist/services/incident-vision-aggregate.js"
  );

  const dtos = [
    {
      detections: [
        { label: "person", qoz_incident: "person", confidence: 0.9, bbox: [0, 0, 1, 1] },
      ],
      actions: [],
      engagement: 50,
    },
  ];

  const result = aggregateIncidentFrames(dtos, 0.4);
  assert.equal(result, null);
});

test("aggregate severity weights: fight beats noisy fall", async () => {
  const { aggregateIncidentFrames } = await import(
    "../dist/services/incident-vision-aggregate.js"
  );

  const fallFrame = {
    detections: [
      { label: "fall", qoz_incident: "fall", confidence: 0.55, bbox: [0, 0, 1, 1] },
    ],
    actions: [],
    engagement: 50,
  };
  const fightFrame = {
    detections: [
      { label: "fight", qoz_incident: "fight", confidence: 0.85, bbox: [0, 0, 1, 1] },
    ],
    actions: [],
    engagement: 50,
  };

  const dtos = [];
  for (let i = 0; i < 28; i++) dtos.push(fallFrame);
  for (let i = 0; i < 10; i++) dtos.push(fightFrame);

  const result = aggregateIncidentFrames(dtos, 0.4);
  assert.ok(result);
  assert.equal(result.category, "fight");
});

test("temporal window drops isolated smoke blips", async () => {
  const { aggregateIncidentFrames } = await import(
    "../dist/services/incident-vision-aggregate.js"
  );

  const fightFrame = {
    detections: [
      { label: "fight", qoz_incident: "fight", confidence: 0.8, bbox: [0, 0, 1, 1] },
    ],
    actions: [],
    engagement: 50,
  };
  const smokeBlip = {
    detections: [
      { label: "smoke", qoz_incident: "smoke", confidence: 0.9, bbox: [0, 0, 1, 1] },
    ],
    actions: [],
    engagement: 50,
  };

  const dtos = [
    fightFrame,
    fightFrame,
    fightFrame,
    fightFrame,
    fightFrame,
    smokeBlip,
  ];

  const result = aggregateIncidentFrames(dtos, 0.4);
  assert.ok(result);
  assert.equal(result.category, "fight");
});

test("fight passes on one qualified frame at 52% (short brawl, incident upload)", async () => {
  const { aggregateIncidentFrames } = await import(
    "../dist/services/incident-vision-aggregate.js"
  );

  const empty = { detections: [], actions: [], engagement: 50 };
  const fightOnce = {
    detections: [
      { label: "fight", qoz_incident: "fight", confidence: 0.52, bbox: [0, 0, 1, 1] },
    ],
    actions: [],
    engagement: 50,
  };

  const dtos = [];
  for (let i = 0; i < 18; i++) dtos.push(empty);
  dtos.push(fightOnce);

  const result = aggregateIncidentFrames(dtos, 0.4);
  assert.ok(result);
  assert.equal(result.category, "fight");
  assert.ok(result.confidence >= 50);
});

test("smoking needs stable hits not one blip at 45%", async () => {
  const { aggregateIncidentFrames } = await import(
    "../dist/services/incident-vision-aggregate.js"
  );

  const empty = { detections: [], actions: [], engagement: 50 };
  const smokingOnce = {
    detections: [
      {
        label: "smoking",
        qoz_incident: "smoking",
        confidence: 0.45,
        bbox: [10, 10, 50, 50],
      },
    ],
    actions: [],
    engagement: 50,
  };

  const dtos = [];
  for (let i = 0; i < 15; i++) dtos.push(empty);
  dtos.push(smokingOnce);

  const result = aggregateIncidentFrames(dtos, 0.4);
  assert.equal(result, null);
});

test("sparse smoke blips below ratio do not aggregate", async () => {
  const { aggregateIncidentFrames } = await import(
    "../dist/services/incident-vision-aggregate.js"
  );

  const empty = { detections: [], actions: [], engagement: 50 };
  const smokeFrame = {
    detections: [
      { label: "smoke", qoz_incident: "smoke", confidence: 0.75, bbox: [0, 0, 1, 1] },
    ],
    actions: [],
    engagement: 50,
  };

  const dtos = [];
  for (let i = 0; i < 28; i++) dtos.push(i < 9 ? smokeFrame : empty);

  const result = aggregateIncidentFrames(dtos, 0.4);
  assert.equal(result, null);
});

test("fight kill-switch suppresses crowd when fight is stable", async () => {
  const { aggregateIncidentFrames } = await import(
    "../dist/services/incident-vision-aggregate.js"
  );

  const fightFrame = {
    detections: [
      { label: "fight", qoz_incident: "fight", confidence: 0.7, bbox: [0, 0, 1, 1] },
    ],
    actions: [],
    engagement: 50,
  };
  const crowdFrame = {
    detections: [
      { label: "crowd", qoz_incident: "crowd", confidence: 0.95, bbox: [0, 0, 1, 1] },
    ],
    actions: [],
    engagement: 50,
  };

  const dtos = [
    fightFrame,
    fightFrame,
    fightFrame,
    fightFrame,
    fightFrame,
    crowdFrame,
    crowdFrame,
    crowdFrame,
    crowdFrame,
  ];

  const result = aggregateIncidentFrames(dtos, 0.4);
  assert.ok(result);
  assert.equal(result.category, "fight");
});

test("long video: sparse fight and baggage drop when smoking is stable", async () => {
  const { aggregateIncidentFrames } = await import(
    "../dist/services/incident-vision-aggregate.js"
  );

  const empty = { detections: [], actions: [], engagement: 50 };
  const smokingFrame = {
    detections: [
      {
        label: "smoking",
        qoz_incident: "smoking",
        confidence: 0.62,
        bbox: [10, 10, 50, 50],
      },
    ],
    actions: [],
    engagement: 50,
  };
  const fightBlip = {
    detections: [
      { label: "fight", qoz_incident: "fight", confidence: 0.67, bbox: [0, 0, 1, 1] },
    ],
    actions: [],
    engagement: 50,
  };
  const baggageBlip = {
    detections: [
      {
        label: "baggage",
        qoz_incident: "lost_property",
        confidence: 0.47,
        bbox: [0, 0, 1, 1],
      },
    ],
    actions: [],
    engagement: 50,
  };

  const dtos = [];
  for (let i = 0; i < 483; i++) {
    if (i >= 100 && i < 110) dtos.push(smokingFrame);
    else if (i < 4) dtos.push(fightBlip);
    else if (i === 10 || i === 20) dtos.push(baggageBlip);
    else dtos.push(empty);
  }

  const result = aggregateIncidentFrames(dtos, 0.4);
  assert.ok(result);
  assert.equal(result.category, "smoking");
  assert.equal(result.categories.length, 1);
});

test("weapon on stairs suppresses fight and weak smoking FP", async () => {
  const { aggregateIncidentFrames } = await import(
    "../dist/services/incident-vision-aggregate.js"
  );

  const empty = { detections: [], actions: [], engagement: 50 };
  const weaponFrame = {
    detections: [
      { label: "knife", qoz_incident: "weapon", confidence: 0.72, bbox: [0, 0, 1, 1] },
    ],
    actions: [],
    engagement: 50,
  };
  const fightFrame = {
    detections: [
      { label: "fight", qoz_incident: "fight", confidence: 0.81, bbox: [0, 0, 1, 1] },
    ],
    actions: [],
    engagement: 50,
  };
  const smokingFrame = {
    detections: [
      { label: "smoking", qoz_incident: "smoking", confidence: 0.47, bbox: [0, 0, 1, 1] },
    ],
    actions: [],
    engagement: 50,
  };

  const dtos = [];
  for (let i = 0; i < 467; i++) {
    if (i < 80) dtos.push(weaponFrame);
    else if (i < 93) dtos.push(fightFrame);
    else if (i % 40 === 0) dtos.push(smokingFrame);
    else dtos.push(empty);
  }

  const result = aggregateIncidentFrames(dtos, 0.4);
  assert.ok(result);
  assert.equal(result.category, "weapon");
  assert.equal(result.categories.length, 1);
});

test("long video: sparse fight blips alone do not aggregate", async () => {
  const { aggregateIncidentFrames } = await import(
    "../dist/services/incident-vision-aggregate.js"
  );

  const empty = { detections: [], actions: [], engagement: 50 };
  const fightBlip = {
    detections: [
      { label: "fight", qoz_incident: "fight", confidence: 0.67, bbox: [0, 0, 1, 1] },
    ],
    actions: [],
    engagement: 50,
  };

  const dtos = [];
  for (let i = 0; i < 483; i++) {
    dtos.push(i < 6 ? fightBlip : empty);
  }

  const result = aggregateIncidentFrames(dtos, 0.4);
  assert.equal(result, null);
});

test("aggregate returns fight and fall when both are stable", async () => {
  const { aggregateIncidentFrames } = await import(
    "../dist/services/incident-vision-aggregate.js"
  );

  const fallFrame = {
    detections: [
      { label: "fall", qoz_incident: "fall", confidence: 0.97, bbox: [0, 0, 1, 1] },
    ],
    actions: [],
    engagement: 50,
  };
  const fightFrame = {
    detections: [
      { label: "fight", qoz_incident: "fight", confidence: 0.8, bbox: [0, 0, 1, 1] },
    ],
    actions: [],
    engagement: 50,
  };

  const dtos = [];
  for (let i = 0; i < 10; i++) dtos.push(fallFrame);
  for (let i = 0; i < 6; i++) dtos.push(fightFrame);

  const result = aggregateIncidentFrames(dtos, 0.4);
  assert.ok(result);
  assert.equal(result.categories.length, 2);
  const cats = result.categories.map((c) => c.category);
  assert.ok(cats.includes("fight"));
  assert.ok(cats.includes("fall"));
});
