interface RateLimitEntry {
  failures: number;
  resetAt: number;
}

const WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX_FAILURES = 5;

const attempts = new Map<string, RateLimitEntry>();

export function isRateLimited(key: string, maxFailures = DEFAULT_MAX_FAILURES): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry) return false;

  if (now > entry.resetAt) {
    attempts.delete(key);
    return false;
  }

  return entry.failures >= maxFailures;
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now > entry.resetAt) {
    attempts.set(key, {
      failures: 1,
      resetAt: now + WINDOW_MS,
    });
  } else {
    entry.failures += 1;
  }
}

export function resetRateLimit(key: string): void {
  attempts.delete(key);
}

export function clearAllRateLimits(): void {
  attempts.clear();
}
