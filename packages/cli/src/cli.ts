import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ClientRegistry,
  searchCapabilities,
  CAPABILITIES,
  listOps,
  getOp,
  invokeOp,
  opIsWrite,
  loadConfig,
  saveConfig,
  defaultConfigPath,
  upsertAccount,
  addAppToConfig,
  removeAppFromConfig,
  ASC_SPEC_VERSION,
  type AppStoreConnectClient,
  type JsonApiDocument,
  type Resource,
} from "@appeeky/app-store-connect-core";
import { printJson, printTable, requireConfirm, resourceRows } from "./output.js";

export const VERSION = "0.1.0";

export interface GlobalOpts {
  issuerId?: string;
  keyId?: string;
  privateKey?: string;
  account?: string;
  app?: string;
  json?: boolean;
  readOnly?: boolean;
  confirm?: boolean;
}

type Args = Record<string, unknown>;
type Columns = string[] | ((result: unknown) => Array<Record<string, unknown>> | undefined);

const num = (v: string) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Not a number: ${v}`);
  return n;
};
const list = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const bool = (v: string) => {
  if (["true", "1", "yes", "on"].includes(v.toLowerCase())) return true;
  if (["false", "0", "no", "off"].includes(v.toLowerCase())) return false;
  throw new Error(`Expected true or false, got ${v}`);
};

function resolveSkillsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), "skills"),
    join(here, "../skills"), // published package: dist/ -> skills/
    join(here, "../../../skills"), // monorepo: packages/cli/dist -> repo root
    join(here, "../../skills"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "appstore-cli", "SKILL.md"))) return dir;
  }
  throw new Error("Could not find skills/ directory. From the repo: npx skills add ./skills --skill '*' -g -y");
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("appstore")
    .description("App Store Connect CLI: apps, versions, submissions, TestFlight, reviews, IAP, signing, reports")
    .version(VERSION)
    .option("--issuer-id <id>", "API key issuer id (omit for Individual keys)")
    .option("--key-id <id>", "API key id")
    .option("--private-key <pathOrPem>", "Path to AuthKey_XXXX.p8 or the PEM itself")
    .option("-a, --account <id>", "Named account from ~/.config/appstore/config.json")
    .option("--app <appIdOrBundleId>", "App id (digits) or bundle id; defaults to the account's defaultAppId")
    .option("--json", "Emit machine-readable JSON", false)
    .option("--read-only", "Block write operations", false)
    .option("--confirm", "Confirm write operations", false);

  const g = () => program.opts<GlobalOpts>();

  const registryFrom = (opts: GlobalOpts) =>
    ClientRegistry.load({
      issuerId: opts.issuerId,
      keyId: opts.keyId,
      privateKey: opts.privateKey,
      account: opts.account,
      readOnly: opts.readOnly,
    });

  async function clientFor(appHint?: string): Promise<{ client: AppStoreConnectClient; accountId?: string }> {
    const opts = g();
    return registryFrom(opts).getClientForArgs({ account: opts.account, appId: appHint ?? opts.app });
  }

  /** Resolve --app (or an explicit value) to an Apple app id. */
  async function appIdFor(client: AppStoreConnectClient, explicit?: string): Promise<string> {
    const opts = g();
    const value = explicit ?? opts.app ?? registryFrom(opts).defaultAppId(opts.account);
    if (!value) {
      throw new Error(
        "App required. Pass --app <id|bundleId>, set ASC_APP_ID, or set defaultAppId on the account (appstore apps register).",
      );
    }
    return client.apps.resolveAppId(value);
  }

  function output(result: unknown, columns?: Columns): void {
    if (g().json || !columns) {
      printJson(result);
      return;
    }
    const rows = typeof columns === "function" ? columns(result) : resourceRows(result, columns);
    if (rows) printTable(rows);
    else printJson(result);
  }

  /** Run a registry op: confirm writes, validate args, print. */
  async function call(name: string, args: Args, columns?: Columns, client?: AppStoreConnectClient): Promise<unknown> {
    const op = getOp(name);
    if (opIsWrite(op, args)) requireConfirm(g(), name);
    const c = client ?? (await clientFor(args.appId as string | undefined)).client;
    const result = await invokeOp(c, name, args);
    output(result, columns);
    return result;
  }

  /** Run an op that needs an app id. */
  async function callWithApp(name: string, args: Args, columns?: Columns, explicitApp?: string): Promise<unknown> {
    const { client } = await clientFor(explicitApp);
    return call(name, { ...args, appId: await appIdFor(client, explicitApp) }, columns, client);
  }

  const pageOpts = (cmd: Command) =>
    cmd
      .option("--limit <n>", "Page size (max 200)", num)
      .option("--all", "Follow pagination and return every page")
      .option("--max-items <n>", "With --all: stop after this many items", num);
  const paging = (o: { limit?: number; all?: boolean; maxItems?: number }) => ({
    limit: o.limit,
    all: o.all,
    maxItems: o.maxItems,
  });

  // ── Identity & setup ───────────────────────────────────────────
  program
    .command("whoami")
    .description("Show which API key is in use")
    .action(async () => {
      const opts = g();
      const registry = registryFrom(opts);
      const { client, accountId } = await registry.getClientForArgs({ account: opts.account, appId: opts.app });
      const payload = { ...client.whoami(), account: accountId, defaultAppId: registry.defaultAppId(accountId) };
      if (opts.json) printJson(payload);
      else {
        console.log(`key ${payload.keyId} (${payload.keyType})${payload.issuerId ? ` issuer ${payload.issuerId}` : ""}`);
        if (accountId) console.log(`account: ${accountId}`);
        if (payload.readOnly) console.log("read-only");
      }
    });

  program
    .command("install-skills")
    .description("Install appstore agent skills (via npx skills)")
    .option("--agent <agents...>", "Target agents, e.g. cursor codex")
    .option("--no-global", "Install into the current project only")
    .action((cmdOpts: { agent?: string[]; global?: boolean }) => {
      const skillsDir = resolveSkillsDir();
      const args = ["skills", "add", skillsDir, "--skill", "*"];
      for (const agent of cmdOpts.agent ?? []) args.push("-a", agent);
      if (cmdOpts.global !== false) args.push("-g");
      args.push("-y");
      console.log(`npx ${args.join(" ")}`);
      const result = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
      if (result.status !== 0) throw new Error(`skills install failed with exit code ${result.status ?? 1}`);
      console.log("Done. Restart your agent or IDE window so the skills are picked up.");
    });

  // ── Accounts (local multi-key config) ─────────────────────────
  const accounts = program.command("accounts").description("Manage named API keys (multi-account)");

  accounts
    .command("list")
    .description("List configured accounts")
    .action(() => {
      const opts = g();
      const registry = ClientRegistry.load({ env: {}, account: opts.account });
      const rows = registry.listAccounts();
      if (opts.json) printJson({ configPath: registry.configPath, accounts: rows });
      else if (rows.length === 0) {
        console.log(`No accounts in ${registry.configPath}`);
        console.log("Add one: appstore accounts add my-team --key-id ABC123 --issuer-id … --private-key-path ./AuthKey_ABC123.p8");
      } else {
        printTable(
          rows.map((r) => ({
            id: r.id,
            default: r.isDefault,
            keyId: r.keyId,
            keyType: r.keyType,
            defaultAppId: r.defaultAppId,
            vendorNumber: r.vendorNumber,
            privateKeyPath: r.privateKeyPath,
          })),
        );
      }
    });

  accounts
    .command("add")
    .description("Save a named account (API key)")
    .argument("<id>", "Account id, e.g. my-team")
    .requiredOption("--key-id <id>", "API key id")
    .requiredOption("--private-key-path <path>", "Path to AuthKey_XXXX.p8")
    .option("--issuer-id <id>", "Issuer id (omit for Individual keys)")
    .option("--vendor-number <n>", "Vendor number for sales and finance reports")
    .option("--default-app <appId>", "Default app id for this account")
    .option("--default", "Make this the default account", false)
    .action(
      (
        id: string,
        o: {
          keyId: string;
          privateKeyPath: string;
          issuerId?: string;
          vendorNumber?: string;
          defaultApp?: string;
          default?: boolean;
        },
      ) => {
        const path = defaultConfigPath();
        let config = upsertAccount(loadConfig(path), id, {
          keyId: o.keyId,
          issuerId: o.issuerId,
          privateKeyPath: o.privateKeyPath,
          vendorNumber: o.vendorNumber,
          defaultAppId: o.defaultApp,
        });
        if (o.default || !config.defaultAccount) config = { ...config, defaultAccount: id };
        saveConfig(config, path);
        printJson({ ok: true, account: id, configPath: path });
      },
    );

  accounts
    .command("use")
    .description("Set the default account")
    .argument("<id>")
    .action((id: string) => {
      const path = defaultConfigPath();
      const config = loadConfig(path);
      if (!config.accounts?.[id]) throw new Error(`Unknown account: ${id}`);
      saveConfig({ ...config, defaultAccount: id }, path);
      printJson({ ok: true, defaultAccount: id, configPath: path });
    });

  accounts
    .command("remove")
    .description("Delete an account from the config (the .p8 file is left alone)")
    .argument("<id>")
    .action((id: string) => {
      const path = defaultConfigPath();
      const config = loadConfig(path);
      if (!config.accounts?.[id]) throw new Error(`Unknown account: ${id}`);
      const { [id]: _removed, ...rest } = config.accounts;
      saveConfig({ accounts: rest, defaultAccount: config.defaultAccount === id ? undefined : config.defaultAccount }, path);
      printJson({ ok: true, removed: id, configPath: path });
    });

  accounts
    .command("check")
    .description("Verify each account's key by listing one app")
    .action(async () => {
      const registry = ClientRegistry.load({ env: {} });
      const results = [];
      for (const account of registry.listAccounts()) {
        try {
          const client = registry.getClient(account.id);
          const doc = (await client.apps.list({ limit: 1 })) as JsonApiDocument<Resource[]>;
          results.push({ account: account.id, ok: true, sampleApp: doc.data[0]?.attributes?.name ?? null });
        } catch (error) {
          results.push({ account: account.id, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      printJson(results);
    });

  // ── Discovery ──────────────────────────────────────────────────
  program
    .command("search")
    .description("Search available operations")
    .argument("[query]", "Search query", "")
    .action((query: string) => {
      const hits = searchCapabilities(query);
      if (g().json) printJson(hits);
      else printTable(hits.map((h) => ({ id: h.id, group: h.group, write: h.write, summary: h.summary })));
    });

  program
    .command("capabilities")
    .description("List all operations")
    .action(() => {
      if (g().json) printJson(CAPABILITIES);
      else printTable(CAPABILITIES.map((h) => ({ id: h.id, group: h.group, write: h.write, summary: h.summary })));
    });

  const ops = program.command("ops").description("Every registered operation (same surface as the MCP tools)");

  ops
    .command("list")
    .description("List operations, optionally filtered")
    .argument("[query]", "Filter", "")
    .action((query: string) => {
      const rows = listOps(query).map((op) => ({ name: op.name, group: op.group, write: op.write, summary: op.summary }));
      if (g().json) printJson(rows);
      else printTable(rows);
    });

  ops
    .command("describe")
    .description("Show an operation's arguments")
    .argument("<name>")
    .action((name: string) => {
      const op = getOp(name);
      const args = Object.entries(op.shape).map(([key, schema]) => ({
        arg: key,
        optional: schema.isOptional(),
        description: schema.description ?? "",
      }));
      if (g().json) printJson({ name: op.name, group: op.group, write: op.write, summary: op.summary, args });
      else {
        console.log(`${op.name} (${op.group}, ${op.write ? "write" : "read"})\n${op.summary}\n`);
        printTable(args);
      }
    });

  ops
    .command("call")
    .description("Invoke any operation by name with a JSON args object")
    .argument("<name>", "Operation name, e.g. appstore_list_apps")
    .argument("[argsJson]", "JSON object of arguments", "{}")
    .action(async (name: string, argsJson: string) => {
      const opts = g();
      const op = getOp(name);
      let args: Args;
      try {
        args = JSON.parse(argsJson) as Args;
      } catch {
        throw new Error(`Invalid JSON args: ${argsJson}`);
      }
      if (opts.app && args.appId === undefined && "appId" in op.shape) args.appId = opts.app;
      if (opIsWrite(op, args)) requireConfirm(opts, op.name);
      const { client } = await clientFor(args.appId as string | undefined);
      if (typeof args.appId === "string" && !/^\d+$/.test(args.appId)) args.appId = await client.apps.resolveAppId(args.appId);
      printJson(await invokeOp(client, name, args));
    });

  program
    .command("api")
    .description("Call any App Store Connect endpoint, e.g. appstore api GET /v1/apps --query limit=5")
    .argument("<method>", "GET, POST, PATCH or DELETE")
    .argument("<path>", "Path under /v1, /v2…")
    .option("-q, --query <key=value...>", "Query parameters")
    .option("-d, --body <json>", "JSON request body")
    .option("--all", "GET: follow pagination")
    .action(async (method: string, path: string, o: { query?: string[]; body?: string; all?: boolean }) => {
      const query: Record<string, string> = {};
      for (const pair of o.query ?? []) {
        const i = pair.indexOf("=");
        if (i <= 0) throw new Error(`Query must be key=value, got ${pair}`);
        query[pair.slice(0, i)] = pair.slice(i + 1);
      }
      let body: unknown;
      if (o.body) {
        try {
          body = JSON.parse(o.body);
        } catch {
          throw new Error("--body must be JSON");
        }
      }
      await call("appstore_request", { method: method.toUpperCase(), path, query, body, all: o.all });
    });

  // ── Apps ───────────────────────────────────────────────────────
  const apps = program.command("apps").description("Apps, app info, categories, age rating, availability");

  pageOpts(
    apps
      .command("list")
      .description("List apps visible to the key")
      .option("--bundle-id <ids>", "Filter by bundle id(s), comma-separated", list)
      .option("--name <name>", "Filter by name"),
  ).action(async (o: { bundleId?: string[]; name?: string; limit?: number; all?: boolean; maxItems?: number }) => {
    await call("appstore_list_apps", { bundleId: o.bundleId, name: o.name, ...paging(o) }, ["name", "bundleId", "sku", "primaryLocale"]);
  });

  apps
    .command("get")
    .description("Get an app (defaults to --app)")
    .argument("[app]", "App id or bundle id")
    .action(async (app?: string) => {
      await callWithApp("appstore_get_app", {}, ["name", "bundleId", "sku", "primaryLocale"], app);
    });

  apps
    .command("find")
    .description("Find an app id by bundle id")
    .argument("<bundleId>")
    .action(async (bundleId: string) => {
      await call("appstore_find_app", { bundleId }, ["name", "bundleId"]);
    });

  apps
    .command("infos")
    .description("List app infos (each holds name, subtitle, categories for an App Store state)")
    .action(async () => {
      await callWithApp("appstore_list_app_infos", {}, ["appStoreState", "state", "appStoreAgeRating"]);
    });

  apps
    .command("localizations")
    .description("List app info localizations (name, subtitle, privacy URLs)")
    .argument("<appInfoId>")
    .action(async (appInfoId: string) => {
      await call("appstore_list_app_info_localizations", { appInfoId }, ["locale", "name", "subtitle", "privacyPolicyUrl"]);
    });

  apps
    .command("set-localization")
    .description("Create or update an app info localization for a locale")
    .argument("<appInfoId>")
    .argument("<locale>")
    .option("--name <name>")
    .option("--subtitle <subtitle>")
    .option("--privacy-policy-url <url>")
    .option("--privacy-choices-url <url>")
    .action(
      async (
        appInfoId: string,
        locale: string,
        o: { name?: string; subtitle?: string; privacyPolicyUrl?: string; privacyChoicesUrl?: string },
      ) => {
        const { client } = await clientFor();
        const existing = (await client.apps.listAppInfoLocalizations(appInfoId, { locale })) as JsonApiDocument<Resource[]>;
        const loc = existing.data.find((l) => l.attributes?.locale === locale);
        const fields = { name: o.name, subtitle: o.subtitle, privacyPolicyUrl: o.privacyPolicyUrl, privacyChoicesUrl: o.privacyChoicesUrl };
        if (loc) await call("appstore_update_app_info_localization", { localizationId: loc.id, ...fields }, ["locale", "name", "subtitle"], client);
        else await call("appstore_create_app_info_localization", { appInfoId, locale, ...fields }, ["locale", "name", "subtitle"], client);
      },
    );

  apps
    .command("categories")
    .description("List App Store categories")
    .option("--platform <platforms>", "IOS, MAC_OS, TV_OS, VISION_OS (comma-separated)", list)
    .action(async (o: { platform?: string[] }) => {
      await call("appstore_list_categories", { platforms: o.platform, all: true }, ["platforms"]);
    });

  apps
    .command("set-categories")
    .description("Set categories on an app info")
    .argument("<appInfoId>")
    .option("--primary <categoryId>")
    .option("--secondary <categoryId>")
    .action(async (appInfoId: string, o: { primary?: string; secondary?: string }) => {
      await call("appstore_update_app_categories", { appInfoId, primaryCategory: o.primary, secondaryCategory: o.secondary });
    });

  apps
    .command("age-rating")
    .description("Show the age rating declaration of an app info")
    .argument("<appInfoId>")
    .action(async (appInfoId: string) => {
      await call("appstore_get_age_rating", { appInfoId });
    });

  apps
    .command("availability")
    .description("Show app availability and per-territory status")
    .action(async () => {
      const { client } = await clientFor();
      const appId = await appIdFor(client);
      const availability = (await client.apps.getAvailability(appId)) as JsonApiDocument<Resource>;
      const territories = await client.apps.listTerritoryAvailabilities(availability.data.id, { all: true });
      output({ availability: availability.data, territories }, (r) =>
        resourceRows((r as { territories: unknown }).territories, ["available", "releaseDate", "contentStatuses"]),
      );
    });

  apps
    .command("register")
    .description("Save an app under an account in the local config")
    .argument("<appId>", "Apple app id")
    .requiredOption("--to <account>", "Account id")
    .option("--bundle-id <bundleId>")
    .option("--name <name>")
    .option("--default", "Make it the account's default app", false)
    .action((appId: string, o: { to: string; bundleId?: string; name?: string; default?: boolean }) => {
      const path = defaultConfigPath();
      let config = loadConfig(path);
      if (!config.accounts?.[o.to]) throw new Error(`Unknown account ${o.to}. Run: appstore accounts add …`);
      config = addAppToConfig(config, o.to, { appId, bundleId: o.bundleId, name: o.name });
      if (o.default) config = upsertAccount(config, o.to, { defaultAppId: appId });
      saveConfig(config, path);
      printJson({ ok: true, account: o.to, appId, configPath: path });
    });

  apps
    .command("unregister")
    .description("Remove an app from the local config")
    .argument("<appId>")
    .requiredOption("--from <account>", "Account id")
    .action((appId: string, o: { from: string }) => {
      const path = defaultConfigPath();
      saveConfig(removeAppFromConfig(loadConfig(path), o.from, appId), path);
      printJson({ ok: true, configPath: path });
    });

  apps
    .command("registered")
    .description("List apps saved in the local config")
    .action(() => {
      const opts = g();
      const registry = ClientRegistry.load({ env: {}, account: opts.account });
      const rows = registry.listApps(opts.account);
      if (opts.json) printJson({ configPath: registry.configPath, apps: rows });
      else printTable(rows as unknown as Array<Record<string, unknown>>);
    });

  // ── Versions ───────────────────────────────────────────────────
  const versions = program.command("versions").description("App Store versions, localizations, builds, review details");
  const versionCols = ["platform", "versionString", "appStoreState", "releaseType", "createdDate"];

  pageOpts(
    versions
      .command("list")
      .description("List versions of the app")
      .option("--platform <platform>", "IOS, MAC_OS, TV_OS, VISION_OS")
      .option("--version-string <versionString>")
      .option("--state <appStoreState>", "e.g. PREPARE_FOR_SUBMISSION, READY_FOR_SALE"),
  ).action(async (o: { platform?: string; versionString?: string; state?: string; limit?: number; all?: boolean; maxItems?: number }) => {
    await callWithApp(
      "appstore_list_versions",
      { platform: o.platform, versionString: o.versionString, appStoreState: o.state, ...paging(o) },
      versionCols,
    );
  });

  versions
    .command("get")
    .argument("<versionId>")
    .action(async (versionId: string) => {
      await call("appstore_get_version", { versionId }, versionCols);
    });

  versions
    .command("create")
    .description("Create a version")
    .argument("<versionString>", "e.g. 2.4.0")
    .option("--platform <platform>", "IOS, MAC_OS, TV_OS, VISION_OS", "IOS")
    .option("--copyright <text>")
    .option("--release-type <type>", "MANUAL, AFTER_APPROVAL, SCHEDULED")
    .option("--release-date <iso>", "Earliest release date for SCHEDULED")
    .option("--build <buildId>", "Attach this build")
    .action(
      async (
        versionString: string,
        o: { platform: string; copyright?: string; releaseType?: string; releaseDate?: string; build?: string },
      ) => {
        await callWithApp(
          "appstore_create_version",
          {
            versionString,
            platform: o.platform,
            copyright: o.copyright,
            releaseType: o.releaseType,
            earliestReleaseDate: o.releaseDate,
            buildId: o.build,
          },
          versionCols,
        );
      },
    );

  versions
    .command("update")
    .argument("<versionId>")
    .option("--version-string <versionString>")
    .option("--copyright <text>")
    .option("--release-type <type>", "MANUAL, AFTER_APPROVAL, SCHEDULED")
    .option("--release-date <iso>")
    .action(
      async (versionId: string, o: { versionString?: string; copyright?: string; releaseType?: string; releaseDate?: string }) => {
        await call(
          "appstore_update_version",
          {
            versionId,
            versionString: o.versionString,
            copyright: o.copyright,
            releaseType: o.releaseType,
            earliestReleaseDate: o.releaseDate,
          },
          versionCols,
        );
      },
    );

  versions
    .command("delete")
    .argument("<versionId>")
    .action(async (versionId: string) => {
      await call("appstore_delete_version", { versionId });
    });

  versions
    .command("localizations")
    .description("List localizations of a version")
    .argument("<versionId>")
    .action(async (versionId: string) => {
      await call("appstore_list_version_localizations", { versionId, all: true }, ["locale", "promotionalText", "keywords", "whatsNew"]);
    });

  versions
    .command("set-localization")
    .description("Create or update a version localization for a locale")
    .argument("<versionId>")
    .argument("<locale>")
    .option("--description <text>")
    .option("--keywords <text>", "Comma-separated, max 100 bytes")
    .option("--whats-new <text>")
    .option("--promotional-text <text>")
    .option("--marketing-url <url>")
    .option("--support-url <url>")
    .action(
      async (
        versionId: string,
        locale: string,
        o: {
          description?: string;
          keywords?: string;
          whatsNew?: string;
          promotionalText?: string;
          marketingUrl?: string;
          supportUrl?: string;
        },
      ) => {
        const { client } = await clientFor();
        const existing = (await client.versions.listLocalizations(versionId, { locale })) as JsonApiDocument<Resource[]>;
        const loc = existing.data.find((l) => l.attributes?.locale === locale);
        const cols = ["locale", "promotionalText", "keywords", "whatsNew"];
        if (loc) await call("appstore_update_version_localization", { localizationId: loc.id, ...o }, cols, client);
        else await call("appstore_create_version_localization", { versionId, locale, ...o }, cols, client);
      },
    );

  versions
    .command("attach-build")
    .argument("<versionId>")
    .argument("<buildId>")
    .action(async (versionId: string, buildId: string) => {
      await call("appstore_attach_build", { versionId, buildId });
    });

  versions
    .command("detach-build")
    .argument("<versionId>")
    .action(async (versionId: string) => {
      await call("appstore_detach_build", { versionId });
    });

  versions
    .command("review-details")
    .description("Show App Review details of a version")
    .argument("<versionId>")
    .action(async (versionId: string) => {
      await call("appstore_get_review_details", { versionId });
    });

  versions
    .command("set-review-details")
    .description("Create or update App Review contact, demo account and notes")
    .argument("<versionId>")
    .option("--first-name <name>")
    .option("--last-name <name>")
    .option("--phone <phone>")
    .option("--email <email>")
    .option("--demo-user <name>")
    .option("--demo-password <password>")
    .option("--demo-required <bool>", "true or false", bool)
    .option("--notes <text>")
    .action(
      async (
        versionId: string,
        o: {
          firstName?: string;
          lastName?: string;
          phone?: string;
          email?: string;
          demoUser?: string;
          demoPassword?: string;
          demoRequired?: boolean;
          notes?: string;
        },
      ) => {
        const fields = {
          contactFirstName: o.firstName,
          contactLastName: o.lastName,
          contactPhone: o.phone,
          contactEmail: o.email,
          demoAccountName: o.demoUser,
          demoAccountPassword: o.demoPassword,
          demoAccountRequired: o.demoRequired,
          notes: o.notes,
        };
        const { client } = await clientFor();
        let existing: JsonApiDocument<Resource | null> | undefined;
        try {
          existing = (await client.versions.getReviewDetail(versionId)) as JsonApiDocument<Resource | null>;
        } catch {
          existing = undefined;
        }
        if (existing?.data?.id) await call("appstore_update_review_details", { reviewDetailId: existing.data.id, ...fields }, undefined, client);
        else await call("appstore_create_review_details", { versionId, ...fields }, undefined, client);
      },
    );

  // ── Submit & release ───────────────────────────────────────────
  program
    .command("submit")
    .description("Send a version to App Review (reuses an open submission or creates one)")
    .argument("<versionId>")
    .option("--platform <platform>", "IOS, MAC_OS, TV_OS, VISION_OS", "IOS")
    .action(async (versionId: string, o: { platform: string }) => {
      await callWithApp("appstore_submit_version", { versionId, platform: o.platform });
    });

  const submissions = program.command("submissions").description("App Review submissions");
  const submissionCols = ["platform", "state", "submittedDate"];

  pageOpts(
    submissions
      .command("list")
      .option("--platform <platform>")
      .option("--state <states>", "Comma-separated states", list),
  ).action(async (o: { platform?: string; state?: string[]; limit?: number; all?: boolean; maxItems?: number }) => {
    await callWithApp("appstore_list_review_submissions", { platform: o.platform, state: o.state, ...paging(o) }, submissionCols);
  });

  submissions
    .command("get")
    .argument("<submissionId>")
    .action(async (submissionId: string) => {
      await call("appstore_get_review_submission", { submissionId });
    });

  submissions
    .command("items")
    .argument("<submissionId>")
    .action(async (submissionId: string) => {
      await call("appstore_list_review_submission_items", { submissionId }, ["state"]);
    });

  submissions
    .command("create")
    .option("--platform <platform>", "IOS, MAC_OS, TV_OS, VISION_OS", "IOS")
    .action(async (o: { platform: string }) => {
      await callWithApp("appstore_create_review_submission", { platform: o.platform }, submissionCols);
    });

  submissions
    .command("add-item")
    .argument("<submissionId>")
    .argument("<itemId>", "e.g. an App Store version id")
    .option("--kind <kind>", "appStoreVersion (default), appEvent, appCustomProductPageVersion…")
    .action(async (submissionId: string, itemId: string, o: { kind?: string }) => {
      await call("appstore_add_review_submission_item", { submissionId, itemId, kind: o.kind });
    });

  submissions
    .command("submit")
    .argument("<submissionId>")
    .action(async (submissionId: string) => {
      await call("appstore_submit_review_submission", { submissionId }, submissionCols);
    });

  submissions
    .command("cancel")
    .argument("<submissionId>")
    .action(async (submissionId: string) => {
      await call("appstore_cancel_review_submission", { submissionId }, submissionCols);
    });

  program
    .command("release")
    .description("Release a version that is Pending Developer Release")
    .argument("<versionId>")
    .action(async (versionId: string) => {
      await call("appstore_release_version", { versionId });
    });

  const phased = program.command("phased-release").description("Phased (7-day) release of a version");

  async function phasedId(client: AppStoreConnectClient, versionId: string): Promise<string> {
    const doc = (await client.versions.getPhasedRelease(versionId)) as JsonApiDocument<Resource | null>;
    if (!doc.data?.id) throw new Error(`Version ${versionId} has no phased release. Start one with: appstore phased-release start ${versionId}`);
    return doc.data.id;
  }

  phased
    .command("get")
    .argument("<versionId>")
    .action(async (versionId: string) => {
      await call("appstore_get_phased_release", { versionId }, ["phasedReleaseState", "currentDayNumber", "startDate", "totalPauseDuration"]);
    });

  phased
    .command("start")
    .description("Turn on phased release for a version")
    .argument("<versionId>")
    .option("--active", "Start immediately (ACTIVE) instead of at release (INACTIVE)")
    .action(async (versionId: string, o: { active?: boolean }) => {
      await call("appstore_create_phased_release", { versionId, state: o.active ? "ACTIVE" : undefined });
    });

  for (const [verb, state, text] of [
    ["pause", "PAUSED", "Pause a phased release"],
    ["resume", "ACTIVE", "Resume a paused phased release"],
    ["complete", "COMPLETE", "Release to all users now"],
  ] as const) {
    phased
      .command(verb)
      .description(text)
      .argument("<versionId>")
      .action(async (versionId: string) => {
        const { client } = await clientFor();
        await call("appstore_update_phased_release", { phasedReleaseId: await phasedId(client, versionId), state }, ["phasedReleaseState", "currentDayNumber"], client);
      });
  }

  phased
    .command("delete")
    .description("Turn off phased release (before it starts)")
    .argument("<versionId>")
    .action(async (versionId: string) => {
      const { client } = await clientFor();
      await call("appstore_delete_phased_release", { phasedReleaseId: await phasedId(client, versionId) }, undefined, client);
    });

  // ── Builds ─────────────────────────────────────────────────────
  const builds = program.command("builds").description("Builds, processing state, What to Test");
  const buildCols = ["version", "processingState", "uploadedDate", "expired", "usesNonExemptEncryption"];

  pageOpts(
    builds
      .command("list")
      .description("List builds, newest first")
      .option("--marketing-version <version>", "e.g. 2.4.0")
      .option("--build-number <n>")
      .option("--platform <platform>")
      .option("--state <processingState>", "PROCESSING, FAILED, INVALID, VALID"),
  ).action(
    async (o: { marketingVersion?: string; buildNumber?: string; platform?: string; state?: string; limit?: number; all?: boolean; maxItems?: number }) => {
      await callWithApp(
        "appstore_list_builds",
        {
          marketingVersion: o.marketingVersion,
          buildNumber: o.buildNumber,
          platform: o.platform,
          processingState: o.state,
          ...paging(o),
        },
        buildCols,
      );
    },
  );

  builds
    .command("get")
    .argument("<buildId>")
    .action(async (buildId: string) => {
      await call("appstore_get_build", { buildId }, buildCols);
    });

  builds
    .command("latest")
    .description("Newest build of the app")
    .option("--marketing-version <version>")
    .option("--platform <platform>")
    .action(async (o: { marketingVersion?: string; platform?: string }) => {
      await callWithApp("appstore_get_latest_build", { marketingVersion: o.marketingVersion, platform: o.platform }, (r) =>
        r && typeof r === "object" && "id" in r ? resourceRows({ data: r }, buildCols) : undefined,
      );
    });

  builds
    .command("state")
    .description("Processing state of a build")
    .argument("<buildId>")
    .action(async (buildId: string) => {
      await call("appstore_get_build_processing_state", { buildId });
    });

  builds
    .command("expire")
    .argument("<buildId>")
    .action(async (buildId: string) => {
      await call("appstore_expire_build", { buildId }, buildCols);
    });

  builds
    .command("encryption")
    .description("Answer export compliance for a build")
    .argument("<buildId>")
    .requiredOption("--uses-non-exempt-encryption <bool>", "true or false", bool)
    .action(async (buildId: string, o: { usesNonExemptEncryption: boolean }) => {
      await call("appstore_update_build", { buildId, usesNonExemptEncryption: o.usesNonExemptEncryption }, buildCols);
    });

  builds
    .command("what-to-test")
    .description("Set What to Test notes for a locale (creates or updates)")
    .argument("<buildId>")
    .argument("<text>")
    .option("--locale <locale>", "Locale", "en-US")
    .action(async (buildId: string, text: string, o: { locale: string }) => {
      const { client } = await clientFor();
      const existing = (await client.builds.listBetaLocalizations(buildId)) as JsonApiDocument<Resource[]>;
      const loc = existing.data.find((l) => l.attributes?.locale === o.locale);
      if (loc) await call("appstore_update_beta_build_localization", { localizationId: loc.id, whatsNew: text }, ["locale", "whatsNew"], client);
      else await call("appstore_create_beta_build_localization", { buildId, locale: o.locale, whatsNew: text }, ["locale", "whatsNew"], client);
    });

  // ── TestFlight ─────────────────────────────────────────────────
  const tf = program.command("testflight").description("TestFlight groups, testers, beta review");
  const groups = tf.command("groups").description("Beta groups");
  const groupCols = ["name", "isInternalGroup", "publicLinkEnabled", "publicLink", "createdDate"];

  groups
    .command("list")
    .action(async () => {
      await callWithApp("appstore_list_beta_groups", { all: true }, groupCols);
    });

  groups
    .command("create")
    .argument("<name>")
    .option("--internal", "Internal group (App Store Connect users only)")
    .option("--public-link", "Enable a public TestFlight link")
    .option("--public-link-limit <n>", "Max testers via the public link", num)
    .action(async (name: string, o: { internal?: boolean; publicLink?: boolean; publicLinkLimit?: number }) => {
      await callWithApp(
        "appstore_create_beta_group",
        {
          name,
          isInternalGroup: o.internal,
          publicLinkEnabled: o.publicLink,
          publicLinkLimitEnabled: o.publicLinkLimit !== undefined ? true : undefined,
          publicLinkLimit: o.publicLinkLimit,
        },
        groupCols,
      );
    });

  groups
    .command("delete")
    .argument("<groupId>")
    .action(async (groupId: string) => {
      await call("appstore_delete_beta_group", { groupId });
    });

  groups
    .command("add-build")
    .argument("<groupId>")
    .argument("<buildIds...>")
    .action(async (groupId: string, buildIds: string[]) => {
      await call("appstore_add_builds_to_beta_group", { groupId, buildIds });
    });

  groups
    .command("remove-build")
    .argument("<groupId>")
    .argument("<buildIds...>")
    .action(async (groupId: string, buildIds: string[]) => {
      await call("appstore_remove_builds_from_beta_group", { groupId, buildIds });
    });

  groups
    .command("add-tester")
    .argument("<groupId>")
    .argument("<testerIds...>")
    .action(async (groupId: string, testerIds: string[]) => {
      await call("appstore_add_testers_to_beta_group", { groupId, testerIds });
    });

  groups
    .command("remove-tester")
    .argument("<groupId>")
    .argument("<testerIds...>")
    .action(async (groupId: string, testerIds: string[]) => {
      await call("appstore_remove_testers_from_beta_group", { groupId, testerIds });
    });

  const testers = tf.command("testers").description("Beta testers");
  const testerCols = ["email", "firstName", "lastName", "inviteType", "state"];

  pageOpts(
    testers
      .command("list")
      .option("--group <groupId>")
      .option("--email <email>"),
  ).action(async (o: { group?: string; email?: string; limit?: number; all?: boolean; maxItems?: number }) => {
    const args = { groupId: o.group, email: o.email, ...paging(o) };
    if (o.group) await call("appstore_list_beta_testers", args, testerCols);
    else await callWithApp("appstore_list_beta_testers", args, testerCols);
  });

  testers
    .command("invite")
    .argument("<email>")
    .requiredOption("--group <groupIds>", "Beta group id(s), comma-separated", list)
    .option("--first-name <name>")
    .option("--last-name <name>")
    .action(async (email: string, o: { group: string[]; firstName?: string; lastName?: string }) => {
      await call("appstore_invite_beta_tester", { email, groupIds: o.group, firstName: o.firstName, lastName: o.lastName }, testerCols);
    });

  testers
    .command("resend")
    .description("Re-send the invitation email for the app")
    .argument("<testerId>")
    .action(async (testerId: string) => {
      await callWithApp("appstore_send_beta_invitation", { testerId });
    });

  testers
    .command("delete")
    .argument("<testerId>")
    .action(async (testerId: string) => {
      await call("appstore_delete_beta_tester", { testerId });
    });

  tf.command("submit")
    .description("Submit a build for Beta App Review")
    .argument("<buildId>")
    .action(async (buildId: string) => {
      await call("appstore_submit_for_beta_review", { buildId }, ["betaReviewState", "submittedDate"]);
    });

  tf.command("localizations")
    .description("TestFlight app descriptions per locale")
    .action(async () => {
      await callWithApp("appstore_list_beta_app_localizations", { all: true }, ["locale", "feedbackEmail", "description"]);
    });

  tf.command("review-details")
    .description("Beta App Review contact and demo account")
    .action(async () => {
      await callWithApp("appstore_get_beta_review_details", {});
    });

  // ── Customer reviews ───────────────────────────────────────────
  const reviews = program.command("reviews").description("Customer reviews and responses");
  const reviewCols = ["rating", "title", "territory", "createdDate", "reviewerNickname"];

  pageOpts(
    reviews
      .command("list")
      .option("--rating <ratings>", "Star rating(s), comma-separated", (v: string) => list(v).map(num))
      .option("--territory <codes>", "Territory codes, e.g. USA,DEU", list)
      .option("--unanswered", "Only reviews without a response")
      .option("--sort <sort>", "createdDate, -createdDate, rating, -rating"),
  ).action(
    async (o: { rating?: number[]; territory?: string[]; unanswered?: boolean; sort?: string; limit?: number; all?: boolean; maxItems?: number }) => {
      await callWithApp(
        "appstore_list_customer_reviews",
        { rating: o.rating, territory: o.territory, hasResponse: o.unanswered ? false : undefined, sort: o.sort, ...paging(o) },
        reviewCols,
      );
    },
  );

  reviews
    .command("get")
    .argument("<reviewId>")
    .action(async (reviewId: string) => {
      await call("appstore_get_customer_review", { reviewId });
    });

  reviews
    .command("respond")
    .description("Publish a response to a review")
    .argument("<reviewId>")
    .argument("<text>")
    .action(async (reviewId: string, text: string) => {
      await call("appstore_respond_to_review", { reviewId, responseBody: text }, ["responseBody", "state", "lastModifiedDate"]);
    });

  reviews
    .command("delete-response")
    .argument("<responseId>")
    .action(async (responseId: string) => {
      await call("appstore_delete_review_response", { responseId });
    });

  reviews
    .command("summary")
    .description("Rating distribution, average, unanswered count, latest low ratings")
    .option("--max <n>", "Reviews to read", num)
    .action(async (o: { max?: number }) => {
      await callWithApp("appstore_reviews_summary", { maxReviews: o.max });
    });

  // ── Screenshots & previews ─────────────────────────────────────
  for (const kind of ["screenshot", "preview"] as const) {
    const plural = `${kind}s`;
    const cmd = program.command(plural).description(kind === "screenshot" ? "App Store screenshots" : "App previews (video)");
    const setsOp = kind === "screenshot" ? "appstore_list_screenshot_sets" : "appstore_list_preview_sets";
    const createOp = kind === "screenshot" ? "appstore_create_screenshot_set" : "appstore_create_preview_set";
    const listOp = kind === "screenshot" ? "appstore_list_screenshots" : "appstore_list_previews";
    const uploadOp = kind === "screenshot" ? "appstore_upload_screenshot" : "appstore_upload_preview";
    const typeAttr = kind === "screenshot" ? "screenshotDisplayType" : "previewType";

    cmd
      .command("sets")
      .description("List sets of a version localization")
      .argument("<localizationId>")
      .action(async (localizationId: string) => {
        await call(setsOp, { localizationId }, [typeAttr]);
      });

    cmd
      .command("create-set")
      .argument("<localizationId>")
      .argument("<type>", kind === "screenshot" ? "e.g. APP_IPHONE_67" : "e.g. IPHONE_67")
      .action(async (localizationId: string, type: string) => {
        await call(createOp, kind === "screenshot" ? { localizationId, displayType: type } : { localizationId, previewType: type }, [typeAttr]);
      });

    cmd
      .command("list")
      .argument("<setId>")
      .action(async (setId: string) => {
        await call(listOp, { setId, all: true }, ["fileName", "fileSize", "assetDeliveryState"]);
      });

    cmd
      .command("upload")
      .description("Upload local files into a set (in the given order)")
      .argument("<setId>")
      .argument("<files...>")
      .option("--wait", "Wait until Apple finishes processing")
      .action(async (setId: string, files: string[], o: { wait?: boolean }) => {
        requireConfirm(g(), uploadOp);
        const { client } = await clientFor();
        const results = [];
        for (const filePath of files) {
          results.push(await invokeOp(client, uploadOp, { setId, filePath, wait: o.wait }));
          if (!g().json) console.error(`uploaded ${filePath}`);
        }
        output(results, (r) => r as Array<Record<string, unknown>>);
      });

    cmd
      .command("delete")
      .argument("<assetId>")
      .action(async (assetId: string) => {
        await call("appstore_delete_media_asset", { kind, assetId });
      });

    cmd
      .command("reorder")
      .description("Set the order of a set")
      .argument("<setId>")
      .argument("<assetIds...>", "Ids in their new order")
      .action(async (setId: string, assetIds: string[]) => {
        await call("appstore_reorder_media", { kind, setId, assetIds });
      });
  }

  // ── In-app purchases ───────────────────────────────────────────
  const iap = program.command("iap").description("In-app purchases");
  const iapCols = ["name", "productId", "inAppPurchaseType", "state"];

  pageOpts(
    iap
      .command("list")
      .option("--type <type>", "CONSUMABLE, NON_CONSUMABLE, NON_RENEWING_SUBSCRIPTION")
      .option("--product-id <id>"),
  ).action(async (o: { type?: string; productId?: string; limit?: number; all?: boolean; maxItems?: number }) => {
    await callWithApp("appstore_list_in_app_purchases", { type: o.type, productId: o.productId, ...paging(o) }, iapCols);
  });

  iap
    .command("get")
    .argument("<iapId>")
    .action(async (iapId: string) => {
      await call("appstore_get_in_app_purchase", { iapId }, iapCols);
    });

  iap
    .command("create")
    .argument("<productId>")
    .requiredOption("--name <referenceName>")
    .requiredOption("--type <type>", "CONSUMABLE, NON_CONSUMABLE, NON_RENEWING_SUBSCRIPTION")
    .option("--review-note <text>")
    .option("--family-sharable")
    .action(async (productId: string, o: { name: string; type: string; reviewNote?: string; familySharable?: boolean }) => {
      await callWithApp(
        "appstore_create_in_app_purchase",
        { productId, name: o.name, inAppPurchaseType: o.type, reviewNote: o.reviewNote, familySharable: o.familySharable },
        iapCols,
      );
    });

  iap
    .command("localizations")
    .argument("<iapId>")
    .action(async (iapId: string) => {
      await call("appstore_list_iap_localizations", { iapId, all: true }, ["locale", "name", "description", "state"]);
    });

  iap
    .command("localize")
    .description("Add a display name and description for a locale")
    .argument("<iapId>")
    .argument("<locale>")
    .requiredOption("--name <name>")
    .option("--description <text>")
    .action(async (iapId: string, locale: string, o: { name: string; description?: string }) => {
      await call("appstore_create_iap_localization", { iapId, locale, name: o.name, description: o.description }, ["locale", "name"]);
    });

  iap
    .command("price-points")
    .argument("<iapId>")
    .option("--territory <code>", "e.g. USA")
    .action(async (iapId: string, o: { territory?: string }) => {
      await call("appstore_list_iap_price_points", { iapId, territory: o.territory, limit: 200 }, ["customerPrice", "proceeds"]);
    });

  // ── Subscriptions ──────────────────────────────────────────────
  const subs = program.command("subscriptions").description("Auto-renewable subscriptions");
  const subCols = ["name", "productId", "subscriptionPeriod", "groupLevel", "state"];

  subs
    .command("groups")
    .description("List subscription groups")
    .action(async () => {
      await callWithApp("appstore_list_subscription_groups", { all: true }, ["referenceName"]);
    });

  subs
    .command("create-group")
    .argument("<referenceName>")
    .action(async (referenceName: string) => {
      await callWithApp("appstore_create_subscription_group", { referenceName }, ["referenceName"]);
    });

  subs
    .command("list")
    .argument("<groupId>")
    .action(async (groupId: string) => {
      await call("appstore_list_subscriptions", { groupId, all: true }, subCols);
    });

  subs
    .command("get")
    .argument("<subscriptionId>")
    .action(async (subscriptionId: string) => {
      await call("appstore_get_subscription", { subscriptionId }, subCols);
    });

  subs
    .command("create")
    .argument("<groupId>")
    .argument("<productId>")
    .requiredOption("--name <referenceName>")
    .option("--period <period>", "ONE_WEEK, ONE_MONTH, TWO_MONTHS, THREE_MONTHS, SIX_MONTHS, ONE_YEAR")
    .option("--level <n>", "Group level (1 = highest)", num)
    .option("--family-sharable")
    .action(
      async (groupId: string, productId: string, o: { name: string; period?: string; level?: number; familySharable?: boolean }) => {
        await call(
          "appstore_create_subscription",
          { groupId, productId, name: o.name, subscriptionPeriod: o.period, groupLevel: o.level, familySharable: o.familySharable },
          subCols,
        );
      },
    );

  subs
    .command("update")
    .argument("<subscriptionId>")
    .option("--name <referenceName>")
    .option("--period <period>")
    .option("--level <n>", "Group level", num)
    .option("--review-note <text>")
    .action(async (subscriptionId: string, o: { name?: string; period?: string; level?: number; reviewNote?: string }) => {
      await call(
        "appstore_update_subscription",
        { subscriptionId, name: o.name, subscriptionPeriod: o.period, groupLevel: o.level, reviewNote: o.reviewNote },
        subCols,
      );
    });

  subs
    .command("localizations")
    .argument("<subscriptionId>")
    .action(async (subscriptionId: string) => {
      await call("appstore_list_subscription_localizations", { subscriptionId, all: true }, ["locale", "name", "description", "state"]);
    });

  subs
    .command("localize")
    .argument("<subscriptionId>")
    .argument("<locale>")
    .requiredOption("--name <name>")
    .option("--description <text>")
    .action(async (subscriptionId: string, locale: string, o: { name: string; description?: string }) => {
      await call("appstore_create_subscription_localization", { subscriptionId, locale, name: o.name, description: o.description }, ["locale", "name"]);
    });

  subs
    .command("prices")
    .argument("<subscriptionId>")
    .option("--territory <code>")
    .action(async (subscriptionId: string, o: { territory?: string }) => {
      await call("appstore_list_subscription_prices", { subscriptionId, territory: o.territory, all: true }, ["startDate", "preserved"]);
    });

  subs
    .command("price-points")
    .argument("<subscriptionId>")
    .option("--territory <code>")
    .action(async (subscriptionId: string, o: { territory?: string }) => {
      await call("appstore_list_subscription_price_points", { subscriptionId, territory: o.territory, limit: 200 }, ["customerPrice", "proceeds", "proceedsYear2"]);
    });

  // ── Pricing ────────────────────────────────────────────────────
  const pricing = program.command("pricing").description("App price points and schedule");
  pricing
    .command("points")
    .option("--territory <code>", "e.g. USA")
    .action(async (o: { territory?: string }) => {
      await callWithApp("appstore_list_app_price_points", { territory: o.territory, limit: 200 }, ["customerPrice", "proceeds"]);
    });
  pricing
    .command("schedule")
    .action(async () => {
      await callWithApp("appstore_get_app_price_schedule", {});
    });

  // ── Users ──────────────────────────────────────────────────────
  const users = program.command("users").description("Team members and invitations");
  const userCols = ["username", "firstName", "lastName", "roles", "allAppsVisible"];

  users.command("list").action(async () => {
    await call("appstore_list_users", { all: true }, userCols);
  });

  users
    .command("invite")
    .argument("<email>")
    .requiredOption("--first-name <name>")
    .requiredOption("--last-name <name>")
    .requiredOption("--roles <roles>", "Comma-separated, e.g. DEVELOPER,APP_MANAGER", list)
    .option("--apps <appIds>", "Visible app ids (otherwise all apps)", list)
    .action(async (email: string, o: { firstName: string; lastName: string; roles: string[]; apps?: string[] }) => {
      await call(
        "appstore_invite_user",
        { email, firstName: o.firstName, lastName: o.lastName, roles: o.roles, allAppsVisible: !o.apps?.length, visibleAppIds: o.apps },
        ["email", "roles", "expirationDate"],
      );
    });

  users
    .command("set-roles")
    .argument("<userId>")
    .requiredOption("--roles <roles>", "Comma-separated roles", list)
    .action(async (userId: string, o: { roles: string[] }) => {
      await call("appstore_update_user", { userId, roles: o.roles }, userCols);
    });

  users
    .command("remove")
    .argument("<userId>")
    .action(async (userId: string) => {
      await call("appstore_remove_user", { userId });
    });

  users.command("invitations").action(async () => {
    await call("appstore_list_user_invitations", { all: true }, ["email", "roles", "expirationDate"]);
  });

  users
    .command("cancel-invitation")
    .argument("<invitationId>")
    .action(async (invitationId: string) => {
      await call("appstore_cancel_user_invitation", { invitationId });
    });

  // ── Signing ────────────────────────────────────────────────────
  const bundleIds = program.command("bundle-ids").description("Bundle identifiers");
  bundleIds
    .command("list")
    .option("--identifier <id>")
    .action(async (o: { identifier?: string }) => {
      await call("appstore_list_bundle_ids", { identifier: o.identifier, all: true }, ["identifier", "name", "platform", "seedId"]);
    });
  bundleIds
    .command("create")
    .argument("<identifier>")
    .requiredOption("--name <name>")
    .option("--platform <platform>", "IOS, MAC_OS, UNIVERSAL", "IOS")
    .action(async (identifier: string, o: { name: string; platform: string }) => {
      await call("appstore_create_bundle_id", { identifier, name: o.name, platform: o.platform }, ["identifier", "name", "platform"]);
    });
  bundleIds
    .command("capabilities")
    .argument("<bundleIdId>")
    .action(async (bundleIdId: string) => {
      await call("appstore_list_bundle_id_capabilities", { bundleIdId }, ["capabilityType"]);
    });

  const devices = program.command("devices").description("Registered devices");
  devices
    .command("list")
    .option("--platform <platform>", "IOS, MAC_OS, UNIVERSAL")
    .action(async (o: { platform?: string }) => {
      await call("appstore_list_devices", { platform: o.platform, all: true }, ["name", "udid", "platform", "status", "model"]);
    });
  devices
    .command("register")
    .argument("<name>")
    .argument("<udid>")
    .option("--platform <platform>", "IOS, MAC_OS, UNIVERSAL", "IOS")
    .action(async (name: string, udid: string, o: { platform: string }) => {
      await call("appstore_register_device", { name, udid, platform: o.platform }, ["name", "udid", "status"]);
    });
  for (const [verb, status] of [
    ["enable", "ENABLED"],
    ["disable", "DISABLED"],
  ] as const) {
    devices
      .command(verb)
      .argument("<deviceId>")
      .action(async (deviceId: string) => {
        await call("appstore_update_device", { deviceId, status }, ["name", "status"]);
      });
  }

  program
    .command("certificates")
    .description("List signing certificates")
    .option("--type <certificateType>", "e.g. DISTRIBUTION, DEVELOPMENT")
    .action(async (o: { type?: string }) => {
      await call("appstore_list_certificates", { certificateType: o.type, all: true }, ["displayName", "certificateType", "expirationDate", "serialNumber"]);
    });

  const profiles = program.command("profiles").description("Provisioning profiles");
  const profileCols = ["name", "profileType", "profileState", "expirationDate", "uuid"];
  profiles
    .command("list")
    .option("--type <profileType>")
    .option("--state <state>", "ACTIVE or INVALID")
    .action(async (o: { type?: string; state?: string }) => {
      await call("appstore_list_profiles", { profileType: o.type, profileState: o.state, all: true }, profileCols);
    });
  profiles
    .command("create")
    .argument("<name>")
    .requiredOption("--type <profileType>", "e.g. IOS_APP_STORE")
    .requiredOption("--bundle-id <bundleIdId>", "Bundle ID resource id (not the identifier)")
    .requiredOption("--certificates <ids>", "Certificate ids, comma-separated", list)
    .option("--devices <ids>", "Device ids, comma-separated", list)
    .action(async (name: string, o: { type: string; bundleId: string; certificates: string[]; devices?: string[] }) => {
      await call(
        "appstore_create_profile",
        { name, profileType: o.type, bundleIdId: o.bundleId, certificateIds: o.certificates, deviceIds: o.devices },
        profileCols,
      );
    });
  profiles
    .command("download")
    .argument("<profileId>")
    .option("-o, --output <path>", "Output file (default <name>.mobileprovision)")
    .action(async (profileId: string, o: { output?: string }) => {
      const { client } = await clientFor();
      const outputPath = o.output ?? `${profileId}.mobileprovision`;
      await call("appstore_download_profile", { profileId, outputPath }, undefined, client);
    });
  profiles
    .command("delete")
    .argument("<profileId>")
    .action(async (profileId: string) => {
      await call("appstore_delete_profile", { profileId });
    });

  // ── Reports ────────────────────────────────────────────────────
  const reports = program.command("reports").description("Sales and finance reports");

  function writeOrPrint(text: string, out?: string): boolean {
    if (!out) return false;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
    console.error(`wrote ${out}`);
    return true;
  }

  reports
    .command("sales")
    .description("Sales and Trends report (rows as JSON, or raw TSV with --output)")
    .option("--type <reportType>", "SALES, SUBSCRIPTION, SUBSCRIPTION_EVENT, SUBSCRIBER, INSTALLS…", "SALES")
    .option("--sub-type <reportSubType>", "SUMMARY, DETAILED…", "SUMMARY")
    .option("--frequency <frequency>", "DAILY, WEEKLY, MONTHLY, YEARLY", "DAILY")
    .option("--date <reportDate>", "YYYY-MM-DD, YYYY-MM or YYYY")
    .option("--report-version <version>", "Report version, e.g. 1_0")
    .option("--vendor <vendorNumber>")
    .option("--rows <n>", "Max rows to print", num)
    .option("-o, --output <path>", "Write the raw TSV to a file")
    .action(
      async (o: { type: string; subType: string; frequency: string; date?: string; reportVersion?: string; vendor?: string; rows?: number; output?: string }) => {
        const input = {
          vendorNumber: o.vendor,
          reportType: o.type,
          reportSubType: o.subType,
          frequency: o.frequency as "DAILY",
          reportDate: o.date,
          version: o.reportVersion,
        };
        const { client } = await clientFor();
        if (o.output) {
          writeOrPrint(await client.reports.salesReportText(input), o.output);
          return;
        }
        await call("appstore_download_sales_report", { ...input, limit: o.rows }, (r) => (r as { rows: Array<Record<string, unknown>> }).rows, client);
      },
    );

  reports
    .command("finance")
    .description("Monthly finance report (rows as JSON, or raw TSV with --output)")
    .requiredOption("--date <YYYY-MM>", "Fiscal month")
    .option("--region <code>", "Region code, e.g. US, EU; ZZ for all (FINANCE_DETAIL)", "ZZ")
    .option("--type <reportType>", "FINANCIAL or FINANCE_DETAIL", "FINANCE_DETAIL")
    .option("--vendor <vendorNumber>")
    .option("--rows <n>", "Max rows to print", num)
    .option("-o, --output <path>", "Write the raw TSV to a file")
    .action(async (o: { date: string; region: string; type: string; vendor?: string; rows?: number; output?: string }) => {
      const input = {
        vendorNumber: o.vendor,
        reportType: o.type as "FINANCIAL",
        regionCode: o.region,
        reportDate: o.date,
      };
      const { client } = await clientFor();
      if (o.output) {
        writeOrPrint(await client.reports.financeReportText(input), o.output);
        return;
      }
      await call("appstore_download_finance_report", { ...input, limit: o.rows }, (r) => (r as { rows: Array<Record<string, unknown>> }).rows, client);
    });

  const analytics = program.command("analytics").description("Analytics reports (requests → reports → instances → segments)");
  analytics.command("requests").action(async () => {
    await callWithApp("appstore_list_analytics_report_requests", { all: true }, ["accessType", "stoppedDueToInactivity"]);
  });
  analytics
    .command("request")
    .description("Request analytics reports for the app")
    .option("--snapshot", "ONE_TIME_SNAPSHOT instead of ONGOING")
    .action(async (o: { snapshot?: boolean }) => {
      await callWithApp("appstore_create_analytics_report_request", { accessType: o.snapshot ? "ONE_TIME_SNAPSHOT" : "ONGOING" }, ["accessType"]);
    });
  analytics
    .command("reports")
    .argument("<requestId>")
    .option("--category <category>", "APP_USAGE, APP_STORE_ENGAGEMENT, COMMERCE, FRAMEWORK_USAGE, PERFORMANCE")
    .action(async (requestId: string, o: { category?: string }) => {
      await call("appstore_list_analytics_reports", { requestId, category: o.category, all: true }, ["name", "category"]);
    });
  analytics
    .command("instances")
    .argument("<reportId>")
    .option("--granularity <g>", "DAILY, WEEKLY, MONTHLY")
    .option("--date <processingDate>", "YYYY-MM-DD")
    .action(async (reportId: string, o: { granularity?: string; date?: string }) => {
      await call("appstore_list_analytics_report_instances", { reportId, granularity: o.granularity, processingDate: o.date, all: true }, ["granularity", "processingDate"]);
    });
  analytics
    .command("segments")
    .argument("<instanceId>")
    .action(async (instanceId: string) => {
      await call("appstore_list_analytics_report_segments", { instanceId, all: true }, ["checksum", "sizeInBytes"]);
    });
  analytics
    .command("download")
    .argument("<segmentId>")
    .option("--rows <n>", "Max rows to print", num)
    .option("-o, --output <path>", "Write the raw file")
    .action(async (segmentId: string, o: { rows?: number; output?: string }) => {
      const { client } = await clientFor();
      if (o.output) {
        writeOrPrint(await client.reports.analyticsSegmentText(segmentId), o.output);
        return;
      }
      await call("appstore_download_analytics_segment", { segmentId, limit: o.rows }, (r) => (r as { rows: Array<Record<string, unknown>> }).rows, client);
    });

  program
    .command("spec")
    .description("Show the App Store Connect OpenAPI spec version the types come from")
    .action(() => printJson({ specVersion: ASC_SPEC_VERSION }));

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}
