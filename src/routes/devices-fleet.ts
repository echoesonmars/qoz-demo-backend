import type { FastifyInstance } from "fastify";
import { getFleetDevices } from "../services/fleet-registry.js";

export async function devicesFleetRoutes(app: FastifyInstance) {
  app.get("/api/devices/fleet", async (_request, reply) => {
    return reply.send({ devices: getFleetDevices() });
  });
}
