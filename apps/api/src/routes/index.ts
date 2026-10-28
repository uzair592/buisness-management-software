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
import { returnsRoutes } from "./returns.js";
import { stockRoutes } from "./stock.js";
import { registerPaymentRoutes } from "./payments.js";
import { registerExpenseRoutes } from "./expenses.js";
import { registerCashSessionRoutes } from "./cash-sessions.js";
import { registerReportRoutes } from "./reports.js";
import { registerBackupRoutes } from "./backup.js";
import { registerImportExportRoutes } from "./import-export.js";

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
  returnsRoutes(app, deps);
  stockRoutes(app, deps);
  registerPaymentRoutes(app, deps);
  registerExpenseRoutes(app, deps);
  registerCashSessionRoutes(app, deps);
  registerReportRoutes(app, deps);
  registerBackupRoutes(app, deps);
  registerImportExportRoutes(app, deps);
}
