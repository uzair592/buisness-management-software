import { Client } from "pg";
import path from "node:path";
import dotenv from "dotenv";

// Load environment from workspace root and local package
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export interface ProvisionOptions {
  migrationUrl?: string;
  runtimeUser?: string;
  runtimePassword?: string;
  isProduction?: boolean;
}

export async function provisionDatabase(options: ProvisionOptions = {}) {
  const migrationUrl =
    options.migrationUrl ||
    process.env.DATABASE_MIGRATION_URL ||
    process.env.DATABASE_URL ||
    "postgresql://bms_local:bms_local@127.0.0.1:5432/bms?schema=public";

  const runtimeUser = options.runtimeUser || process.env.BMS_RUNTIME_USER || "bms_runtime";
  const runtimePassword =
    options.runtimePassword || process.env.BMS_RUNTIME_PASSWORD || "bms_runtime";

  const isProduction =
    options.isProduction ??
    (process.env.NODE_ENV === "production");

  if (isProduction && (!runtimePassword || runtimePassword === "bms_runtime")) {
    throw new Error(
      "Production deployment requires a secure, non-default BMS_RUNTIME_PASSWORD",
    );
  }

  const client = new Client({ connectionString: migrationUrl });
  await client.connect();

  try {
    const res = await client.query("SELECT current_database() AS dbname;");
    const currentDb = res.rows[0].dbname as string;

    // 1. Ensure runtime role exists and set secure environment password
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${runtimeUser.replace(/'/g, "''")}') THEN
          CREATE ROLE "${runtimeUser.replace(/"/g, '""')}" WITH LOGIN PASSWORD '${runtimePassword.replace(/'/g, "''")}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
        ELSE
          ALTER ROLE "${runtimeUser.replace(/"/g, '""')}" WITH PASSWORD '${runtimePassword.replace(/'/g, "''")}';
        END IF;
      END
      $$;
    `);

    // 2. Grant dynamic connection and schema rights on current database
    await client.query(`GRANT CONNECT ON DATABASE "${currentDb.replace(/"/g, '""')}" TO "${runtimeUser.replace(/"/g, '""')}";`);
    await client.query(`GRANT USAGE ON SCHEMA public TO "${runtimeUser.replace(/"/g, '""')}";`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${runtimeUser.replace(/"/g, '""')}";`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${runtimeUser.replace(/"/g, '""')}";`);

    // 3. Fresh installation compatibility:
    // If the database is NOT named "bms", ensure database "bms" exists on the cluster
    // so legacy migration 20261015000000 line 217 does not fail during fresh setup.
    if (currentDb !== "bms") {
      const bmsCheck = await client.query(
        "SELECT 1 FROM pg_database WHERE datname = 'bms';",
      );
      if (bmsCheck.rowCount === 0) {
        try {
          await client.query('CREATE DATABASE "bms";');
        } catch {
          // Ignore if insufficient privileges or created concurrently
        }
      }
    }

    return { currentDb, runtimeUser };
  } finally {
    await client.end();
  }
}

// Direct execution entrypoint
if (process.argv[1]?.endsWith("provision.ts") || process.argv[1]?.endsWith("provision.js")) {
  provisionDatabase()
    .then(({ currentDb, runtimeUser }) => {
      console.log(`Database '${currentDb}' successfully provisioned for runtime role '${runtimeUser}'.`);
    })
    .catch((err) => {
      console.error("Database provisioning failed:", err);
      process.exit(1);
    });
}
