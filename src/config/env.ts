import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

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
  
  // Security & Encryption
  ENCRYPTION_MASTER_KEY: z.string().min(32, "Master key must be at least 32 characters").default("0123456789abcdef0123456789abcdef"),
  JWT_SECRET: z.string().min(16).default("super-secure-enterprise-jwt-secret-key-1234"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000), // 1 min
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(120),
  
  // CORS
  ALLOWED_ORIGINS: z.string().default("*"),

  // OpenRouter LLM Substrate
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_DEFAULT_MODEL: z.string().default("google/gemini-2.0-flash-001")
});

export type EnvConfig = z.infer<typeof envSchema>;

let config: EnvConfig;
try {
  config = envSchema.parse(process.env);
} catch (err: any) {
  console.error("❌ Environment configuration validation failed:", err.format ? err.format() : err);
  // In development/test, fallback to defaults
  config = envSchema.parse({
    ENCRYPTION_MASTER_KEY: "0123456789abcdef0123456789abcdef",
    JWT_SECRET: "super-secure-enterprise-jwt-secret-key-1234"
  });
}

export { config };
