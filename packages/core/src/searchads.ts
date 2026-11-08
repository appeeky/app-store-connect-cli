import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { AscError, AuthError, ValidationError } from "./errors.js";
import { loadPrivateKey } from "./auth.js";

/**
 * Apple Search Ads API (Campaign Management API v5) on your own API user.
 *
 * Make the API user in Search Ads → Account Settings → API. You upload a
 * public key there and get a client id, team id and key id back. The private
 * EC key stays with you, next to the App Store Connect key.
 */

export const SEARCH_ADS_BASE_URL = "https://api.searchads.apple.com";
export const SEARCH_ADS_TOKEN_URL = "https://appleid.apple.com/auth/oauth2/token";
export const SEARCH_ADS_AUDIENCE = "https://appleid.apple.com";
/** Apple allows up to 180 days; a short secret is enough for one CLI run. */
const CLIENT_SECRET_LIFETIME_SECONDS = 3000;

/** The `searchAds` block of a config account. */
export interface SearchAdsAccountConfig {
  clientId: string;
  /** Defaults to clientId. */
  teamId?: string;
  keyId: string;
  /** Path to the EC private key PEM (preferred). */
  privateKeyPath?: string;
  /** Inline PEM (discouraged; prefer a path). */
  privateKey?: string;
  /** Organization id; when unset the CLI uses the only org the key reaches. */
  orgId?: string;
}

export interface SearchAdsCredentials {
  clientId: string;
  teamId: string;
  keyId: string;
  /** PEM contents of the EC private key. */
  privateKey: string;
  orgId?: string;
  /** Where the key came from (for messages only). */
  source?: string;
}

/**
 * Parse a PEM as an EC private key, with a clear message for the usual
 * mistake: passing the public key that was uploaded to Apple.
 */
export function parseSearchAdsPrivateKey(pem: string, source?: string): KeyObject {
  const where = source ? ` (${source})` : "";
  if (/-----BEGIN (RSA )?PUBLIC KEY-----/.test(pem) || /-----BEGIN CERTIFICATE-----/.test(pem)) {
    throw new AuthError(
      `The Search Ads key${where} is a public key. Use the EC private key you made for the API user, not the public key you uploaded to Apple.`,
    );
  }
  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch (cause) {
    throw new AuthError(
      `Could not read the Search Ads private key${where}. Expected an EC private key PEM (BEGIN EC PRIVATE KEY or BEGIN PRIVATE KEY).`,
      cause,
    );
  }
  if (key.asymmetricKeyType !== "ec") {
    throw new AuthError(`The Search Ads key${where} is not an EC (P-256) private key.`);
  }
  return key;
}

const env1 = (env: NodeJS.ProcessEnv, name: string) => {
  const v = env[name]?.trim();
  return v ? v : undefined;
};

/**
 * Read ASA_* from the environment. Returns undefined when none of
 * ASA_CLIENT_ID, ASA_KEY_ID, ASA_PRIVATE_KEY, ASA_PRIVATE_KEY_PATH is set,
 * and throws when only part of a key is set.
 */
export function searchAdsCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): SearchAdsCredentials | undefined {
  const clientId = env1(env, "ASA_CLIENT_ID");
  const keyId = env1(env, "ASA_KEY_ID");
  const inline = env1(env, "ASA_PRIVATE_KEY");
  const path = env1(env, "ASA_PRIVATE_KEY_PATH");
  const keyRef = inline ?? path;
  if (!clientId && !keyId && !keyRef) return undefined;
  const missing = [
    !clientId && "ASA_CLIENT_ID",
    !keyId && "ASA_KEY_ID",
    !keyRef && "ASA_PRIVATE_KEY or ASA_PRIVATE_KEY_PATH",
  ].filter(Boolean);
  if (missing.length) throw new AuthError(`Apple Search Ads needs ${missing.join(", ")} too.`);
  const source = inline ? "ASA_PRIVATE_KEY" : "ASA_PRIVATE_KEY_PATH";
  return {
    clientId: clientId!,
    teamId: env1(env, "ASA_TEAM_ID") ?? clientId!,
    keyId: keyId!,
    privateKey: loadPrivateKey(keyRef!),
    orgId: env1(env, "ASA_ORG_ID"),
    source,
  };
}

/** Build Search Ads credentials from a config account's `searchAds` block. */
export function searchAdsCredentialsFromConfig(accountId: string, config: SearchAdsAccountConfig): SearchAdsCredentials {
  if (!config.clientId) throw new ValidationError(`Account "${accountId}" Search Ads key has no clientId`);
  if (!config.keyId) throw new ValidationError(`Account "${accountId}" Search Ads key has no keyId`);
  const keyRef = config.privateKeyPath ?? config.privateKey;
  if (!keyRef) throw new ValidationError(`Account "${accountId}" Search Ads key has no privateKeyPath`);
  return {
    clientId: config.clientId,
    teamId: config.teamId || config.clientId,
    keyId: config.keyId,
    privateKey: loadPrivateKey(keyRef),
    orgId: config.orgId || undefined,
    source: config.privateKeyPath ?? `account ${accountId}`,
  };
}

/**
 * The client secret Apple wants: an ES256 JWT signed with the API user's key,
 * header {alg, kid, typ} and payload {sub: clientId, aud, iss: teamId, iat, exp}.
 */
export function searchAdsClientSecret(credentials: SearchAdsCredentials, options: { now?: number } = {}): string {
  const key = parseSearchAdsPrivateKey(credentials.privateKey, credentials.source);
  const iat = Math.floor(options.now ?? Date.now() / 1000);
  const header = { alg: "ES256", kid: credentials.keyId, typ: "JWT" };
  const payload = {
    sub: credentials.clientId,
    aud: SEARCH_ADS_AUDIENCE,
    iss: credentials.teamId,
    iat,
    exp: iat + CLIENT_SECRET_LIFETIME_SECONDS,
  };
  const b64 = (v: Buffer | string) => Buffer.from(v).toString("base64url");
  const input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}`;
  const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64(signature)}`;
}

/** One entry of Search Ads' `error.errors[]`. */
export interface SearchAdsErrorEntry {
  messageCode?: string;
  message?: string;
  field?: string;
}

/** A non-2xx answer from Search Ads (or a failed sign-in). */
export class SearchAdsError extends AscError {
  readonly errors: SearchAdsErrorEntry[];
  readonly method?: string;
  readonly path?: string;
  readonly body?: unknown;

  constructor(
    message: string,
    options: { status?: number; errors?: SearchAdsErrorEntry[]; method?: string; path?: string; body?: unknown; code?: string } = {},
  ) {
    super(message, { code: options.code ?? "SEARCH_ADS_ERROR", status: options.status });
    this.name = "SearchAdsError";
    this.errors = options.errors ?? [];
    this.method = options.method;
    this.path = options.path;
    this.body = options.body;
  }

  /** The shape the CLI prints with --json: `{"error": {...}}`. */
  toJSON(): Record<string, unknown> {
    const first = this.errors[0];
    return {
      code: this.code,
      status: this.status,
      message: this.message,
      ...(first?.messageCode ? { messageCode: first.messageCode } : {}),
      ...(first?.field ? { field: first.field } : {}),
      ...(this.method ? { method: this.method } : {}),
      ...(this.path ? { path: this.path } : {}),
      ...(this.errors.length ? { errors: this.errors } : {}),
    };
  }
}

export type SearchAdsMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface SearchAdsOrg {
  orgId: number | string;
  orgName?: string;
  currency?: string;
  paymentModel?: string;
  roleNames?: string[];
  timeZone?: string;
}

export interface SearchAdsClientOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  tokenUrl?: string;
  timeoutMs?: number;
}

/** Normalize a user path to `/api/v5/...` and check it stays on the API host. */
export function normalizeSearchAdsPath(path: string): string {
  let p = path.trim();
  if (/^https?:\/\//i.test(p)) {
    const url = new URL(p);
    if (url.origin !== SEARCH_ADS_BASE_URL) throw new ValidationError(`Search Ads path must be on ${SEARCH_ADS_BASE_URL}, got ${url.origin}`);
    p = url.pathname + url.search;
  }
  if (!p.startsWith("/")) p = `/${p}`;
  if (/^\/v\d+\//.test(p)) p = `/api${p}`;
  if (!/^\/api\/v\d+\//.test(p)) throw new ValidationError(`Search Ads path must start with /api/v5/, got ${path}`);
  if (/(^|\/)\.\.(\/|$|\?)/.test(p.split("?")[0]!)) throw new ValidationError(`Search Ads path must not contain "..": ${path}`);
  return p;
}

/** `/api/v5/acls` is the only call that takes no org context. */
export function isSearchAdsAclsPath(path: string): boolean {
  return /^\/api\/v\d+\/acls\/?$/.test(path.split("?")[0]!);
}

/**
 * Reads that Search Ads sends as POST: reports and `.../find` selector queries.
 * Everything else that is not GET changes campaigns.
 */
export function isSearchAdsWrite(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (m === "GET") return false;
  const pathname = path.split("?")[0]!;
  if (m === "POST" && (/\/reports(\/|$)/.test(pathname) || /\/find\/?$/.test(pathname))) return false;
  return true;
}

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorEntries(body: unknown): SearchAdsErrorEntry[] {
  const errors = (body as { error?: { errors?: unknown } } | undefined)?.error?.errors;
  return Array.isArray(errors) ? (errors as SearchAdsErrorEntry[]) : [];
}

/** Minimal Search Ads client: signs in once per instance and sends raw requests. */
export class SearchAdsClient {
  private token?: string;
  private orgId?: string;
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly tokenUrl: string;
  private readonly timeoutMs: number;

  constructor(
    readonly credentials: SearchAdsCredentials,
    options: SearchAdsClientOptions = {},
  ) {
    this.orgId = credentials.orgId;
    this.fetcher = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? SEARCH_ADS_BASE_URL).replace(/\/$/, "");
    this.tokenUrl = options.tokenUrl ?? SEARCH_ADS_TOKEN_URL;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  /** OAuth client-credentials sign-in; the token is reused for this client. */
  async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const res = await this.fetcher(this.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.credentials.clientId,
        client_secret: searchAdsClientSecret(this.credentials),
        scope: "searchadsorg",
      }).toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      const reason = [body.error, body.error_description].filter(Boolean).join(": ") || `HTTP ${res.status}`;
      throw new SearchAdsError(
        `Apple Search Ads sign-in failed: ${reason}. Check the client id, team id, key id and private key.`,
        { status: res.status, code: "SEARCH_ADS_AUTH_ERROR" },
      );
    }
    this.token = body.access_token;
    return this.token;
  }

  /**
   * Send one request. `path` is like `/api/v5/campaigns?limit=1000`. Adds
   * `X-AP-Context: orgId=…` except for `/api/v5/acls`. Returns the parsed
   * body; throws SearchAdsError on non-2xx.
   */
  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const m = method.toUpperCase();
    const p = normalizeSearchAdsPath(path);
    const headers: Record<string, string> = {
      authorization: `Bearer ${await this.accessToken()}`,
      accept: "application/json",
    };
    if (!isSearchAdsAclsPath(p)) headers["x-ap-context"] = `orgId=${await this.org()}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await this.fetcher(`${this.baseUrl}${p}`, {
      method: m,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const parsed = parseBody(await res.text());
    if (!res.ok) {
      const errors = errorEntries(parsed);
      const first = errors[0];
      const text = first
        ? [first.message ?? first.messageCode, first.field && `(field: ${first.field})`].filter(Boolean).join(" ")
        : `HTTP ${res.status}`;
      throw new SearchAdsError(`Apple Search Ads ${res.status}: ${text} on ${m} ${p.split("?")[0]}`, {
        status: res.status,
        errors,
        method: m,
        path: p,
        body: parsed,
      });
    }
    return parsed;
  }

  /** Organizations (ACLs) the API user reaches. */
  async orgs(): Promise<SearchAdsOrg[]> {
    const body = (await this.request("GET", "/api/v5/acls")) as { data?: SearchAdsOrg[] } | undefined;
    return body?.data ?? [];
  }

  /** The org: from the credentials, or the only one the key reaches. */
  async org(): Promise<string> {
    if (this.orgId) return this.orgId;
    const orgs = await this.orgs();
    const ids = [...new Set(orgs.map((o) => String(o.orgId)))];
    if (ids.length === 1) {
      this.orgId = ids[0]!;
      return this.orgId;
    }
    if (ids.length === 0) throw new SearchAdsError("The Search Ads key reaches no organization.", { code: "SEARCH_ADS_NO_ORG" });
    throw new SearchAdsError(
      `The Search Ads key reaches ${ids.length} organizations: ${orgs
        .map((o) => `${o.orgId}${o.orgName ? ` (${o.orgName})` : ""}`)
        .join(", ")}. Pick one with --org-id, ASA_ORG_ID or \`appstore accounts search-ads <account> --org-id …\`.`,
      { code: "SEARCH_ADS_ORG_REQUIRED" },
    );
  }
}
