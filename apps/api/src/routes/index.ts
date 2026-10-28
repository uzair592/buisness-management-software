import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "./context.js";
import { registerHealthRoutes } from "./health.js";
import { registerAuthRoutes } from "./auth.js";
import { registerDeviceRoutes } from "./devices.js";
import { registerSyncRoutes } from "./sync.js";
import { registerSalesRoutes } from "./sales.js";
import { registerPurchaseRoutes } from "./purchases.js";
import { registerCatalogueRoutes } from "./catalogue.js";
import { registerAccountRoutes } from "./accounts.js";
import { registerOpeningRoutes } from "./opening.js";

export * from "./context.js";

export function registerRoutes(app: FastifyInstance, deps: RouteDeps) {
  registerHealthRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerDeviceRoutes(app, deps);
  registerSyncRoutes(app, deps);
  registerSalesRoutes(app, deps);
  registerPurchaseRoutes(app, deps);
  registerCatalogueRoutes(app, deps);
  registerAccountRoutes(app, deps);
  registerOpeningRoutes(app, deps);
}
