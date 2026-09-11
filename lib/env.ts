import { z } from "zod";

/**
 * Central environment contract. Every required variable is validated here so
 * the application fails fast at startup (see `env.mjs`) instead of surfacing
 * confusing runtime errors later.
 *
 * `parseEnv(source)` supports injecting a source map (defaults to
 * `process.env`) which keeps the validator unit-testable.
 */

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  APP_NAME: z.string().min(1).default("RelayFlow"),
  APP_BASE_URL: z.url(),

  EMAIL_FROM: z.string().default("RelayFlow <noreply@relayflow.dev>"),
  EMAIL_RESEND_API_KEY: z.string().default(""),
  PASSWORD_RESET_TTL_HOURS: z.coerce.number().int().positive().default(1),
  INVITE_TTL_DAYS: z.coerce.number().int().positive().default(7),

  DATABASE_URL: z
    .string()
    .url({ message: "DATABASE_URL must be a postgresql:// connection string" })
    .refine((v) => v.startsWith("postgres") || v.startsWith("postgresql"), {
      message: "DATABASE_URL must use the postgres:// or postgresql:// scheme",
    }),

  REDIS_URL: z
    .string()
    .url({ message: "REDIS_URL must be a redis:// or rediss:// URL" })
    .refine((v) => v.startsWith("redis://") || v.startsWith("rediss://"), {
      message: "REDIS_URL must use the redis:// or rediss:// scheme",
    }),

  /** base64-encoded 32-byte AES-256 key */
  MASTER_ENCRYPTION_KEY: z
    .string()
    .min(24, {
      message:
        "MASTER_ENCRYPTION_KEY must be at least a base64-encoded 32-byte value",
    })
    .refine(
      (v) => {
        try {
          return Buffer.from(v, "base64").length === 32;
        } catch {
          return false;
        }
      },
      { message: "MASTER_ENCRYPTION_KEY must decode to exactly 32 bytes" },
    ),

  AUTH_JWT_SECRET: z.string().min(32, {
    message: "AUTH_JWT_SECRET must be at least 32 characters",
  }),
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().min(1).default(7),

  WEBHOOK_MAX_AGE_SECONDS: z.coerce.number().int().min(1).default(300),
  WEBHOOK_BODY_SIZE_LIMIT_BYTES: z.coerce.number().int().positive().default(1_000_000),

  RATE_LIMIT_IP_CAPACITY: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_IP_REFILL_PER_MINUTE: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_ORG_CAPACITY: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_ORG_REFILL_PER_MINUTE: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WEBHOOK_CAPACITY: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WEBHOOK_REFILL_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .default(20),
});

export type AppEnv = z.infer<typeof envSchema>;
export { envSchema };

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Validates a raw environment source and returns a typed, immutable snapshot.
 * Throws a `ConfigError` listing every missing/invalid variable.
 */
export function parseEnv(
  source: NodeJS.ProcessEnv = process.env,
): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      const field = path.length > 0 ? path : "(unknown)";
      return `  - ${field}: ${issue.message}`;
    });
    throw new ConfigError(
      `Invalid environment configuration:\n${lines.join("\n")}\n\n` +
        `Copy .env.example to .env and provide every required variable.`,
    );
  }
  return result.data;
}

let cachedEnv: AppEnv | null = null;

/**
 * Returns the validated environment, computed exactly once per process.
 */
export function getEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (!cachedEnv) {
    cachedEnv = parseEnv(source);
  }
  return cachedEnv;
}

/**
 * Eager snapshot used by application modules. Importing this module triggers
 * validation, which is how fail-fast propagates to every entry point.
 */
export const env = getEnv();

/**
 * Derived, default exports used across the app.
 */
export const webhookMaxAgeSeconds = env.WEBHOOK_MAX_AGE_SECONDS;
export const webhookBodySizeLimit = env.WEBHOOK_BODY_SIZE_LIMIT_BYTES;