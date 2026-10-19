import { z } from "zod";
import {
  addAppToConfig,
  defaultConfigPath,
  loadConfig,
  removeAppFromConfig,
  saveConfig,
  upsertAccount,
} from "../config.js";
import { ReadOnlyError, ValidationError } from "../errors.js";
import { ClientRegistry } from "../registry.js";
import type { AscOp } from "./shared.js";

/**
 * Local config operations (~/.config/appstore/config.json). They never call
 * Apple, so the hosted server leaves them out.
 */
export const ACCOUNT_OPS: AscOp[] = [
  {
    name: "appstore_list_accounts",
    group: "accounts",
    summary: "List configured API key accounts (local multi-key config)",
    write: false,
    shape: {},
    run: async () => {
      const registry = ClientRegistry.load({ env: {} });
      return { configPath: registry.configPath, accounts: registry.listAccounts() };
    },
  },
  {
    name: "appstore_list_registered_apps",
    group: "accounts",
    summary: "List apps saved in the local config (optional shortlist; use appstore_list_apps for Apple's list)",
    write: false,
    shape: { account: z.string().optional().describe("Account id") },
    run: async (_c, a) => {
      const registry = ClientRegistry.load({ env: {} });
      return { configPath: registry.configPath, apps: registry.listApps(a.account as string | undefined) };
    },
  },
  {
    name: "appstore_register_account",
    group: "accounts",
    summary: "Save or update a named account with an API key (key id, issuer id, .p8 path)",
    write: true,
    shape: {
      account: z.string().min(1).describe("Account id, e.g. my-team"),
      keyId: z.string().min(1),
      issuerId: z.string().optional().describe("Omit for Individual keys"),
      privateKeyPath: z.string().min(1).describe("Absolute path to AuthKey_XXXX.p8"),
      vendorNumber: z.string().optional(),
      defaultAppId: z.string().optional(),
      setDefault: z.boolean().optional(),
    },
    run: async (c, a) => {
      if (c.readOnly) throw new ReadOnlyError("appstore_register_account");
      const path = defaultConfigPath();
      const accountId = String(a.account);
      let config = upsertAccount(loadConfig(path), accountId, {
        keyId: a.keyId as string,
        issuerId: a.issuerId as string | undefined,
        privateKeyPath: a.privateKeyPath as string,
        vendorNumber: a.vendorNumber as string | undefined,
        defaultAppId: a.defaultAppId as string | undefined,
      });
      if (a.setDefault || !config.defaultAccount) config = { ...config, defaultAccount: accountId };
      saveConfig(config, path);
      return { ok: true, account: accountId, configPath: path };
    },
  },
  {
    name: "appstore_register_app",
    group: "accounts",
    summary: "Save an app under an account in the local config (for defaults and account routing)",
    write: true,
    shape: {
      account: z.string().min(1),
      appId: z.string().regex(/^\d+$/).describe("Apple app id"),
      bundleId: z.string().optional(),
      name: z.string().optional(),
      setDefault: z.boolean().optional(),
    },
    run: async (c, a) => {
      if (c.readOnly) throw new ReadOnlyError("appstore_register_app");
      const path = defaultConfigPath();
      const accountId = String(a.account);
      let config = loadConfig(path);
      if (!config.accounts?.[accountId]) {
        throw new ValidationError(`Unknown account "${accountId}". Call appstore_register_account first.`);
      }
      config = addAppToConfig(config, accountId, {
        appId: String(a.appId),
        bundleId: a.bundleId as string | undefined,
        name: a.name as string | undefined,
      });
      if (a.setDefault) config = upsertAccount(config, accountId, { defaultAppId: String(a.appId) });
      saveConfig(config, path);
      return { ok: true, account: accountId, appId: a.appId, configPath: path };
    },
  },
  {
    name: "appstore_unregister_app",
    group: "accounts",
    summary: "Remove an app from the local config",
    write: true,
    shape: { account: z.string().min(1), appId: z.string().min(1) },
    run: async (c, a) => {
      if (c.readOnly) throw new ReadOnlyError("appstore_unregister_app");
      const path = defaultConfigPath();
      saveConfig(removeAppFromConfig(loadConfig(path), String(a.account), String(a.appId)), path);
      return { ok: true, configPath: path };
    },
  },
  {
    name: "appstore_set_default_account",
    group: "accounts",
    summary: "Set the default account in the local config",
    write: true,
    shape: { account: z.string().min(1) },
    run: async (c, a) => {
      if (c.readOnly) throw new ReadOnlyError("appstore_set_default_account");
      const path = defaultConfigPath();
      const config = loadConfig(path);
      const accountId = String(a.account);
      if (!config.accounts?.[accountId]) throw new ValidationError(`Unknown account "${accountId}"`);
      saveConfig({ ...config, defaultAccount: accountId }, path);
      return { ok: true, defaultAccount: accountId, configPath: path };
    },
  },
];
