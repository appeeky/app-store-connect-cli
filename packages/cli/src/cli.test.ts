import { describe, expect, it } from "vitest";
import { ASC_OPS } from "@appeeky/app-store-connect-core";
import { buildProgram } from "./cli.js";

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
});
