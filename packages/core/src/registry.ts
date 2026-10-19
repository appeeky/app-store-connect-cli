import { resolveCredentials, type ApiKeyCredentials } from "./auth.js";
import { AppStoreConnectClient, type AppStoreConnectClientOptions } from "./client.js";
import {
  credentialsForAccount,
  defaultConfigPath,
  findAccountsForApp,
  getAccount,
  listAccountIds,
  listRegisteredApps,
  loadConfig,
  resolveAccountId,
  type AscConfig,
  type RegisteredApp,
} from "./config.js";
import { AuthError, ValidationError } from "./errors.js";

export interface ClientRegistryOptions {
  configPath?: string;
  /** Explicit key parts (CLI flags). Win over env and config. */
  issuerId?: string;
  keyId?: string;
  privateKey?: string;
  /** Preferred account id. */
  account?: string;
  readOnly?: boolean;
  env?: NodeJS.ProcessEnv;
  /** Passed through to every client (tests, timeouts). */
  clientOptions?: Pick<AppStoreConnectClientOptions, "fetch" | "timeoutMs" | "retry" | "baseUrl" | "vendorNumber">;
}

/**
 * Multi-account client factory. Each named account in
 * ~/.config/appstore/config.json holds one API key; one key usually sees
 * every app of its team, so registering apps is optional.
 */
export class ClientRegistry {
  readonly config: AscConfig;
  readonly configPath: string;
  readonly readOnly: boolean;
  private readonly explicit?: ApiKeyCredentials;
  private readonly preferredAccount?: string;
  private readonly clientOptions: ClientRegistryOptions["clientOptions"];
  private readonly envVendor?: string;
  private readonly cache = new Map<string, AppStoreConnectClient>();

  private constructor(config: AscConfig, configPath: string, options: ClientRegistryOptions) {
    this.config = config;
    this.configPath = configPath;
    this.readOnly = options.readOnly ?? false;
    this.preferredAccount = options.account;
    this.clientOptions = options.clientOptions ?? {};
    const env = options.env ?? process.env;
    this.envVendor = env.ASC_VENDOR_NUMBER;
    // Flags or ASC_* env win over the config file (single-key mode). An
    // explicit --account still selects a config account.
    this.explicit = options.account && !options.keyId && !options.privateKey
      ? undefined
      : resolveCredentials({
          issuerId: options.issuerId,
          keyId: options.keyId,
          privateKey: options.privateKey,
          env,
        });
  }

  static load(options: ClientRegistryOptions = {}): ClientRegistry {
    const configPath = options.configPath ?? defaultConfigPath();
    return new ClientRegistry(loadConfig(configPath), configPath, options);
  }

  listAccounts(): Array<{
    id: string;
    keyId?: string;
    issuerId?: string;
    keyType: "team" | "individual";
    defaultAppId?: string;
    vendorNumber?: string;
    appCount: number;
    isDefault: boolean;
    privateKeyPath?: string;
  }> {
    const defaultId = resolveAccountId(this.config, this.preferredAccount);
    return listAccountIds(this.config).map((id) => {
      const account = getAccount(this.config, id);
      return {
        id,
        keyId: account.keyId,
        issuerId: account.issuerId,
        keyType: account.issuerId ? "team" : "individual",
        defaultAppId: account.defaultAppId,
        vendorNumber: account.vendorNumber,
        appCount: account.apps?.length ?? (account.defaultAppId ? 1 : 0),
        isDefault: id === defaultId,
        privateKeyPath: account.privateKeyPath,
      };
    });
  }

  listApps(accountId?: string): RegisteredApp[] {
    return listRegisteredApps(this.config, accountId);
  }

  resolveAccountForArgs(args: { account?: string; appId?: string } = {}): string | undefined {
    if (args.account) return resolveAccountId(this.config, args.account);
    if (args.appId) {
      const matches = [...new Set(findAccountsForApp(this.config, args.appId))];
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) {
        throw new ValidationError(
          `App ${args.appId} is registered under multiple accounts (${matches.join(", ")}). Pass account explicitly.`,
        );
      }
    }
    return resolveAccountId(this.config, this.preferredAccount);
  }

  getClient(accountId?: string): AppStoreConnectClient {
    if (this.explicit && !accountId) {
      const cached = this.cache.get("explicit");
      if (cached) return cached;
      const client = AppStoreConnectClient.fromCredentials(this.explicit, {
        ...this.clientOptions,
        vendorNumber: this.clientOptions?.vendorNumber ?? this.envVendor,
        readOnly: this.readOnly,
      });
      this.cache.set("explicit", client);
      return client;
    }

    const resolved = accountId !== undefined
      ? resolveAccountId(this.config, accountId)
      : resolveAccountId(this.config, this.preferredAccount);
    if (!resolved) {
      throw new AuthError(
        listAccountIds(this.config).length > 1
          ? `Several accounts in ${this.configPath}; pass --account or set a default with \`appstore accounts use <id>\`.`
          : "No App Store Connect API key found. Pass --key-id/--issuer-id/--private-key, set ASC_KEY_ID/ASC_ISSUER_ID/ASC_PRIVATE_KEY_PATH, or run `appstore accounts add`.",
      );
    }
    const cached = this.cache.get(resolved);
    if (cached) return cached;
    const account = getAccount(this.config, resolved);
    const client = AppStoreConnectClient.fromCredentials(credentialsForAccount(resolved, account), {
      ...this.clientOptions,
      vendorNumber: this.clientOptions?.vendorNumber ?? account.vendorNumber ?? this.envVendor,
      readOnly: this.readOnly,
    });
    this.cache.set(resolved, client);
    return client;
  }

  async getClientForArgs(
    args: { account?: string; appId?: string } = {},
  ): Promise<{ client: AppStoreConnectClient; accountId?: string }> {
    if (this.explicit && !args.account) return { client: this.getClient() };
    const accountId = this.resolveAccountForArgs(args);
    return { client: this.getClient(accountId), accountId };
  }

  defaultAppId(accountId?: string): string | undefined {
    if (process.env.ASC_APP_ID) return process.env.ASC_APP_ID;
    const id = accountId ?? resolveAccountId(this.config, this.preferredAccount);
    if (!id) return undefined;
    return this.config.accounts?.[id]?.defaultAppId;
  }
}
