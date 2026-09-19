import { Request, Response, NextFunction } from "express";
import { config } from "../../config/env";

interface ClientBucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, ClientBucket>();

/**
 * Sliding-window token bucket rate limiter.
 */
export function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const identifier = (req.headers["x-api-key"] as string) || req.ip || "global_client";
  const now = Date.now();
  const limit = config.RATE_LIMIT_MAX_REQUESTS;
  const windowMs = config.RATE_LIMIT_WINDOW_MS;

  let bucket = buckets.get(identifier);
  if (!bucket) {
    bucket = { tokens: limit, lastRefill: now };
    buckets.set(identifier, bucket);
  } else {
    // Refill tokens proportionally to elapsed time
    const elapsed = now - bucket.lastRefill;
    if (elapsed > 0) {
      const refill = (elapsed / windowMs) * limit;
      bucket.tokens = Math.min(limit, bucket.tokens + refill);
      bucket.lastRefill = now;
    }
  }

  res.setHeader("X-RateLimit-Limit", limit);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, Math.floor(bucket.tokens)));
  res.setHeader("X-RateLimit-Reset", Math.ceil((bucket.lastRefill + windowMs) / 1000));

  if (bucket.tokens < 1) {
    return res.status(429).json({
      type: "https://api.universalmemory.ai/errors/rate-limit-exceeded",
      title: "Too Many Requests",
      status: 429,
      detail: `Rate limit of ${limit} requests per minute exceeded. Please retry after ${Math.ceil((bucket.lastRefill + windowMs - now) / 1000)} seconds.`
    });
  }

  bucket.tokens -= 1;
  next();
}
