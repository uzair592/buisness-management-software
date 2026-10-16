import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "./generated/prisma/client.js";

export function createDatabase(url: string) {
  const adapter = new PrismaPg(url);
  return new PrismaClient({ adapter });
}

export interface TenantContext {
  businessId?: string;
  userId?: string;
  bypassRls?: boolean;
}

export async function withTenantContext<T>(
  client: PrismaClient,
  context: TenantContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return await client.$transaction(async (tx) => {
    if (context.bypassRls) {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_rls = 'true'`);
    }
    if (context.businessId) {
      await tx.$executeRawUnsafe(
        `SET LOCAL app.current_business_id = '${context.businessId.replace(/'/g, "''")}'`,
      );
    }
    if (context.userId) {
      await tx.$executeRawUnsafe(
        `SET LOCAL app.current_user_id = '${context.userId.replace(/'/g, "''")}'`,
      );
    }
    return await fn(tx);
  });
}

export * from "./generated/prisma/client.js";
export { Client } from "pg";
export { provisionDatabase } from "./provision.js";
