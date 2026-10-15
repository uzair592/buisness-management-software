import crypto from "node:crypto";
import type { PrismaClient } from "@business/db";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function createSession(
  db: PrismaClient,
  userId: string,
  userAgent?: string,
  ipAddress?: string,
) {
  const rawToken = generateSecureToken();
  const csrfToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  // Find first membership to set as default selected business if available
  const membership = await db.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });

  const session = await db.session.create({
    data: {
      userId,
      selectedBusinessId: membership?.businessId ?? null,
      tokenHash,
      csrfToken,
      userAgent: userAgent ?? null,
      ipAddress: ipAddress ?? null,
      expiresAt,
    },
  });

  return {
    rawToken,
    csrfToken,
    session,
  };
}

export async function getSessionByToken(db: PrismaClient, rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const session = await db.session.findUnique({
    where: { tokenHash },
    include: {
      user: true,
      selectedBusiness: true,
    },
  });

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt <= now) return null;

  // Retrieve user memberships
  const memberships = await db.membership.findMany({
    where: { userId: session.userId },
    include: {
      business: true,
      location: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const activeMembership =
    memberships.find((m) => m.businessId === session.selectedBusinessId) ??
    memberships[0] ??
    null;

  return {
    ...session,
    memberships,
    activeMembership,
  };
}

export type SessionState = NonNullable<Awaited<ReturnType<typeof getSessionByToken>>>;

export async function selectBusinessForSession(
  db: PrismaClient,
  sessionId: string,
  userId: string,
  businessId: string,
) {
  // Verify membership
  const membership = await db.membership.findFirst({
    where: { userId, businessId },
  });

  if (!membership) {
    throw new Error("User does not have access to this business");
  }

  return await db.session.update({
    where: { id: sessionId },
    data: { selectedBusinessId: businessId },
  });
}

export async function revokeSession(db: PrismaClient, sessionId: string) {
  return await db.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
}

export async function revokeOtherSessions(
  db: PrismaClient,
  userId: string,
  currentSessionId: string,
) {
  return await db.session.updateMany({
    where: {
      userId,
      id: { not: currentSessionId },
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserSessions(db: PrismaClient, userId: string) {
  return await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}
