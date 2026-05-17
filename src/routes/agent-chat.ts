import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { runAgentChat } from "../services/gemini-chat.js";

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "agent"]),
        body: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
});

export async function agentChatRoutes(app: FastifyInstance) {
  app.post("/api/agent/chat", async (request, reply) => {
    const secret = request.headers["x-backend-secret"];
    if (secret !== getEnv().BACKEND_INTERNAL_SECRET) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }

    const { messages } = parsed.data;
    if (messages[messages.length - 1]?.role !== "user") {
      return reply.code(400).send({ error: "Last message must be from user" });
    }

    try {
      const replyText = await runAgentChat(messages);
      return reply.send({ reply: replyText });
    } catch (e) {
      request.log.error({ err: e }, "agent chat failed");
      const msg = e instanceof Error ? e.message : "Chat failed";
      return reply.code(502).send({ error: msg });
    }
  });
}
