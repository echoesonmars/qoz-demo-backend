import type { FastifyInstance } from "fastify";
import {
  isDeviceOnline,
  listCameraInfrastructureStatus,
  telemetryFromRow,
} from "../services/camera-infrastructure.js";

export async function camerasInfrastructureRoutes(app: FastifyInstance) {
  app.get("/api/cameras/infrastructure", async (_request, reply) => {
    const rows = await listCameraInfrastructureStatus();
    let monitoring = 0;
    let online = 0;
    const devices = rows.map((r) => {
      const on = isDeviceOnline(r);
      if (r.status === "running") monitoring += 1;
      if (on) online += 1;
      return {
        deviceId: r.device_id,
        status: r.status,
        frameCount: r.frame_count,
        lastFrameAt: r.last_frame_at?.toISOString() ?? null,
        startedAt: r.started_at.toISOString(),
        online: on,
        telemetryPercent: telemetryFromRow(r),
      };
    });

    return reply.send({
      stats: {
        sessionsTracked: rows.length,
        monitoring,
        online,
      },
      byDeviceId: Object.fromEntries(
        rows.map((r) => [
          r.device_id,
          {
            status: r.status,
            frameCount: r.frame_count,
            lastFrameAt: r.last_frame_at?.toISOString() ?? null,
            online: isDeviceOnline(r),
            telemetryPercent: telemetryFromRow(r),
          },
        ]),
      ),
      activeSessions: devices.filter((d) => d.status === "running"),
    });
  });
}
