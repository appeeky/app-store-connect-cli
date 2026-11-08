import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASC_OPS } from "@appeeky/app-store-connect-core";
import { buildProgram, readJsonArg } from "./cli.js";

async function run(args: string[]) {
  const program = buildProgram();
  program.exitOverride();
  for (const cmd of program.commands) cmd.exitOverride();
  return program.parseAsync(["node", "appstore", ...args]);
}

describe("appstore CLI", () => {
  it("refuses writes without --confirm before loading any key", async () => {
    await expect(
      run(["ops", "call", "appstore_respond_to_review", '{"reviewId":"r","responseBody":"hi"}']),
    ).rejects.toThrow(/without --confirm/);
    await expect(run(["api", "POST", "/v1/betaGroups", "--body", "{}"])).rejects.toThrow(/without --confirm/);
  });

  it("rejects unknown ops and bad JSON", async () => {
    await expect(run(["ops", "call", "appstore_nope"])).rejects.toThrow(/Unknown operation/);
    await expect(run(["ops", "call", "appstore_list_apps", "{not json"])).rejects.toThrow(/Invalid JSON/);
  });

  it("exposes a command group for every major area", () => {
    const names = buildProgram().commands.map((c) => c.name());
    for (const name of [
      "apps",
      "versions",
      "submit",
      "submissions",
      "release",
      "phased-release",
      "builds",
      "testflight",
      "reviews",
      "screenshots",
      "previews",
      "iap",
      "subscriptions",
      "users",
      "bundle-ids",
      "devices",
      "certificates",
      "profiles",
      "reports",
      "analytics",
      "ops",
      "api",
      "search-ads",
    ]) {
      expect(names, name).toContain(name);
    }
  });

  it("only references ops that exist", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./cli.ts", import.meta.url), "utf8");
    const referenced = [...source.matchAll(/"(appstore_[a-z0-9_]+)"/g)].map((m) => m[1]!);
    const known = new Set(ASC_OPS.map((op) => op.name));
    for (const name of referenced) expect(known.has(name), name).toBe(true);
  });

  describe("api (generated operations)", () => {
    afterEach(() => vi.restoreAllMocks());

    function capture() {
      const lines: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
      return lines;
    }

    it("lists and searches operations as JSON", async () => {
      const lines = capture();
      await run(["--json", "api", "list", "--search", "beta groups", "--method", "POST", "--limit", "3"]);
      const hits = JSON.parse(lines.join("\n")) as Array<{ name: string; method: string; write: boolean }>;
      expect(hits).toHaveLength(3);
      expect(hits.every((h) => h.method === "POST" && h.write)).toBe(true);
    });

    it("filters by group and describes an operation", async () => {
      const lines = capture();
      await run(["--json", "api", "list", "--group", "salesReports"]);
      expect(JSON.parse(lines.join("\n"))).toMatchObject([{ name: "appstore_api_sales_reports_get_collection" }]);
      lines.length = 0;
      await run(["--json", "api", "describe", "appstore_api_beta_groups_create_instance"]);
      expect(JSON.parse(lines.join("\n"))).toMatchObject({ method: "POST", body: { schema: "BetaGroupCreateRequest" } });
      lines.length = 0;
      await run(["api", "describe", "appstore_api_beta_groups_create_instance"]);
      expect(lines.join("\n")).toContain("Example body:");
    });

    it("refuses writes without --confirm and bad ids before loading any key", async () => {
      await expect(
        run(["api", "call", "appstore_api_beta_groups_delete_instance", "--param", "id=g1"]),
      ).rejects.toThrow(/without --confirm/);
      await expect(run(["api", "call", "appstore_api_apps_get_instance", "--param", "id=../x"])).rejects.toThrow(
        /Invalid path parameter/,
      );
      await expect(run(["api", "call", "appstore_api_apps_get_collection", "--param", "filter[nope]=1"])).rejects.toThrow(
        /Unknown argument/,
      );
      await expect(run(["api", "call", "appstore_api_nope"])).rejects.toThrow(/Unknown operation/);
    });

    it("reads bodies inline or from @file", () => {
      const dir = mkdtempSync(join(tmpdir(), "appstore-cli-"));
      const file = join(dir, "body.json");
      writeFileSync(file, '{"data":{"type":"betaGroups"}}');
      expect(readJsonArg(`@${file}`, "--body")).toEqual({ data: { type: "betaGroups" } });
      expect(readJsonArg('{"a":1}', "--body")).toEqual({ a: 1 });
      expect(() => readJsonArg("{nope", "--body")).toThrow(/--body must be JSON/);
    });
  });

  describe("search-ads", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    function home() {
      const dir = mkdtempSync(join(tmpdir(), "appstore-asa-"));
      vi.stubEnv("HOME", dir);
      for (const name of ["ASA_CLIENT_ID", "ASA_TEAM_ID", "ASA_KEY_ID", "ASA_PRIVATE_KEY", "ASA_PRIVATE_KEY_PATH", "ASA_ORG_ID"]) vi.stubEnv(name, "");
      const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      const keyPath = join(dir, "asa.pem");
      const pubPath = join(dir, "asa-public.pem");
      const ascPath = join(dir, "AuthKey.p8");
      writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
      writeFileSync(ascPath, privateKey.export({ type: "pkcs8", format: "pem" }));
      writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }));
      return { dir, keyPath, pubPath, ascPath, configPath: join(dir, ".config", "appstore", "config.json") };
    }

    function capture() {
      const lines: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
      return lines;
    }

    function fakeFetch(api: (url: string, init: RequestInit) => Response) {
      const calls: Array<{ url: string; headers: Headers; method: string; body?: string }> = [];
      vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
        const url = String(input);
        calls.push({ url, headers: new Headers(init.headers), method: init.method ?? "GET", body: init.body as string | undefined });
        if (url.startsWith("https://appleid.apple.com/")) return Response.json({ access_token: "tok" });
        return api(url, init);
      });
      return calls;
    }

    it("attaches a key to an account, refuses a public key, and removes it", async () => {
      const h = home();
      capture();
      await run(["accounts", "add", "studio", "--key-id", "K1", "--issuer-id", "ISS", "--private-key-path", h.ascPath]);
      await expect(
        run(["accounts", "search-ads", "studio", "--client-id", "SEARCHADS.c", "--key-id", "AK", "--private-key-path", h.pubPath]),
      ).rejects.toThrow(/is a public key/);
      await run(["accounts", "search-ads", "studio", "--client-id", "SEARCHADS.c", "--team-id", "SEARCHADS.t", "--key-id", "AK", "--private-key-path", h.keyPath, "--org-id", "77"]);
      const config = JSON.parse(readFileSync(h.configPath, "utf8"));
      expect(config.accounts.studio).toMatchObject({
        keyId: "K1",
        issuerId: "ISS",
        searchAds: { clientId: "SEARCHADS.c", teamId: "SEARCHADS.t", keyId: "AK", privateKeyPath: h.keyPath, orgId: "77" },
      });
      const lines = capture();
      await run(["--json", "accounts", "list"]);
      const listed = JSON.parse(lines.join("\n"));
      expect(listed.accounts[0]).toMatchObject({ id: "studio", searchAds: true, searchAdsOrgId: "77" });
      expect(lines.join("\n")).not.toContain("PRIVATE KEY");
      await run(["accounts", "search-ads", "studio", "--remove"]);
      expect(JSON.parse(readFileSync(h.configPath, "utf8")).accounts.studio.searchAds).toBeUndefined();
    });

    it("calls Search Ads with the account key and prints the body", async () => {
      const h = home();
      capture();
      await run(["accounts", "add", "studio", "--key-id", "K1", "--private-key-path", h.ascPath,
        "--search-ads-client-id", "SEARCHADS.c", "--search-ads-key-id", "AK", "--search-ads-private-key-path", h.keyPath]);
      const calls = fakeFetch((url) =>
        url.endsWith("/acls") ? Response.json({ data: [{ orgId: 9, orgName: "Studio" }] }) : Response.json({ data: [{ id: 1 }], pagination: { totalResults: 1 } }),
      );
      const lines = capture();
      await run(["--json", "--account", "studio", "search-ads", "call", "GET", "/api/v5/campaigns?limit=1000"]);
      expect(JSON.parse(lines.join("\n"))).toEqual({ data: [{ id: 1 }], pagination: { totalResults: 1 } });
      const acls = calls.find((c) => c.url.endsWith("/api/v5/acls"))!;
      expect(acls.headers.get("x-ap-context")).toBeNull();
      const campaigns = calls.find((c) => c.url === "https://api.searchads.apple.com/api/v5/campaigns?limit=1000")!;
      expect(campaigns.headers.get("x-ap-context")).toBe("orgId=9");
      expect(campaigns.headers.get("authorization")).toBe("Bearer tok");

      lines.length = 0;
      await run(["--json", "--account", "studio", "search-ads", "call", "POST", "/api/v5/reports/campaigns", '{"startTime":"2026-01-01"}', "--org-id", "5"]);
      const report = calls.at(-1)!;
      expect(report.method).toBe("POST");
      expect(report.headers.get("x-ap-context")).toBe("orgId=5");
      expect(JSON.parse(report.body!)).toEqual({ startTime: "2026-01-01" });

      await expect(run(["--account", "studio", "search-ads", "call", "PUT", "/api/v5/campaigns/1", "{}"])).rejects.toThrow(/without --confirm/);
    });

    it("prints Apple's error as JSON with --json and fails", async () => {
      const h = home();
      capture();
      await run(["accounts", "add", "studio", "--key-id", "K1", "--private-key-path", h.ascPath]);
      const lines = capture();
      await expect(run(["--json", "--account", "studio", "search-ads", "call", "GET", "/api/v5/campaigns"])).rejects.toThrow(
        'Account "studio" has no Apple Search Ads key. Add one: appstore accounts search-ads studio',
      );
      expect(JSON.parse(lines.join("\n"))).toMatchObject({ error: { code: "AUTH_ERROR" } });

      await run(["accounts", "search-ads", "studio", "--client-id", "SEARCHADS.c", "--key-id", "AK", "--private-key-path", h.keyPath, "--org-id", "9"]);
      fakeFetch(() =>
        Response.json({ data: null, error: { errors: [{ messageCode: "INVALID_INPUT", message: "endTime is invalid", field: "endTime" }] } }, { status: 400 }),
      );
      lines.length = 0;
      await expect(run(["--json", "--account", "studio", "search-ads", "call", "POST", "/api/v5/reports/campaigns", "{}"])).rejects.toThrow(
        "Apple Search Ads 400: endTime is invalid (field: endTime) on POST /api/v5/reports/campaigns",
      );
      expect(JSON.parse(lines.join("\n"))).toEqual({
        error: {
          code: "SEARCH_ADS_ERROR",
          status: 400,
          message: "Apple Search Ads 400: endTime is invalid (field: endTime) on POST /api/v5/reports/campaigns",
          messageCode: "INVALID_INPUT",
          field: "endTime",
          method: "POST",
          path: "/api/v5/reports/campaigns",
          errors: [{ messageCode: "INVALID_INPUT", message: "endTime is invalid", field: "endTime" }],
        },
      });
    });
  });
});
