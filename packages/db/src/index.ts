import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export function createDatabase(url: string) {
  const adapter = new PrismaPg(url);
  return new PrismaClient({ adapter });
}

export { PrismaClient };
