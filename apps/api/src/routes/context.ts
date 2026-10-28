import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@business/db";
import type { SessionState } from "../auth/session.js";

export interface RouteDeps {
  db?: PrismaClient;
  checkDatabase?: () => Promise<void>;
  sessionSecret: string;
  leaseSecret: string;
  isProduction: boolean;
}

export type AuthenticatedRequest = FastifyRequest & {
  session: SessionState;
  user: NonNullable<SessionState["user"]>;
};

export type TenantContextResult = {
  businessId: string;
  membership: NonNullable<SessionState["activeMembership"]>;
};

export function requireDb(db?: PrismaClient): PrismaClient {
  if (!db) throw new Error("Database client not configured");
  return db;
}

export function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): request is AuthenticatedRequest {
  if (!request.session || !request.user) {
    void reply.code(401).send({ error: "Authentication required" });
    return false;
  }
  return true;
}

export function requireTenantContext(
  request: AuthenticatedRequest,
  reply: FastifyReply,
): TenantContextResult | null {
  const businessId = request.session.selectedBusinessId;
  const membership = request.activeMembership;
  if (!businessId || !membership || membership.businessId !== businessId) {
    void reply.code(403).send({ error: "Active business membership required" });
    return null;
  }
  return { businessId, membership };
}

export function verifyCsrf(request: FastifyRequest, reply: FastifyReply): boolean {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const headerToken = request.headers["x-csrf-token"];
    if (!headerToken || headerToken !== request.session?.csrfToken) {
      void reply.code(403).send({ error: "Invalid CSRF token" });
      return false;
    }
  }
  return true;
}

export function setSessionCookies(
  reply: FastifyReply,
  rawToken: string,
  csrfToken: string,
  isProduction: boolean,
) {
  reply.setCookie("bms_session", rawToken, {
    path: "/",
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
  });
  reply.setCookie("bms_csrf", csrfToken, {
    path: "/",
    httpOnly: false,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
  });
  reply.header("x-csrf-token", csrfToken);
}
