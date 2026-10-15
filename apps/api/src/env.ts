import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z
    .url()
    .refine(
      (v) => ["postgres:", "postgresql:"].includes(new URL(v).protocol),
      "Must be PostgreSQL",
    ),
});
export function parseEnv(input: NodeJS.ProcessEnv) {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(
      "Invalid environment: " +
        result.error.issues
          .map((i) => i.path.join(".") + ": " + i.message)
          .join("; "),
    );
  const env = result.data;
  const url = new URL(env.DATABASE_URL);
  if (
    env.NODE_ENV === "production" &&
    (!url.password ||
      ["bms_local", "postgres", "password"].includes(
        decodeURIComponent(url.password),
      ) ||
      url.username === "bms_local")
  )
    throw new Error("Production requires non-development database credentials");
  if (input.DEMO_MODE && input.DEMO_MODE !== "false")
    throw new Error("Demo mode is not supported");
  return env;
}
