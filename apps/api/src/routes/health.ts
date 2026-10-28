import type { FastifyInstance } from "fastify";
import { healthSchema } from "@business/contracts";
import type { RouteDeps } from "./context.js";

export function registerHealthRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get("/health/live", async () => healthSchema.parse({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      if (deps.checkDatabase) {
        await deps.checkDatabase();
      }
      return healthSchema.parse({ status: "ok" });
    } catch {
      reply.code(503);
      return healthSchema.parse({ status: "unavailable" });
    }
  });
}
