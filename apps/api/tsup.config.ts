import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  noExternal: [/^@business\//],
  external: ["@prisma/client"],
  splitting: false,
  clean: true,
});
