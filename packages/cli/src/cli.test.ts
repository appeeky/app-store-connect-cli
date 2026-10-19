import { mkdtempSync, writeFileSync } from "node:fs";
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
});
