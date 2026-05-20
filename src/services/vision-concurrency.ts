const MAX_CONCURRENT = Math.max(
  1,
  Number.parseInt(process.env.VISION_LIVE_MAX_CONCURRENT ?? "4", 10) || 4,
);

let active = 0;
const waiters: Array<() => void> = [];

function releaseSlot(): void {
  active -= 1;
  const next = waiters.shift();
  if (next) next();
}

function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active += 1;
      resolve();
    });
  });
}

export async function withVisionLiveSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

export function visionLiveMaxConcurrent(): number {
  return MAX_CONCURRENT;
}
