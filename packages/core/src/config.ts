import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { AuthError, ValidationError } from "./errors.js";
import { loadPrivateKey, type ApiKeyCredentials } from "./auth.js";

export interface ConfigApp {
  /** Apple app id (digits). */
  appId: string;
  bundleId?: string;
  name?: string;
}

export interface ConfigAccount {
  /** Team keys have an issuer id; Individual keys do not. */
  issuerId?: string;
  keyId?: string;
  /** Path to the AuthKey_XXXX.p8 file (preferred). */
  privateKeyPath?: string;
  /** Inline PEM (discouraged; prefer a path). */
  privateKey?: string;
  /** Vendor number for sales and finance reports. */
  vendorNumber?: string;
  /** App used when --app is omitted. */
  defaultAppId?: string;
  /** Optional shortlist of apps (App Store Connect can list apps itself). */
  apps?: ConfigApp[];
}

export interface AscConfig {
  /** Account id used when --account is omitted. */
  defaultAccount?: string;
  accounts?: Record<string, ConfigAccount>;
}

export function defaultConfigPath(): string {
  return join(homedir(), ".config", "appstore", "config.json");
}

export function loadConfig(configPath = defaultConfigPath()): AscConfig {
  if (!existsSync(configPath)) return {};
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as AscConfig;
    return { defaultAccount: raw.defaultAccount, accounts: { ...(raw.accounts ?? {}) } };
  } catch (cause) {
    throw new AuthError(`Invalid config at ${configPath}`, cause);
  }
}

export function saveConfig(config: AscConfig, configPath = defaultConfigPath()): void {
  mkdirSync(dirname(configPath), { recursive: true });
  const toWrite: AscConfig = {
    defaultAccount: config.defaultAccount,
    accounts: config.accounts ?? {},
  };
  writeFileSync(configPath, `${JSON.stringify(toWrite, null, 2)}\n`, { mode: 0o600 });
}

export function listAccountIds(config: AscConfig): string[] {
  return Object.keys(config.accounts ?? {}).sort();
}

export function resolveAccountId(config: AscConfig, explicit?: string): string | undefined {
  if (explicit) {
    if (!config.accounts?.[explicit]) {
      throw new ValidationError(
        `Unknown account "${explicit}". Known: ${listAccountIds(config).join(", ") || "(none)"}`,
      );
    }
    return explicit;
  }
  if (config.defaultAccount && config.accounts?.[config.defaultAccount]) {
    return config.defaultAccount;
  }
  const ids = listAccountIds(config);
  if (ids.length === 1) return ids[0];
  return undefined;
}

export function getAccount(config: AscConfig, accountId: string): ConfigAccount {
  const account = config.accounts?.[accountId];
  if (!account) throw new ValidationError(`Unknown account "${accountId}"`);
  return account;
}

/** Build API key credentials from a config account. */
export function credentialsForAccount(accountId: string, account: ConfigAccount): ApiKeyCredentials {
  if (!account.keyId) throw new ValidationError(`Account "${accountId}" has no keyId`);
  const keyRef = account.privateKeyPath ?? account.privateKey;
  if (!keyRef) throw new ValidationError(`Account "${accountId}" has no privateKeyPath`);
  return {
    keyId: account.keyId,
    issuerId: account.issuerId || undefined,
    privateKey: loadPrivateKey(keyRef),
    source: account.privateKeyPath ?? `account ${accountId}`,
  };
}

export interface RegisteredApp {
  accountId: string;
  appId: string;
  bundleId?: string;
  name?: string;
  isDefault?: boolean;
}

export function listRegisteredApps(config: AscConfig, accountId?: string): RegisteredApp[] {
  const ids = accountId ? [resolveAccountId(config, accountId)!] : listAccountIds(config);
  const out: RegisteredApp[] = [];
  for (const id of ids) {
    const account = config.accounts?.[id];
    if (!account) continue;
    const apps = account.apps ?? [];
    if (apps.length === 0 && account.defaultAppId) {
      out.push({ accountId: id, appId: account.defaultAppId, isDefault: true });
      continue;
    }
    for (const app of apps) {
      out.push({
        accountId: id,
        appId: app.appId,
        bundleId: app.bundleId,
        name: app.name,
        isDefault: account.defaultAppId === app.appId,
      });
    }
  }
  return out;
}

/** Accounts that registered an app (matched by app id or bundle id). */
export function findAccountsForApp(config: AscConfig, appIdOrBundleId: string): string[] {
  return listRegisteredApps(config)
    .filter((a) => a.appId === appIdOrBundleId || a.bundleId === appIdOrBundleId)
    .map((a) => a.accountId);
}

export function addAppToConfig(config: AscConfig, accountId: string, app: ConfigApp): AscConfig {
  if (!/^\d+$/.test(app.appId)) {
    throw new ValidationError(`App id must be Apple's numeric app id, got "${app.appId}"`);
  }
  const accounts = { ...(config.accounts ?? {}) };
  const account = { ...(accounts[accountId] ?? {}) };
  const apps = [...(account.apps ?? [])];
  const idx = apps.findIndex((a) => a.appId === app.appId);
  if (idx >= 0) apps[idx] = { ...apps[idx], ...app };
  else apps.push(app);
  account.apps = apps;
  if (!account.defaultAppId) account.defaultAppId = app.appId;
  accounts[accountId] = account;
  return { ...config, accounts, defaultAccount: config.defaultAccount ?? accountId };
}

export function removeAppFromConfig(config: AscConfig, accountId: string, appId: string): AscConfig {
  const accounts = { ...(config.accounts ?? {}) };
  const account = accounts[accountId];
  if (!account) throw new ValidationError(`Unknown account "${accountId}"`);
  const apps = (account.apps ?? []).filter((a) => a.appId !== appId && a.bundleId !== appId);
  const next: ConfigAccount = { ...account, apps };
  if (next.defaultAppId === appId) next.defaultAppId = apps[0]?.appId;
  accounts[accountId] = next;
  return { ...config, accounts };
}

export function upsertAccount(config: AscConfig, accountId: string, patch: ConfigAccount): AscConfig {
  const accounts = { ...(config.accounts ?? {}) };
  const merged: Record<string, unknown> = { ...(accounts[accountId] ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) merged[k] = v;
  }
  accounts[accountId] = merged as ConfigAccount;
  return { ...config, accounts, defaultAccount: config.defaultAccount ?? accountId };
}
