import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

test(
  "compiled API starts and serves real DB readiness",
  { timeout: 45000 },
  async (t) => {
    const dbUrl =
      process.env.DATABASE_URL ||
      "postgresql://bms_local:bms_local@127.0.0.1:5432/bms?schema=public";
    assert.ok(dbUrl, "Set DATABASE_URL to real PostgreSQL");
    const portProbe = createServer();
    portProbe.listen(0, "127.0.0.1");
    await once(portProbe, "listening");
    const address = portProbe.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      portProbe.close((error) => (error ? reject(error) : resolve())),
    );
    const child = spawn(process.execPath, ["apps/api/dist/server.js"], {
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    t.after(() => {
      child.kill();
    });
    const started = once(child.stdout, "data");
    const exited = once(child, "exit").then(([code]) => {
      throw new Error("API exited before listening: " + code);
    });
    await Promise.race([started, exited]);
    for (const endpoint of ["live", "ready"]) {
      const response = await fetch(
        `http://127.0.0.1:${port}/health/${endpoint}`,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ok" });
    }
  },
);
