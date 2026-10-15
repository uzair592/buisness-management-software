import { z } from "zod";

const DEFAULT_DEV_SESSION_SECRET =
  "development_secret_at_least_32_characters_long_bms!";
const DEFAULT_DEV_LEASE_SECRET =
  "development_lease_secret_at_least_32_characters_long!";

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
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters")
    .default(DEFAULT_DEV_SESSION_SECRET),
  LEASE_SECRET: z
    .string()
    .min(32, "LEASE_SECRET must be at least 32 characters")
    .default(DEFAULT_DEV_LEASE_SECRET),
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
  if (
    env.NODE_ENV === "production" &&
    (env.SESSION_SECRET === DEFAULT_DEV_SESSION_SECRET ||
      env.LEASE_SECRET === DEFAULT_DEV_LEASE_SECRET)
  )
    throw new Error("Production requires non-development session and lease secrets");
  if (input.DEMO_MODE && input.DEMO_MODE !== "false")
    throw new Error("Demo mode is not supported");
  return env;
}
