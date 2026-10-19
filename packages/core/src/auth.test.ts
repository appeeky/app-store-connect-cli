import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ASC_AUDIENCE,
  KeyTokenProvider,
  decodeJwt,
  normalizePem,
  resolveCredentials,
  signToken,
} from "./auth.js";
import { AuthError } from "./errors.js";
import { testKey } from "./test-utils.js";

const key = testKey();

function verifySignature(token: string, publicKey = key.publicKey): boolean {
  const [h, p, s] = token.split(".");
  return verify(
    "sha256",
    Buffer.from(`${h}.${p}`),
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(s!, "base64url"),
  );
}

describe("signToken", () => {
  it("signs an ES256 team-key token Apple can verify", () => {
    const now = 1_800_000_000;
    const { token, expiresAt } = signToken(
      { keyId: "ABC123DEFG", issuerId: "57246542-96fe-1a63-e053-0824d011072a", privateKey: key.privatePem },
      { now, lifetimeSeconds: 1200 },
    );
    const { header, payload } = decodeJwt(token);
    expect(header).toEqual({ alg: "ES256", kid: "ABC123DEFG", typ: "JWT" });
    expect(payload).toEqual({
      iss: "57246542-96fe-1a63-e053-0824d011072a",
      iat: now,
      exp: now + 1200,
      aud: ASC_AUDIENCE,
    });
    expect(expiresAt).toBe(now + 1200);
    // ieee-p1363: raw r||s, 64 bytes for P-256 (not DER)
    expect(Buffer.from(token.split(".")[2]!, "base64url")).toHaveLength(64);
    expect(verifySignature(token)).toBe(true);
  });

  it("uses sub=user and no iss for Individual keys", () => {
    const { token } = signToken({ keyId: "INDIV1", privateKey: key.privatePem }, { now: 1000 });
    const { payload } = decodeJwt(token);
    expect(payload.sub).toBe("user");
    expect(payload).not.toHaveProperty("iss");
    expect(payload.aud).toBe("appstoreconnect-v1");
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(1200);
    expect(verifySignature(token)).toBe(true);
  });

  it("fails verification with a different key", () => {
    const other = testKey();
    const { token } = signToken({ keyId: "K", issuerId: "I", privateKey: key.privatePem });
    expect(verifySignature(token, other.publicKey)).toBe(false);
  });

  it("refuses lifetimes over 20 minutes and non-EC keys", () => {
    expect(() => signToken({ keyId: "K", issuerId: "I", privateKey: key.privatePem }, { lifetimeSeconds: 1201 })).toThrow(
      AuthError,
    );
    expect(() => signToken({ keyId: "K", issuerId: "I", privateKey: "not a key" })).toThrow(AuthError);
  });
});

describe("KeyTokenProvider", () => {
  it("reuses a token until about a minute before it expires", async () => {
    let nowMs = 1_800_000_000_000;
    const provider = new KeyTokenProvider(
      { keyId: "K", issuerId: "I", privateKey: key.privatePem },
      { lifetimeSeconds: 600, clock: () => nowMs },
    );
    const first = await provider.getToken();
    nowMs += 500_000; // 100 s left
    expect(await provider.getToken()).toBe(first);
    nowMs += 50_000; // 50 s left: inside the refresh margin
    const second = await provider.getToken();
    expect(second).not.toBe(first);
    expect(decodeJwt(second).payload.iat).toBe(Math.floor(nowMs / 1000));
  });
});

describe("resolveCredentials", () => {
  it("reads an inline PEM with \\n escapes from ASC_PRIVATE_KEY", () => {
    const escaped = key.privatePem.trim().replace(/\n/g, "\\n");
    const creds = resolveCredentials({
      env: { ASC_KEY_ID: "K1", ASC_ISSUER_ID: "I1", ASC_PRIVATE_KEY: escaped },
    });
    expect(creds?.keyId).toBe("K1");
    expect(creds?.issuerId).toBe("I1");
    expect(creds?.privateKey).toContain("\n");
    expect(creds?.privateKey).not.toContain("\\n");
    expect(() => signToken(creds!)).not.toThrow();
  });

  it("reads a key file path, and flags win over env", () => {
    const dir = mkdtempSync(join(tmpdir(), "asc-auth-"));
    try {
      const path = join(dir, "AuthKey_FLAG.p8");
      writeFileSync(path, key.privatePem);
      const creds = resolveCredentials({
        keyId: "FLAG",
        privateKey: path,
        env: { ASC_KEY_ID: "ENV", ASC_ISSUER_ID: "ENV_ISSUER", ASC_PRIVATE_KEY_PATH: "/nope.p8" },
      });
      expect(creds?.keyId).toBe("FLAG");
      expect(creds?.issuerId).toBe("ENV_ISSUER");
      expect(creds?.source).toBe("--private-key");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined with nothing set and throws on half a key", () => {
    expect(resolveCredentials({ env: {} })).toBeUndefined();
    expect(() => resolveCredentials({ env: { ASC_KEY_ID: "K" } })).toThrow(AuthError);
    expect(() => resolveCredentials({ env: { ASC_PRIVATE_KEY: key.privatePem } })).toThrow(AuthError);
    expect(() => resolveCredentials({ env: { ASC_KEY_ID: "K", ASC_PRIVATE_KEY_PATH: "/missing.p8" } })).toThrow(
      /not found/,
    );
  });

  it("normalizes quoted PEMs", () => {
    expect(normalizePem(`"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----"`)).toBe(
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
    );
  });
});
