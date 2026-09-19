import { z } from "zod";
import dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";
import path from "path";

dotenv.config();

/**
 * Returns a real ENCRYPTION_MASTER_KEY. If one isn't configured, generates a
 * cryptographically random one and persists it to .env so it survives
 * restarts, instead of falling back to a hardcoded value shipped in source.
 */
function ensureMasterKey(): string {
  const existing = process.env.ENCRYPTION_MASTER_KEY;
  if (existing && existing.trim().length >= 32) {
    return existing.trim();
  }

  const generated = crypto.randomBytes(32).toString("hex");
  const envPath = path.resolve(process.cwd(), ".env");
  try {
    const existingContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
    const prefix = existingContent.trim().length > 0 && !existingContent.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(envPath, `${prefix}ENCRYPTION_MASTER_KEY=${generated}\n`);
    console.warn("[Hive] No ENCRYPTION_MASTER_KEY was configured. Generated a new one and saved it to .env — back this up. Losing it makes any data encrypted with it unrecoverable.");
  } catch {
    console.warn("[Hive] No ENCRYPTION_MASTER_KEY was configured and .env could not be written. Using a key generated for this process only — encrypted data will be unreadable after restart until you set ENCRYPTION_MASTER_KEY explicitly.");
  }
  process.env.ENCRYPTION_MASTER_KEY = generated;
  return generated;
}

const resolvedMasterKey = ensureMasterKey();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(42424),
  HOST: z.string().default("0.0.0.0"),

  // Storage Mode
  STORAGE_MODE: z.enum(["sqlite", "postgres"]).default("sqlite"),
  SQLITE_DB_PATH: z.string().default("./memory_graph.sqlite"),
  DATABASE_URL: z.string().optional(),

  // Redis & Queues
  REDIS_URL: z.string().default("redis://localhost:6379"),
  ENABLE_ASYNC_WORKERS: z.coerce.boolean().default(false),

  // Security & Encryption — no hardcoded defaults; see ensureMasterKey() above
  // and the production check below.
  ENCRYPTION_MASTER_KEY: z.string().min(32, "Master key must be at least 32 characters"),
  JWT_SECRET: z.string().min(16).optional(),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(120),

  // CORS
  ALLOWED_ORIGINS: z.string().default("*"),

  // OpenRouter LLM Substrate
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_DEFAULT_MODEL: z.string().default("google/gemini-2.5-flash")
});

type ParsedEnv = z.infer<typeof envSchema>;
export type EnvConfig = ParsedEnv & { JWT_SECRET: string };

let parsed: ParsedEnv;
try {
  parsed = envSchema.parse({ ...process.env, ENCRYPTION_MASTER_KEY: resolvedMasterKey });
} catch (err: any) {
  console.error("❌ Environment configuration validation failed:", err.format ? err.format() : err);
  throw err;
}

if (parsed.NODE_ENV === "production" && !parsed.JWT_SECRET) {
  throw new Error(
    "JWT_SECRET must be explicitly set in the environment when NODE_ENV=production. " +
    "Refusing to start with no secret — generate one with `openssl rand -hex 32` (or " +
    "`node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` on Windows) and set it in .env."
  );
}

const config: EnvConfig = {
  ...parsed,
  JWT_SECRET: parsed.JWT_SECRET || "local-dev-only-jwt-secret-do-not-use-in-production"
};

export { config };
