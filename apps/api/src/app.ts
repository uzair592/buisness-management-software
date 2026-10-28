import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { PrismaClient } from "@business/db";
import { getSessionByToken, type SessionState } from "./auth/session.js";
import { registerRoutes, type RouteDeps } from "./routes/index.js";

export interface CreateAppOptions {
  checkDatabase?: () => Promise<void>;
  db?: PrismaClient;
  sessionSecret?: string;
  leaseSecret?: string;
  isProduction?: boolean;
  trustProxy?: boolean | string | string[] | ((address: string, hop: number) => boolean);
}

declare module "fastify" {
  interface FastifyRequest {
    session?: SessionState;
    user?: SessionState["user"];
    activeMembership?: SessionState["activeMembership"];
    memberships?: SessionState["memberships"];
  }
}

export function createApp(
  optionsOrCheckDb?: (() => Promise<void>) | PrismaClient | CreateAppOptions,
  legacyOptions?: { db?: PrismaClient; sessionSecret?: string; leaseSecret?: string },
): FastifyInstance {
  let checkDatabase: () => Promise<void>;
  let db: PrismaClient | undefined;
  let sessionSecret = "development_secret_at_least_32_characters_long_bms!";
  let leaseSecret = "development_lease_secret_at_least_32_characters_long!";
  let isProduction = false;
  let trustProxy: boolean | string | string[] | ((address: string, hop: number) => boolean) = false;

  if (typeof optionsOrCheckDb === "function") {
    checkDatabase = optionsOrCheckDb;
    db = legacyOptions?.db;
    if (legacyOptions?.sessionSecret) sessionSecret = legacyOptions.sessionSecret;
    if (legacyOptions?.leaseSecret) leaseSecret = legacyOptions.leaseSecret;
  } else if (optionsOrCheckDb && "user" in optionsOrCheckDb) {
    db = optionsOrCheckDb as PrismaClient;
    checkDatabase = async () => {
      await db!.$queryRaw`SELECT 1`;
    };
  } else {
    const opts = (optionsOrCheckDb as CreateAppOptions) || {};
    db = opts.db;
    checkDatabase =
      opts.checkDatabase ||
      (async () => {
        if (db) await db.$queryRaw`SELECT 1`;
      });
    if (opts.sessionSecret) sessionSecret = opts.sessionSecret;
    if (opts.leaseSecret) leaseSecret = opts.leaseSecret;
    if (opts.isProduction) isProduction = opts.isProduction;
    if (opts.trustProxy !== undefined) trustProxy = opts.trustProxy;
  }

  const app = Fastify({ http2: false, logger: false, requestTimeout: 5000, trustProxy });

  void app.register(fastifyCookie, {
    secret: sessionSecret,
    hook: "onRequest",
  });

  // Session extraction hook
  app.addHook("onRequest", async (request) => {
    if (!db) return;

    let token = request.cookies.bms_session;
    if (!token && request.headers.authorization?.startsWith("Bearer ")) {
      token = request.headers.authorization.slice(7);
    }

    if (token) {
      const sessionData = await getSessionByToken(db, token);
      if (sessionData) {
        request.session = sessionData;
        request.user = sessionData.user;
        request.activeMembership = sessionData.activeMembership;
        request.memberships = sessionData.memberships;
      }
    }
  });

  const routeDeps: RouteDeps = {
    db,
    checkDatabase,
    sessionSecret,
    leaseSecret,
    isProduction,
  };

  registerRoutes(app, routeDeps);

  return app;
}
