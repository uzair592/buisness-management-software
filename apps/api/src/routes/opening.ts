import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ChangedCommandError, withTenantContext } from "@business/db";
import { openingInput, prepareOpening, commitOpening, OpeningConflict } from "../opening.js";
import { accountContext } from "./accounts.js";
import { type RouteDeps, requireDb } from "./context.js";

export function registerOpeningRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get("/v1/opening", async (request, reply) => {
    const tenant = accountContext(request, reply, false);
    if (!tenant) return;
    return withTenantContext(requireDb(deps.db), tenant, async (tx) =>
      tx.openingBatch.findFirst({
        where: { businessId: tenant.businessId },
        include: { documents: true },
      }),
    );
  });

  app.post("/v1/opening/preview", async (request, reply) => {
    const tenant = accountContext(request, reply, true);
    if (!tenant) return;
    const parsed = openingInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid opening batch", details: parsed.error.flatten() });
    try {
      const prepared = await prepareOpening(requireDb(deps.db), tenant.businessId, tenant.userId, parsed.data);
      return { preview: prepared.preview, expectedCursor: prepared.expectedCursor };
    } catch (error) {
      if (error instanceof OpeningConflict) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });

  app.post("/v1/opening/commit", async (request, reply) => {
    const tenant = accountContext(request, reply, true);
    if (!tenant) return;
    const parsed = openingInput.extend({ expectedCursor: z.string().regex(/^\d+$/) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid opening batch", details: parsed.error.flatten() });
    const { expectedCursor, ...input } = parsed.data;
    try {
      const result = await commitOpening(requireDb(deps.db), tenant.businessId, tenant.userId, input, expectedCursor);
      return reply.code(201).send(result);
    } catch (error) {
      if (
        error instanceof OpeningConflict ||
        error instanceof ChangedCommandError ||
        (typeof error === "object" && error && "code" in error && error.code === "P2002")
      ) {
        return reply.code(409).send({ error: error instanceof Error ? error.message : "Opening batch already exists" });
      }
      throw error;
    }
  });
}
