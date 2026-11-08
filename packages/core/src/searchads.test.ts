import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, saveConfig, setSearchAds, upsertAccount } from "./config.js";
import { ClientRegistry } from "./registry.js";
import { decodeJwt } from "./auth.js";
import { AuthError } from "./errors.js";
import {
  SearchAdsClient,
  SearchAdsError,
  isSearchAdsWrite,
  normalizeSearchAdsPath,
  parseSearchAdsPrivateKey,
  searchAdsClientSecret,
  searchAdsCredentialsFromEnv,
} from "./searchads.js";
import { json, mockFetch, testKey } from "./test-utils.js";

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "asc-searchads-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function setup() {
  const dir = tempDir();
  const ascKey = join(dir, "AuthKey_KA.p8");
  const asaKey = join(dir, "asa.pem");
  writeFileSync(ascKey, testKey().privatePem);
  writeFileSync(asaKey, testKey().privatePem);
  const configPath = join(dir, "config.json");
  let config = upsertAccount({}, "studio", { keyId: "KA", issuerId: "IA", privateKeyPath: ascKey });
  config = setSearchAds(config, "studio", { clientId: "SEARCHADS.c1", teamId: "SEARCHADS.t1", keyId: "AK1", privateKeyPath: asaKey, orgId: "111" });
  config = upsertAccount(config, "bare", { keyId: "KB", privateKeyPath: ascKey });
  saveConfig(config, configPath);
  return { dir, configPath, asaKey };
}

const creds = () => ({ clientId: "SEARCHADS.c", teamId: "SEARCHADS.t", keyId: "K1", privateKey: testKey().privatePem });

describe("Search Ads config", () => {
  it("round-trips the searchAds block and removes it", () => {
    const { configPath } = setup();
    const loaded = loadConfig(configPath);
    expect(loaded.accounts?.studio?.searchAds).toMatchObject({ clientId: "SEARCHADS.c1", teamId: "SEARCHADS.t1", keyId: "AK1", orgId: "111" });
    expect(loaded.accounts?.studio?.keyId).toBe("KA");
    const removed = setSearchAds(loaded, "studio", undefined);
    expect(removed.accounts?.studio).not.toHaveProperty("searchAds");
    expect(removed.accounts?.studio?.keyId).toBe("KA");
    expect(() => setSearchAds(loaded, "nope", undefined)).toThrow(/Unknown account/);
  });

  it("keeps old config files valid", () => {
    const path = join(tempDir(), "config.json");
    writeFileSync(path, JSON.stringify({ defaultAccount: "a", accounts: { a: { keyId: "K", privateKeyPath: "/a.p8" } } }));
    const registry = ClientRegistry.load({ configPath: path, env: {} });
    expect(registry.listAccounts()[0]).toMatchObject({ id: "a", searchAds: false });
  });

  it("lists whether an account has Search Ads without secrets", () => {
    const { configPath } = setup();
    const rows = ClientRegistry.load({ configPath, env: {} }).listAccounts();
    expect(rows.map((r) => [r.id, r.searchAds, r.searchAdsOrgId])).toEqual([
      ["bare", false, undefined],
      ["studio", true, "111"],
    ]);
    expect(JSON.stringify(rows)).not.toContain("PRIVATE KEY");
  });
});

describe("Search Ads credentials precedence", () => {
  const envFor = (pem: string) => ({
    ASA_CLIENT_ID: "SEARCHADS.env",
    ASA_KEY_ID: "ENVKEY",
    ASA_PRIVATE_KEY: pem.replace(/\n/g, "\\n"),
    ASA_ORG_ID: "999",
  });

  it("uses ASA_* env over the default account unless an account is named", () => {
    const { configPath } = setup();
    const env = envFor(testKey().privatePem);
    const fromEnv = ClientRegistry.load({ configPath, env }).searchAdsCredentials();
    expect(fromEnv.accountId).toBeUndefined();
    expect(fromEnv.credentials).toMatchObject({ clientId: "SEARCHADS.env", teamId: "SEARCHADS.env", keyId: "ENVKEY", orgId: "999", source: "ASA_PRIVATE_KEY" });
    expect(fromEnv.credentials.privateKey).toContain("\n");

    const named = ClientRegistry.load({ configPath, env, account: "studio" }).searchAdsCredentials();
    expect(named.accountId).toBe("studio");
    expect(named.credentials).toMatchObject({ clientId: "SEARCHADS.c1", teamId: "SEARCHADS.t1", keyId: "AK1", orgId: "111" });
  });

  it("falls back to the default account and fills the org from ASA_ORG_ID", () => {
    const { configPath } = setup();
    const config = loadConfig(configPath);
    saveConfig(setSearchAds(config, "studio", { ...config.accounts!.studio!.searchAds!, orgId: undefined }), configPath);
    const r = ClientRegistry.load({ configPath, env: { ASA_ORG_ID: "42" } }).searchAdsCredentials();
    expect(r).toMatchObject({ accountId: "studio", credentials: { clientId: "SEARCHADS.c1", orgId: "42" } });
  });

  it("reads ASA_PRIVATE_KEY_PATH and rejects half a key", () => {
    const { asaKey } = setup();
    expect(searchAdsCredentialsFromEnv({ ASA_CLIENT_ID: "c", ASA_TEAM_ID: "t", ASA_KEY_ID: "k", ASA_PRIVATE_KEY_PATH: asaKey })).toMatchObject({
      teamId: "t",
      source: "ASA_PRIVATE_KEY_PATH",
    });
    expect(searchAdsCredentialsFromEnv({})).toBeUndefined();
    expect(() => searchAdsCredentialsFromEnv({ ASA_CLIENT_ID: "c" })).toThrow(/ASA_KEY_ID, ASA_PRIVATE_KEY or ASA_PRIVATE_KEY_PATH/);
  });

  it("explains how to add a key when the account has none", () => {
    const { configPath } = setup();
    const registry = ClientRegistry.load({ configPath, env: {}, account: "bare" });
    expect(() => registry.searchAdsCredentials()).toThrow(AuthError);
    expect(() => registry.searchAdsCredentials()).toThrow(/Account "bare" has no Apple Search Ads key\. Add one: appstore accounts search-ads bare/);
  });
});

describe("Search Ads client secret", () => {
  it("signs an ES256 JWT with the shape Apple expects", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "sec1", format: "pem" }).toString();
    const secret = searchAdsClientSecret({ clientId: "SEARCHADS.c", teamId: "SEARCHADS.t", keyId: "K1", privateKey: pem }, { now: 1_700_000_000 });
    const { header, payload } = decodeJwt(secret);
    expect(header).toEqual({ alg: "ES256", kid: "K1", typ: "JWT" });
    expect(payload).toEqual({ sub: "SEARCHADS.c", aud: "https://appleid.apple.com", iss: "SEARCHADS.t", iat: 1_700_000_000, exp: 1_700_003_000 });
    const [h, p, s] = secret.split(".");
    const ok = verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url"));
    expect(ok).toBe(true);
  });

  it("rejects a public key with a clear message", () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(() => parseSearchAdsPrivateKey(pub)).toThrow(/is a public key/);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => parseSearchAdsPrivateKey(rsa)).toThrow(/not an EC/);
  });
});

describe("SearchAdsClient", () => {
  function client(responder: Parameters<typeof mockFetch>[0], orgId?: string) {
    const mock = mockFetch(responder);
    return { client: new SearchAdsClient({ ...creds(), orgId }, { fetch: mock.fetch }), calls: mock.calls };
  }
  const token = () => json({ access_token: "tok", token_type: "Bearer", expires_in: 3600 });

  it("signs in once, sends the org header, and skips it for acls", async () => {
    const { client: c, calls } = client((call) => (call.url.includes("appleid") ? token() : json({ data: [{ orgId: 7, orgName: "Studio" }] })));
    await c.request("GET", "/api/v5/campaigns?limit=1000");
    await c.request("POST", "/api/v5/reports/campaigns", { startTime: "2026-01-01" });

    expect(calls[0]!.url).toBe("https://appleid.apple.com/auth/oauth2/token");
    const form = new URLSearchParams(String(calls[0]!.rawBody));
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe("SEARCHADS.c");
    expect(form.get("scope")).toBe("searchadsorg");
    expect(decodeJwt(form.get("client_secret")!).payload.sub).toBe("SEARCHADS.c");

    const acls = calls[1]!;
    expect(acls.url).toBe("https://api.searchads.apple.com/api/v5/acls");
    expect(acls.headers["x-ap-context"]).toBeUndefined();
    expect(acls.headers.authorization).toBe("Bearer tok");

    expect(calls[2]!.url).toBe("https://api.searchads.apple.com/api/v5/campaigns?limit=1000");
    expect(calls[2]!.headers["x-ap-context"]).toBe("orgId=7");
    expect(calls[3]!.method).toBe("POST");
    expect(calls[3]!.headers["x-ap-context"]).toBe("orgId=7");
    expect(calls[3]!.body).toEqual({ startTime: "2026-01-01" });
    expect(calls.filter((x) => x.url.includes("appleid"))).toHaveLength(1);
    expect(calls.filter((x) => x.url.endsWith("/acls"))).toHaveLength(1);
  });

  it("uses a configured org without asking for acls", async () => {
    const { client: c, calls } = client((call) => (call.url.includes("appleid") ? token() : json({ data: [] })), "55");
    await c.request("GET", "/v5/campaigns");
    expect(calls.map((x) => x.url)).toEqual(["https://appleid.apple.com/auth/oauth2/token", "https://api.searchads.apple.com/api/v5/campaigns"]);
    expect(calls[1]!.headers["x-ap-context"]).toBe("orgId=55");
  });

  it("maps Apple's error body", async () => {
    const { client: c } = client(
      (call) =>
        call.url.includes("appleid")
          ? token()
          : json({ data: null, error: { errors: [{ messageCode: "INVALID_INPUT", message: "startTime is invalid", field: "startTime" }] } }, 400),
      "55",
    );
    const error = (await c.request("POST", "/api/v5/reports/campaigns", {}).catch((e: unknown) => e)) as SearchAdsError;
    expect(error).toBeInstanceOf(SearchAdsError);
    expect(error.status).toBe(400);
    expect(error.message).toBe("Apple Search Ads 400: startTime is invalid (field: startTime) on POST /api/v5/reports/campaigns");
    expect(error.toJSON()).toMatchObject({ code: "SEARCH_ADS_ERROR", status: 400, messageCode: "INVALID_INPUT", field: "startTime" });
  });

  it("lists orgs when the key reaches several", async () => {
    const { client: c } = client((call) =>
      call.url.includes("appleid") ? token() : json({ data: [{ orgId: 1, orgName: "A" }, { orgId: 2, orgName: "B" }] }),
    );
    await expect(c.request("GET", "/api/v5/campaigns")).rejects.toThrow(/reaches 2 organizations: 1 \(A\), 2 \(B\)/);
  });

  it("reports a failed sign-in", async () => {
    const { client: c } = client(() => json({ error: "invalid_client" }, 401), "1");
    await expect(c.request("GET", "/api/v5/campaigns")).rejects.toThrow(/sign-in failed: invalid_client/);
  });

  it("checks paths and tells reads from writes", () => {
    expect(normalizeSearchAdsPath("api/v5/campaigns")).toBe("/api/v5/campaigns");
    expect(normalizeSearchAdsPath("https://api.searchads.apple.com/api/v5/acls")).toBe("/api/v5/acls");
    expect(() => normalizeSearchAdsPath("/campaigns")).toThrow(/must start with \/api\/v5/);
    expect(() => normalizeSearchAdsPath("https://evil.example/api/v5/acls")).toThrow(/must be on/);
    expect(() => normalizeSearchAdsPath("/api/v5/../x")).toThrow(/\.\./);
    expect(isSearchAdsWrite("GET", "/api/v5/campaigns")).toBe(false);
    expect(isSearchAdsWrite("POST", "/api/v5/reports/campaigns/1/keywords")).toBe(false);
    expect(isSearchAdsWrite("POST", "/api/v5/campaigns/find")).toBe(false);
    expect(isSearchAdsWrite("POST", "/api/v5/campaigns")).toBe(true);
    expect(isSearchAdsWrite("PUT", "/api/v5/campaigns/1")).toBe(true);
  });
});
