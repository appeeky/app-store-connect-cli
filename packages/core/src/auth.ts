import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { AuthError } from "./errors.js";

/** App Store Connect JWT audience. */
export const ASC_AUDIENCE = "appstoreconnect-v1";
/** Apple rejects tokens that live longer than 20 minutes. */
export const MAX_TOKEN_LIFETIME_SECONDS = 20 * 60;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 19 * 60;
/** Refresh a cached token this long before it expires. */
const REFRESH_MARGIN_SECONDS = 60;

/**
 * An App Store Connect API key. Team keys have an issuer id; Individual keys
 * do not (their tokens carry `sub: "user"` instead of `iss`).
 */
export interface ApiKeyCredentials {
  issuerId?: string;
  keyId: string;
  /** PEM contents of the .p8 key. */
  privateKey: string;
  /** Where the key came from (for messages only). */
  source?: string;
}

export interface ResolveCredentialsOptions {
  issuerId?: string;
  keyId?: string;
  /** Path to a .p8 file, or the PEM itself (`\n` escapes allowed). */
  privateKey?: string;
  env?: NodeJS.ProcessEnv;
}

export function isPem(value: string): boolean {
  return value.includes("-----BEGIN");
}

/** Normalize an inline PEM: accept literal `\n` escapes and stray quotes. */
export function normalizePem(value: string): string {
  let pem = value.trim();
  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) {
    pem = pem.slice(1, -1);
  }
  pem = pem.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
  return pem.endsWith("\n") ? pem : `${pem}\n`;
}

/** Load a private key from a path or inline PEM. */
export function loadPrivateKey(pathOrPem: string): string {
  if (isPem(pathOrPem)) return normalizePem(pathOrPem);
  if (!existsSync(pathOrPem)) {
    throw new AuthError(`Private key file not found: ${pathOrPem}`);
  }
  return normalizePem(readFileSync(pathOrPem, "utf8"));
}

/**
 * Resolve an API key from explicit options, then the environment.
 *
 * Precedence:
 * 1. explicit `issuerId` / `keyId` / `privateKey` (CLI flags)
 * 2. `ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY` (inline PEM) or `ASC_PRIVATE_KEY_PATH`
 *
 * Returns undefined when neither a key id nor a private key is given, so the
 * caller can fall back to the config file. Throws when only half a key is set.
 */
export function resolveCredentials(
  options: ResolveCredentialsOptions = {},
): ApiKeyCredentials | undefined {
  const env = options.env ?? process.env;
  const keyId = options.keyId ?? env.ASC_KEY_ID;
  const issuerId = options.issuerId ?? env.ASC_ISSUER_ID;
  const keyRef = options.privateKey ?? env.ASC_PRIVATE_KEY ?? env.ASC_PRIVATE_KEY_PATH;

  if (!keyId && !keyRef) return undefined;
  if (!keyId) {
    throw new AuthError("A private key was given but no key id. Set --key-id or ASC_KEY_ID.");
  }
  if (!keyRef) {
    throw new AuthError(
      "A key id was given but no private key. Set --private-key, ASC_PRIVATE_KEY or ASC_PRIVATE_KEY_PATH.",
    );
  }
  const source = options.privateKey
    ? "--private-key"
    : env.ASC_PRIVATE_KEY
      ? "ASC_PRIVATE_KEY"
      : "ASC_PRIVATE_KEY_PATH";
  return {
    keyId,
    issuerId: issuerId || undefined,
    privateKey: loadPrivateKey(keyRef),
    source,
  };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export interface SignTokenOptions {
  /** Token lifetime in seconds (max 1200). */
  lifetimeSeconds?: number;
  /** Clock override for tests (seconds since epoch). */
  now?: number;
  /** Optional `scope` claim (list of allowed "METHOD /path" strings). */
  scope?: string[];
}

export interface SignedToken {
  token: string;
  /** Expiry in seconds since epoch. */
  expiresAt: number;
}

/**
 * Sign an App Store Connect API token: ES256 JWT with
 * header {alg, kid, typ} and payload {iss|sub, iat, exp, aud}.
 */
export function signToken(credentials: ApiKeyCredentials, options: SignTokenOptions = {}): SignedToken {
  const lifetime = options.lifetimeSeconds ?? DEFAULT_TOKEN_LIFETIME_SECONDS;
  if (lifetime <= 0 || lifetime > MAX_TOKEN_LIFETIME_SECONDS) {
    throw new AuthError(`Token lifetime must be between 1 and ${MAX_TOKEN_LIFETIME_SECONDS} seconds`);
  }
  let key: KeyObject;
  try {
    key = createPrivateKey(credentials.privateKey);
  } catch (cause) {
    throw new AuthError(
      `Could not read the private key${credentials.source ? ` from ${credentials.source}` : ""}. Expected the .p8 file Apple gave you.`,
      cause,
    );
  }
  if (key.asymmetricKeyType !== "ec") {
    throw new AuthError("App Store Connect keys are EC (P-256) keys; this key is not.");
  }

  const iat = Math.floor(options.now ?? Date.now() / 1000);
  const exp = iat + lifetime;
  const header = { alg: "ES256", kid: credentials.keyId, typ: "JWT" };
  const payload: Record<string, unknown> = credentials.issuerId
    ? { iss: credentials.issuerId, iat, exp, aud: ASC_AUDIENCE }
    : { sub: "user", iat, exp, aud: ASC_AUDIENCE };
  if (options.scope?.length) payload.scope = options.scope;

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return { token: `${signingInput}.${base64url(signature)}`, expiresAt: exp };
}

/** Something that hands out a bearer token for each request. */
export interface TokenProvider {
  getToken(): Promise<string>;
}

/** Signs tokens from an API key and reuses each one until ~1 minute before expiry. */
export class KeyTokenProvider implements TokenProvider {
  private cached?: SignedToken;

  constructor(
    readonly credentials: ApiKeyCredentials,
    private readonly options: { lifetimeSeconds?: number; clock?: () => number } = {},
  ) {}

  async getToken(): Promise<string> {
    const now = Math.floor((this.options.clock?.() ?? Date.now()) / 1000);
    if (this.cached && this.cached.expiresAt - REFRESH_MARGIN_SECONDS > now) {
      return this.cached.token;
    }
    this.cached = signToken(this.credentials, {
      lifetimeSeconds: this.options.lifetimeSeconds,
      now,
    });
    return this.cached.token;
  }
}

/** A token issued elsewhere (hosted mode). Never refreshed. */
export class StaticTokenProvider implements TokenProvider {
  constructor(private readonly token: string) {
    if (!token) throw new AuthError("Access token is empty");
  }

  async getToken(): Promise<string> {
    return this.token;
  }
}

/** Decode a JWT without verifying it (for diagnostics). */
export function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [h, p] = token.split(".");
  if (!h || !p) throw new AuthError("Not a JWT");
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as Record<string, unknown>,
    payload: JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Record<string, unknown>,
  };
}
