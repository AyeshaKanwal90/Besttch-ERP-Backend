import rateLimit, { MemoryStore } from "express-rate-limit";
import { failure } from "../utils/apiResponse";

// Each limiter gets its own store so tests can reset them.
const stores: MemoryStore[] = [];

function limiter(windowMs: number, limit: number, message: string) {
  const store = new MemoryStore();
  stores.push(store);

  return rateLimit({
    windowMs,
    limit,
    store,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      failure(res, 429, message);
    },
  });
}

export const loginRateLimiter = limiter(
  60 * 1000,
  5,
  "Too many login attempts. Please wait a minute and try again."
);

export const forgotPasswordRateLimiter = limiter(
  15 * 60 * 1000,
  5,
  "Too many password reset requests. Please try again in 15 minutes."
);

export const resetPasswordRateLimiter = limiter(
  15 * 60 * 1000,
  10,
  "Too many password reset attempts. Please try again in 15 minutes."
);

/** Clears every limiter's counters. For tests. */
export async function resetRateLimits() {
  await Promise.all(stores.map((store) => store.resetAll()));
}
