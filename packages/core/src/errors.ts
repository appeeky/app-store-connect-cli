export class AscError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: unknown;

  constructor(
    message: string,
    options?: { code?: string; status?: number; details?: unknown; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AscError";
    this.code = options?.code ?? "ASC_ERROR";
    this.status = options?.status;
    this.details = options?.details;
  }
}

export class AuthError extends AscError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "AUTH_ERROR", details });
    this.name = "AuthError";
  }
}

export class ValidationError extends AscError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "VALIDATION_ERROR", details });
    this.name = "ValidationError";
  }
}

export class ReadOnlyError extends AscError {
  constructor(operation: string) {
    super(`Cannot perform write operation "${operation}" in read-only mode`, {
      code: "READ_ONLY",
    });
    this.name = "ReadOnlyError";
  }
}

/** One entry of Apple's JSON:API `errors[]` array. */
export interface AppleErrorEntry {
  id?: string;
  status?: string;
  code?: string;
  title?: string;
  detail?: string;
  source?: { pointer?: string; parameter?: string; header?: string };
  meta?: {
    associatedErrors?: Record<string, AppleErrorEntry[]>;
    [key: string]: unknown;
  };
}

export class ApiError extends AscError {
  /** Parsed `errors[]` from Apple's response body, when there was one. */
  readonly errors: AppleErrorEntry[];
  /** Milliseconds Apple asked us to wait (Retry-After), if any. */
  readonly retryAfterMs?: number;
  readonly method?: string;
  readonly path?: string;

  constructor(
    message: string,
    options: {
      status?: number;
      errors?: AppleErrorEntry[];
      retryAfterMs?: number;
      method?: string;
      path?: string;
      details?: unknown;
      cause?: unknown;
      code?: string;
    } = {},
  ) {
    super(message, {
      code: options.code ?? "API_ERROR",
      status: options.status,
      details: options.details,
      cause: options.cause,
    });
    this.name = "ApiError";
    this.errors = options.errors ?? [];
    this.retryAfterMs = options.retryAfterMs;
    this.method = options.method;
    this.path = options.path;
  }
}

function formatEntry(entry: AppleErrorEntry): string {
  const head = [entry.status, entry.code].filter(Boolean).join(" ");
  const text = [entry.title, entry.detail]
    .filter((v, i, all) => Boolean(v) && all.indexOf(v) === i)
    .join(": ");
  const source = entry.source?.pointer ?? entry.source?.parameter ?? entry.source?.header;
  return [head, text].filter(Boolean).join(" ") + (source ? ` (at ${source})` : "");
}

/**
 * Turn Apple's error document into one readable message. Every `errors[]`
 * entry is kept, and so is `meta.associatedErrors`: that is where Apple lists
 * the real reasons a review submission or version cannot move forward.
 */
export function formatAppleErrors(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const lines: string[] = [];
  for (const raw of errors as AppleErrorEntry[]) {
    lines.push(formatEntry(raw));
    const associated = raw.meta?.associatedErrors;
    if (associated && typeof associated === "object") {
      for (const [resource, entries] of Object.entries(associated)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          lines.push(`  - ${resource}: ${formatEntry(entry)}`);
        }
      }
    }
  }
  return lines.join("\n");
}
