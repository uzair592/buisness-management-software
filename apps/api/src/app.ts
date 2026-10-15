import Fastify from "fastify";
import { healthSchema } from "@business/contracts";
export function createApp(checkDatabase: () => Promise<void>) {
  const app = Fastify({ logger: false, requestTimeout: 5000 });
  app.get("/health/live", async () => healthSchema.parse({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await checkDatabase();
      return healthSchema.parse({ status: "ok" });
    } catch {
      reply.code(503);
      return healthSchema.parse({ status: "unavailable" });
    }
  });
  return app;
}
