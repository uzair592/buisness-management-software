import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Attempt to load .env from current directory or workspace root
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://bms_local:bms_local@127.0.0.1:5432/bms?schema=public",
  },
});
