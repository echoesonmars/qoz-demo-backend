import type { StreamOverlayMessage } from "../types/overlay.js";

export type FleetDeviceKind = "camera" | "board";

export type FleetSession = {
  deviceId: string;
  name: string;
  kind: FleetDeviceKind;
  ip?: string;
  room?: string;
  connectedAt: number;
  lastFrameAt: number;
  frameCount: number;
};

const sessions = new Map<string, FleetSession>();

const seedDevices: Omit<FleetSession, "connectedAt" | "lastFrameAt" | "frameCount">[] = [
  {
    deviceId: "d1",
    name: "Камера 304",
    kind: "camera",
    ip: "10.0.12.41",
    room: "304",
  },
  {
    deviceId: "d2",
    name: "Смарт-доска 102",
    kind: "board",
    ip: "10.0.10.102",
    room: "102",
  },
  {
    deviceId: "d3",
    name: "Камера 214",
    kind: "camera",
    ip: "10.0.11.07",
    room: "214",
  },
];

export function registerLiveSession(
  deviceId: string,
  meta?: Partial<Pick<FleetSession, "name" | "kind" | "ip" | "room">>,
): void {
  const seed = seedDevices.find((d) => d.deviceId === deviceId);
  const now = Date.now();
  sessions.set(deviceId, {
    deviceId,
    name: meta?.name ?? seed?.name ?? `Устройство ${deviceId}`,
    kind: meta?.kind ?? seed?.kind ?? "camera",
    ip: meta?.ip ?? seed?.ip,
    room: meta?.room ?? seed?.room,
    connectedAt: now,
    lastFrameAt: now,
    frameCount: 0,
  });
}

export function unregisterLiveSession(deviceId: string): void {
  sessions.delete(deviceId);
}

export function recordLiveFrame(deviceId: string): void {
  const s = sessions.get(deviceId);
  if (!s) return;
  s.lastFrameAt = Date.now();
  s.frameCount += 1;
}

function telemetryPercent(session: FleetSession | undefined): number {
  if (!session) return 0;
  const age = Date.now() - session.lastFrameAt;
  if (age > 5000) return Math.max(0, 20 - Math.floor(age / 1000));
  const rate = session.frameCount;
  return Math.min(100, Math.max(12, Math.round(rate * 4)));
}

export type FleetDeviceResponse = {
  id: string;
  name: string;
  kind: string;
  ip?: string;
  room?: string;
  online: boolean;
  latencyMs?: number;
  telemetryPercent: number;
};

export function getFleetDevices(): FleetDeviceResponse[] {
  const ids = new Set<string>([
    ...seedDevices.map((d) => d.deviceId),
    ...sessions.keys(),
  ]);
  return [...ids].map((id) => {
    const seed = seedDevices.find((d) => d.deviceId === id);
    const session = sessions.get(id);
    const online = Boolean(session);
    return {
      id,
      name: session?.name ?? seed?.name ?? id,
      kind:
        session?.kind === "board"
          ? "Интерактивная панель"
          : seed?.kind === "board"
            ? "Интерактивная панель"
            : "Qoz Vision",
      ip: session?.ip ?? seed?.ip,
      room: session?.room ?? seed?.room,
      online,
      latencyMs: online ? 24 + (id.length % 20) : undefined,
      telemetryPercent: telemetryPercent(session),
    };
  });
}

export function buildMockOverlay(): StreamOverlayMessage {
  const t = Date.now() / 900;
  return {
    type: "overlay",
    boxes: [
      {
        left: 0.12 + Math.sin(t) * 0.04,
        top: 0.2,
        width: 0.22,
        height: 0.18,
        label: "person",
      },
    ],
    caption: "Qoz Live: пространственный анализ",
  };
}
