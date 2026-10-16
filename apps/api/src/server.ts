import { createDatabase } from "@business/db";
import { createApp } from "./app.js";
import { parseEnv } from "./env.js";

const env = parseEnv(process.env);
const url = new URL(env.DATABASE_URL);
url.searchParams.set("connect_timeout", "2");
url.searchParams.set("pool_timeout", "2");
url.searchParams.set("socket_timeout", "3");

const db = createDatabase(url.toString());
const app = createApp({
  db,
  checkDatabase: async () => {
    await db.$queryRaw`SELECT 1`;
  },
  sessionSecret: env.SESSION_SECRET,
  leaseSecret: env.LEASE_SECRET,
  isProduction: env.NODE_ENV === "production",
  trustProxy: env.trustProxy,
});

app.addHook("onClose", async () => {
  await db.$disconnect();
});

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close();
  });

await app.listen({ host: env.HOST, port: env.PORT });
console.log("API listening on port " + env.PORT);
