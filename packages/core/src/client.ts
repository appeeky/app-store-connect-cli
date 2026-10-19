import {
  KeyTokenProvider,
  StaticTokenProvider,
  resolveCredentials,
  type ApiKeyCredentials,
  type ResolveCredentialsOptions,
  type TokenProvider,
} from "./auth.js";
import { ApiError, AuthError, ReadOnlyError, ValidationError, formatAppleErrors, type AppleErrorEntry } from "./errors.js";
import { maybeGunzip } from "./gzip.js";
import { buildQuery, type CollectedList, type JsonApiDocument, type Query, type Resource } from "./jsonapi.js";
import { isRetryableError, parseRetryAfter, withRetry, type RetryOptions } from "./retry.js";
import { AppsApi } from "./resources/apps.js";
import { VersionsApi } from "./resources/versions.js";
import { SubmissionsApi } from "./resources/submissions.js";
import { BuildsApi } from "./resources/builds.js";
import { TestFlightApi } from "./resources/testflight.js";
import { CustomerReviewsApi } from "./resources/reviews.js";
import { MediaApi } from "./resources/media.js";
import { InAppPurchasesApi } from "./resources/iap.js";
import { SubscriptionsApi } from "./resources/subscriptions.js";
import { UsersApi } from "./resources/users.js";
import { SigningApi } from "./resources/signing.js";
import { ReportsApi } from "./resources/reports.js";

export const ASC_BASE_URL = "https://api.appstoreconnect.apple.com";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface AppStoreConnectClientOptions extends ResolveCredentialsOptions {
  /** Already-resolved key (skips flag/env resolution). */
  credentials?: ApiKeyCredentials;
  readOnly?: boolean;
  /** Vendor number for sales and finance reports. */
  vendorNumber?: string;
  baseUrl?: string;
  /** Per-request timeout in milliseconds (default 60s). */
  timeoutMs?: number;
  retry?: RetryOptions;
  /** Injected fetch (tests, proxies). */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** Accept header (default application/json). */
  accept?: string;
  /** How to read the response body. */
  responseType?: "json" | "bytes";
  /** Label for read-only errors; defaults to "METHOD path". */
  operation?: string;
}

interface ClientInit {
  tokens: TokenProvider;
  authMode: "apiKey" | "accessToken";
  keyId?: string;
  issuerId?: string;
  readOnly: boolean;
  vendorNumber?: string;
  baseUrl: string;
  timeoutMs: number;
  retry: RetryOptions;
  fetch: typeof fetch;
}

const API_PATH = /^\/v\d+\/[A-Za-z0-9_\-./{}%[\]=&?,:+@]*$/;
const IDEMPOTENT: ReadonlySet<string> = new Set(["GET", "PUT", "PATCH", "DELETE"]);

/** Paths are relative to the API host and start with a version, e.g. /v1/apps. */
export function assertApiPath(path: string): void {
  if (!API_PATH.test(path) || path.includes("..") || path.includes("//")) {
    throw new ValidationError(
      `Invalid App Store Connect path "${path}". Use a path under /v1, /v2… such as /v1/apps.`,
    );
  }
}

export class AppStoreConnectClient {
  readonly readOnly: boolean;
  readonly authMode: "apiKey" | "accessToken";
  readonly keyId?: string;
  readonly issuerId?: string;
  readonly vendorNumber?: string;
  readonly baseUrl: string;

  readonly apps: AppsApi;
  readonly versions: VersionsApi;
  readonly submissions: SubmissionsApi;
  readonly builds: BuildsApi;
  readonly testflight: TestFlightApi;
  readonly reviews: CustomerReviewsApi;
  readonly media: MediaApi;
  readonly iap: InAppPurchasesApi;
  readonly subscriptions: SubscriptionsApi;
  readonly users: UsersApi;
  readonly signing: SigningApi;
  readonly reports: ReportsApi;

  private readonly tokens: TokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryOptions: RetryOptions;

  private constructor(init: ClientInit) {
    this.tokens = init.tokens;
    this.authMode = init.authMode;
    this.keyId = init.keyId;
    this.issuerId = init.issuerId;
    this.readOnly = init.readOnly;
    this.vendorNumber = init.vendorNumber;
    this.baseUrl = init.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = init.timeoutMs;
    this.retryOptions = init.retry;
    this.fetchImpl = init.fetch;

    this.apps = new AppsApi(this);
    this.versions = new VersionsApi(this);
    this.submissions = new SubmissionsApi(this);
    this.builds = new BuildsApi(this);
    this.testflight = new TestFlightApi(this);
    this.reviews = new CustomerReviewsApi(this);
    this.media = new MediaApi(this);
    this.iap = new InAppPurchasesApi(this);
    this.subscriptions = new SubscriptionsApi(this);
    this.users = new UsersApi(this);
    this.signing = new SigningApi(this);
    this.reports = new ReportsApi(this);
  }

  /**
   * Client for an API key from options or the environment
   * (`ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY` / `ASC_PRIVATE_KEY_PATH`).
   * Use `ClientRegistry` to read named accounts from the config file.
   */
  static create(options: AppStoreConnectClientOptions = {}): AppStoreConnectClient {
    const credentials = options.credentials ?? resolveCredentials(options);
    if (!credentials) {
      throw new AuthError(
        "No App Store Connect API key found. Pass --key-id/--issuer-id/--private-key, set ASC_KEY_ID/ASC_ISSUER_ID/ASC_PRIVATE_KEY_PATH, or add an account with `appstore accounts add`.",
      );
    }
    return AppStoreConnectClient.fromCredentials(credentials, options);
  }

  static fromCredentials(
    credentials: ApiKeyCredentials,
    options: Omit<AppStoreConnectClientOptions, "credentials"> = {},
  ): AppStoreConnectClient {
    return new AppStoreConnectClient({
      tokens: new KeyTokenProvider(credentials),
      authMode: "apiKey",
      keyId: credentials.keyId,
      issuerId: credentials.issuerId,
      readOnly: options.readOnly ?? false,
      vendorNumber: options.vendorNumber,
      baseUrl: options.baseUrl ?? ASC_BASE_URL,
      timeoutMs: options.timeoutMs ?? 60_000,
      retry: options.retry ?? {},
      fetch: options.fetch ?? fetch,
    });
  }

  /**
   * Client for an already-signed App Store Connect token (hosted mode: the
   * token comes from Appeeky and the key stays there). The token is not
   * refreshed; build a new client per request.
   */
  static fromAccessToken(
    accessToken: string,
    options: {
      readOnly?: boolean;
      vendorNumber?: string | null;
      keyId?: string | null;
      issuerId?: string | null;
      baseUrl?: string;
      timeoutMs?: number;
      retry?: RetryOptions;
      fetch?: typeof fetch;
    } = {},
  ): AppStoreConnectClient {
    return new AppStoreConnectClient({
      tokens: new StaticTokenProvider(accessToken),
      authMode: "accessToken",
      keyId: options.keyId ?? undefined,
      issuerId: options.issuerId ?? undefined,
      readOnly: options.readOnly ?? false,
      vendorNumber: options.vendorNumber ?? undefined,
      baseUrl: options.baseUrl ?? ASC_BASE_URL,
      timeoutMs: options.timeoutMs ?? 60_000,
      retry: options.retry ?? {},
      fetch: options.fetch ?? fetch,
    });
  }

  /**
   * Client without a key, for local config operations that never call Apple.
   * Any API call fails with an AuthError.
   */
  static unauthenticated(options: { readOnly?: boolean } = {}): AppStoreConnectClient {
    return new AppStoreConnectClient({
      tokens: {
        getToken: async () => {
          throw new AuthError("No App Store Connect API key configured for this call.");
        },
      },
      authMode: "apiKey",
      readOnly: options.readOnly ?? false,
      baseUrl: ASC_BASE_URL,
      timeoutMs: 60_000,
      retry: {},
      fetch,
    });
  }

  assertWritable(operation: string): void {
    if (this.readOnly) throw new ReadOnlyError(operation);
  }

  /** Bearer token for the next request (signed or cached). */
  token(): Promise<string> {
    return this.tokens.getToken();
  }

  whoami(): {
    authMode: "apiKey" | "accessToken";
    keyId?: string;
    issuerId?: string;
    keyType?: "team" | "individual";
    vendorNumber?: string;
    readOnly: boolean;
  } {
    return {
      authMode: this.authMode,
      keyId: this.keyId,
      issuerId: this.issuerId,
      keyType: this.authMode === "apiKey" ? (this.issuerId ? "team" : "individual") : undefined,
      vendorNumber: this.vendorNumber,
      readOnly: this.readOnly,
    };
  }

  /**
   * Call the App Store Connect API. Non-GET methods are refused in read-only
   * mode. Retries 429 (honoring Retry-After) for every method, and 5xx/network
   * errors for idempotent methods only, so a create is never sent twice.
   */
  async request<T = unknown>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const url = path.startsWith("https://") ? this.assertSameOrigin(path) : this.urlFor(path, options.query);
    if (method !== "GET") this.assertWritable(options.operation ?? `${method} ${new URL(url).pathname}`);

    const shouldRetry = (error: unknown) =>
      isRetryableError(error) && (IDEMPOTENT.has(method) || (error as { status?: number }).status === 429);

    return withRetry(
      async () => {
        const token = await this.tokens.getToken();
        const headers: Record<string, string> = {
          authorization: `Bearer ${token}`,
          accept: options.accept ?? "application/json",
        };
        let body: string | undefined;
        if (options.body !== undefined) {
          headers["content-type"] = "application/json";
          body = JSON.stringify(options.body);
        }
        const res = await this.send(url, { method, headers, body }, method);
        if (!res.ok) throw await this.toApiError(res, method, url);
        if (res.status === 204) return undefined as T;
        if (options.responseType === "bytes") {
          return Buffer.from(await res.arrayBuffer()) as T;
        }
        const text = await res.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as T;
        }
      },
      { ...this.retryOptions, shouldRetry },
    );
  }

  get<T = JsonApiDocument>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  post<T = JsonApiDocument>(path: string, body?: unknown, operation?: string): Promise<T> {
    return this.request<T>("POST", path, { body, operation });
  }

  patch<T = JsonApiDocument>(path: string, body?: unknown, operation?: string): Promise<T> {
    return this.request<T>("PATCH", path, { body, operation });
  }

  delete<T = void>(path: string, body?: unknown, operation?: string): Promise<T> {
    return this.request<T>("DELETE", path, { body, operation });
  }

  /** Download a binary GET response (reports), gunzipping it when compressed. */
  async download(path: string, query?: Query): Promise<Buffer> {
    const bytes = await this.request<Buffer>("GET", path, {
      query,
      accept: "application/a-gzip, application/json",
      responseType: "bytes",
    });
    return maybeGunzip(bytes);
  }

  /**
   * Collect a list endpoint across pages by following `links.next`.
   */
  async paginate<T = Resource>(
    path: string,
    query: Query = {},
    options: { maxItems?: number; maxPages?: number } = {},
  ): Promise<CollectedList<T>> {
    const maxItems = options.maxItems ?? Number.POSITIVE_INFINITY;
    const maxPages = options.maxPages ?? 500;
    const data: T[] = [];
    const included: Resource[] = [];
    const seen = new Set<string>();
    let total: number | undefined;
    let pages = 0;
    let next: string | undefined = this.urlFor(path, { limit: 200, ...query });
    let truncated = false;

    while (next) {
      const doc: JsonApiDocument<T[]> = await this.request<JsonApiDocument<T[]>>("GET", next);
      pages += 1;
      total ??= doc.meta?.paging?.total;
      for (const item of doc.data ?? []) {
        if (data.length >= maxItems) break;
        data.push(item);
      }
      for (const inc of doc.included ?? []) {
        const key = `${inc.type}:${inc.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          included.push(inc);
        }
      }
      next = doc.links?.next;
      if (next && (data.length >= maxItems || pages >= maxPages)) {
        truncated = true;
        break;
      }
    }
    return { data, included, meta: { total, pages, truncated } };
  }

  /** One page, or every page when `all` is set. */
  async list<T = Resource>(
    path: string,
    query: Query = {},
    options: { all?: boolean; maxItems?: number } = {},
  ): Promise<JsonApiDocument<T[]> | CollectedList<T>> {
    if (options.all || options.maxItems !== undefined) {
      return this.paginate<T>(path, query, { maxItems: options.maxItems });
    }
    return this.get<JsonApiDocument<T[]>>(path, query);
  }

  /**
   * Fetch a URL outside the API (upload parts, presigned report segments).
   * Never sends the App Store Connect token.
   */
  async fetchExternal(url: string, init: RequestInit & { idempotent?: boolean } = {}): Promise<Response> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new ValidationError(`Refusing non-HTTPS URL: ${parsed.origin}`);
    const method = (init.method ?? "GET").toUpperCase();
    const idempotent = init.idempotent ?? IDEMPOTENT.has(method);
    return withRetry(
      async () => {
        const res = await this.send(url, init, method);
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new ApiError(`${method} ${parsed.host}${parsed.pathname} failed: HTTP ${res.status}${text ? ` ${text.slice(0, 300)}` : ""}`, {
            status: res.status,
            retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
            method,
            path: parsed.pathname,
          });
        }
        return res;
      },
      { ...this.retryOptions, shouldRetry: (e) => isRetryableError(e) && (idempotent || (e as { status?: number }).status === 429) },
    );
  }

  private urlFor(path: string, query?: Query): string {
    assertApiPath(path.split("?")[0] ?? path);
    const [bare, existing] = path.split("?", 2);
    const extra = buildQuery(query);
    const qs = existing ? `?${existing}${extra ? `&${extra.slice(1)}` : ""}` : extra;
    return `${this.baseUrl}${bare}${qs}`;
  }

  private assertSameOrigin(url: string): string {
    if (new URL(url).origin !== new URL(this.baseUrl).origin) {
      throw new ValidationError(`Refusing to send the App Store Connect token to ${new URL(url).origin}`);
    }
    return url;
  }

  private async send(url: string, init: RequestInit, method: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(this.timeoutMs) });
    } catch (cause) {
      const name = (cause as { name?: string })?.name;
      const path = new URL(url).pathname;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new ApiError(`${method} ${path} timed out after ${this.timeoutMs} ms`, { code: "TIMEOUT", method, path, cause });
      }
      const code = (cause as { cause?: { code?: string } })?.cause?.code;
      throw new ApiError(`${method} ${path} failed: ${(cause as Error)?.message ?? String(cause)}${code ? ` (${code})` : ""}`, {
        code: "NETWORK_ERROR",
        method,
        path,
        cause,
      });
    }
  }

  private async toApiError(res: Response, method: string, url: string): Promise<ApiError> {
    const path = new URL(url).pathname;
    const text = await res.text().catch(() => "");
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    const formatted = formatAppleErrors(body);
    const fallback = text && !body ? text.slice(0, 500) : res.statusText;
    const message = `App Store Connect ${method} ${path} failed (HTTP ${res.status})${formatted ? `:\n${formatted}` : fallback ? `: ${fallback}` : ""}`;
    return new ApiError(message, {
      status: res.status,
      errors: ((body as { errors?: AppleErrorEntry[] } | undefined)?.errors ?? []) as AppleErrorEntry[],
      retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
      method,
      path,
      details: body,
    });
  }
}
