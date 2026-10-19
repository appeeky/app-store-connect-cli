import { ApiError } from "./errors.js";

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  /** Replaceable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

const RETRYABLE_CODES = [
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNREFUSED",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "TIMEOUT",
  "NETWORK_ERROR",
];

export function isRetryableError(error: unknown): boolean {
  const status = getStatus(error);
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code: unknown }).code);
    return RETRYABLE_CODES.includes(code);
  }
  return false;
}

/**
 * Parse an HTTP Retry-After header (seconds or an HTTP date) into milliseconds.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/**
 * Run `fn` with exponential backoff. When the error carries `retryAfterMs`
 * (from Apple's Retry-After header) that wait is used instead, capped at
 * `maxDelayMs * 4` so a bad header cannot stall a CLI for an hour.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8_000;
  const shouldRetry = options.shouldRetry ?? isRetryableError;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error)) break;
      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const retryAfter =
        error instanceof ApiError && error.retryAfterMs !== undefined
          ? Math.min(error.retryAfterMs, maxDelayMs * 4)
          : undefined;
      await sleep(retryAfter ?? backoff);
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new ApiError(`Request failed after ${maxAttempts} attempts`, {
    status: getStatus(lastError),
    details: lastError,
  });
}
