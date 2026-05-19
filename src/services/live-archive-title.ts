import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type CameraJson = {
  id: string;
  uniqueChannel: number;
  name?: string;
  index?: number;
};

let deviceLabelCache: Map<string, string> | null = null;

function loadDeviceLabels(): Map<string, string> {
  if (deviceLabelCache) return deviceLabelCache;
  const map = new Map<string, string>();
  const paths = [
    process.env.CAMERAS_JSON_PATH?.trim(),
    join(dirname(fileURLToPath(import.meta.url)), "../../../qoz-vision-demo/cameras.json"),
    join(process.cwd(), "../qoz-vision-demo/cameras.json"),
  ].filter((p): p is string => Boolean(p));

  for (const path of paths) {
    try {
      const raw = readFileSync(path, "utf8");
      const list = JSON.parse(raw) as CameraJson[];
      for (const c of list) {
        const key = `${c.id}-${c.uniqueChannel}`;
        const name = c.name?.trim() || `Камера ${c.index ?? key}`;
        map.set(key, `${name} · к.${c.uniqueChannel}`);
      }
      break;
    } catch {
      /* try next path */
    }
  }
  deviceLabelCache = map;
  return map;
}

function formatRuDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function buildLiveArchiveLessonTitle(
  deviceId: string,
  startedAt: Date,
  cameraId?: string | null,
): string {
  const labels = loadDeviceLabels();
  const byDevice = labels.get(deviceId);
  const byCamera = cameraId ? labels.get(cameraId) : undefined;
  const cameraPart = byDevice ?? byCamera ?? deviceId;
  return `Live · ${cameraPart} · ${formatRuDate(startedAt)}`;
}
