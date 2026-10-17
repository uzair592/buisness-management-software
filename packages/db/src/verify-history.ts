import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

export interface HistoryIssue {
  migrationName: string;
  reason: "modified" | "missing-file" | "unfinished" | "history-missing";
  recordedChecksum?: string;
  diskChecksum?: string;
}

export interface VerifyHistoryOptions {
  migrationUrl?: string;
  migrationsDir?: string;
}

/** Inspect Prisma's applied history without modifying it or any application data. */
export async function verifyMigrationHistory(
  options: VerifyHistoryOptions = {},
): Promise<HistoryIssue[]> {
  const migrationUrl =
    options.migrationUrl ?? process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!migrationUrl) throw new Error("DATABASE_MIGRATION_URL or DATABASE_URL is required");

  const migrationsDir =
    options.migrationsDir ?? fileURLToPath(new URL("../prisma/migrations/", import.meta.url));
  const client = new Client({ connectionString: migrationUrl });
  await client.connect();

  try {
    const table = await client.query<{ present: string | null }>(
      "SELECT to_regclass('public._prisma_migrations')::text AS present",
    );
    if (!table.rows[0]?.present) {
      return [{ migrationName: "_prisma_migrations", reason: "history-missing" }];
    }

    const result = await client.query<{
      migration_name: string;
      checksum: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }>(
      "SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at",
    );
    const issues: HistoryIssue[] = [];

    for (const row of result.rows) {
      if (row.rolled_back_at) continue;
      if (!row.finished_at) {
        issues.push({ migrationName: row.migration_name, reason: "unfinished" });
        continue;
      }
      const filename = path.join(migrationsDir, row.migration_name, "migration.sql");
      if (!fs.existsSync(filename)) {
        issues.push({ migrationName: row.migration_name, reason: "missing-file" });
        continue;
      }
      const diskChecksum = crypto
        .createHash("sha256")
        .update(fs.readFileSync(filename))
        .digest("hex");
      if (diskChecksum !== row.checksum) {
        issues.push({
          migrationName: row.migration_name,
          reason: "modified",
          recordedChecksum: row.checksum,
          diskChecksum,
        });
      }
    }
    return issues;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyMigrationHistory()
    .then((issues) => {
      if (issues.length) {
        for (const issue of issues) {
          console.error(`Migration history issue: ${JSON.stringify(issue)}`);
        }
        process.exitCode = 1;
      } else {
        console.log("Applied migration checksums match the files on disk.");
      }
    })
    .catch((error: unknown) => {
      console.error("Migration history verification failed:", error);
      process.exitCode = 1;
    });
}
