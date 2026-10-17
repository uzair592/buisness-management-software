import { Client } from "pg";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import dotenv from "dotenv";

// Load environment from workspace root and local package
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export interface RepairMigrationHistoryOptions {
  migrationUrl?: string;
  migrationsDir?: string;
}

export interface ReconciledMigration {
  migrationName: string;
  recordedChecksum: string;
  diskChecksum: string;
}

export async function repairMigrationHistory(
  options: RepairMigrationHistoryOptions = {},
): Promise<ReconciledMigration[]> {
  const migrationUrl =
    options.migrationUrl ||
    process.env.DATABASE_MIGRATION_URL ||
    process.env.DATABASE_URL ||
    "postgresql://bms_local:bms_local@127.0.0.1:5432/bms?schema=public";

  const migrationsDir =
    options.migrationsDir ||
    path.resolve(__dirname, "../prisma/migrations");

  const client = new Client({ connectionString: migrationUrl });
  await client.connect();

  try {
    // Check if _prisma_migrations table exists
    const tableCheck = await client.query(`
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = '_prisma_migrations';
    `);
    if (tableCheck.rowCount === 0) {
      return [];
    }

    const rowsRes = await client.query(`
      SELECT id, migration_name, checksum, finished_at, rolled_back_at 
      FROM _prisma_migrations 
      ORDER BY started_at ASC;
    `);

    const reconciled: ReconciledMigration[] = [];

    for (const row of rowsRes.rows) {
      const migrationFile = path.join(migrationsDir, row.migration_name, "migration.sql");
      if (!fs.existsSync(migrationFile)) {
        continue;
      }

      const fileContent = fs.readFileSync(migrationFile, "utf-8");
      const diskChecksum = crypto.createHash("sha256").update(fileContent).digest("hex");

      if (row.checksum !== diskChecksum) {
        console.warn(
          `[MIGRATION CHECKSUM MISMATCH DETECTED] Migration '${row.migration_name}' recorded checksum in DB (${row.checksum}) differs from disk (${diskChecksum}). Reconciling history without resetting database...`,
        );

        await client.query(
          `UPDATE _prisma_migrations SET checksum = $1 WHERE migration_name = $2`,
          [diskChecksum, row.migration_name],
        );

        reconciled.push({
          migrationName: row.migration_name,
          recordedChecksum: row.checksum,
          diskChecksum,
        });
      }
    }

    return reconciled;
  } finally {
    await client.end();
  }
}

// Direct execution entrypoint
if (
  process.argv[1]?.endsWith("repair-history.ts") ||
  process.argv[1]?.endsWith("repair-history.js")
) {
  repairMigrationHistory()
    .then((reconciled) => {
      if (reconciled.length === 0) {
        console.log("Migration history checksums are up to date and match on-disk migration files.");
      } else {
        console.log(`Successfully reconciled ${reconciled.length} migration checksum(s) in _prisma_migrations.`);
      }
    })
    .catch((err) => {
      console.error("Migration history repair failed:", err);
      process.exit(1);
    });
}
