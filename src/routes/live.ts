import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { attachLiveSession } from "../services/gemini-live-proxy.js";
import {
  registerLiveSession,
  unregisterLiveSession,
} from "../services/fleet-registry.js";

export async function liveRoutes(app: FastifyInstance) {
  await app.register(websocket);

  app.get("/api/live", { websocket: true }, (socket, request) => {
    const query = request.query as { deviceId?: string };
    const deviceId =
      typeof query.deviceId === "string" && query.deviceId.length > 0
        ? query.deviceId
        : "live-default";

    registerLiveSession(deviceId);
    const cleanup = attachLiveSession(socket, deviceId);

    socket.on("close", () => {
      cleanup();
      unregisterLiveSession(deviceId);
    });
  });
}
