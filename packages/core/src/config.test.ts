import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addAppToConfig,
  findAccountsForApp,
  listRegisteredApps,
  loadConfig,
  resolveAccountId,
  saveConfig,
  upsertAccount,
} from "./config.js";
import { ClientRegistry } from "./registry.js";
import { AuthError, ValidationError } from "./errors.js";
import { decodeJwt } from "./auth.js";
import { json, mockFetch, testKey } from "./test-utils.js";

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "asc-config-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("config multi-account", () => {
  it("saves accounts and apps and finds the owning account", () => {
    const path = join(tempDir(), "config.json");
    let config = upsertAccount({}, "team-a", { keyId: "KA", issuerId: "IA", privateKeyPath: "/a.p8" });
    config = addAppToConfig(config, "team-a", { appId: "111", bundleId: "com.a.app", name: "A" });
    config = addAppToConfig(config, "team-a", { appId: "112" });
    config = upsertAccount(config, "solo", { keyId: "KS", privateKeyPath: "/s.p8" });
    config = addAppToConfig(config, "solo", { appId: "999", bundleId: "com.solo" });
    saveConfig(config, path);

    const loaded = loadConfig(path);
    expect(loaded.defaultAccount).toBe("team-a");
    expect(listRegisteredApps(loaded)).toHaveLength(3);
    expect(findAccountsForApp(loaded, "com.solo")).toEqual(["solo"]);
    expect(findAccountsForApp(loaded, "111")).toEqual(["team-a"]);
    expect(resolveAccountId(loaded)).toBe("team-a");
    expect(() => resolveAccountId(loaded, "nope")).toThrow(ValidationError);
    expect(() => addAppToConfig(loaded, "solo", { appId: "com.not.numeric" })).toThrow(ValidationError);
  });
});

describe("ClientRegistry", () => {
  function setup() {
    const dir = tempDir();
    const keyPath = join(dir, "AuthKey_KA.p8");
    const soloPath = join(dir, "AuthKey_KS.p8");
    writeFileSync(keyPath, testKey().privatePem);
    writeFileSync(soloPath, testKey().privatePem);
    const configPath = join(dir, "config.json");
    let config = upsertAccount({}, "team-a", { keyId: "KA", issuerId: "IA", privateKeyPath: keyPath, vendorNumber: "V1" });
    config = upsertAccount(config, "solo", { keyId: "KS", privateKeyPath: soloPath });
    config = addAppToConfig(config, "solo", { appId: "999" });
    saveConfig(config, configPath);
    return { configPath };
  }

  it("routes by account, by registered app, and signs with the right key", async () => {
    const { configPath } = setup();
    const mock = mockFetch(() => json({ data: [] }));
    const registry = ClientRegistry.load({ configPath, env: {}, clientOptions: { fetch: mock.fetch } });

    const byApp = await registry.getClientForArgs({ appId: "999" });
    expect(byApp.accountId).toBe("solo");
    expect(byApp.client.whoami()).toMatchObject({ keyId: "KS", keyType: "individual" });

    const byDefault = await registry.getClientForArgs({});
    expect(byDefault.accountId).toBe("team-a");
    expect(byDefault.client.vendorNumber).toBe("V1");

    await byApp.client.apps.list();
    const { payload } = decodeJwt(mock.calls[0]!.headers.authorization!.slice(7));
    expect(payload.sub).toBe("user");
    expect(registry.listAccounts().map((a) => [a.id, a.keyType, a.isDefault])).toEqual([
      ["solo", "individual", false],
      ["team-a", "team", true],
    ]);
  });

  it("lets env credentials win unless an account is named", async () => {
    const { configPath } = setup();
    const pem = testKey().privatePem.replace(/\n/g, "\\n");
    const env = { ASC_KEY_ID: "ENVKEY", ASC_ISSUER_ID: "ENVISS", ASC_PRIVATE_KEY: pem };
    const registry = ClientRegistry.load({ configPath, env });
    expect((await registry.getClientForArgs({})).client.keyId).toBe("ENVKEY");
    const named = ClientRegistry.load({ configPath, env, account: "solo" });
    expect((await named.getClientForArgs({})).client.keyId).toBe("KS");
  });

  it("explains how to add a key when there is none", () => {
    const registry = ClientRegistry.load({ configPath: join(tempDir(), "missing.json"), env: {} });
    expect(() => registry.getClient()).toThrow(AuthError);
  });
});
