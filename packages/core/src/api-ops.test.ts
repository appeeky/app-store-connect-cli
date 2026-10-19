import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  API_ALL_DEFAULT_MAX_ITEMS,
  API_ALL_MAX_PAGES,
  API_OPS,
  API_SPEC_VERSION,
  apiOpName,
  encodePathParam,
} from "./api-ops.js";
import { describeOperation, searchOperations } from "./discovery.js";
import { ReadOnlyError, ValidationError } from "./errors.js";
import { API_OPERATIONS, API_PARAMS } from "./generated/operations.js";
import { ASC_SPEC_VERSION } from "./generated/spec-version.js";
import { ALL_OPS, ASC_OPS, getOp, invokeOp, validateOpArgs } from "./ops.js";
import { json, testClient } from "./test-utils.js";

const typesFile = new URL("./generated/app-store-connect.ts", import.meta.url);
const specCache = new URL("../.spec/openapi.oas.json", import.meta.url);
const docsFile = new URL("../../../docs/reference/api-operations.mdx", import.meta.url);

/** path → method → operationId, read from the committed openapi-typescript output. */
function operationsFromTypes(): Array<{ path: string; method: string; operationId: string }> {
  const source = readFileSync(typesFile, "utf8");
  const body = source.slice(source.indexOf("export interface paths {"), source.indexOf("export type webhooks"));
  const out: Array<{ path: string; method: string; operationId: string }> = [];
  let path = "";
  for (const line of body.split("\n")) {
    const p = line.match(/^ {4}"(\/[^"]+)": \{$/);
    if (p) path = p[1]!;
    const m = line.match(/^ {8}(get|post|patch|put|delete): operations\["([^"]+)"\];$/);
    if (m) out.push({ path, method: m[1]!.toUpperCase(), operationId: m[2]! });
  }
  return out;
}

const byName = (name: string) => getOp(name);

describe("generated operation table", () => {
  it("has one op per path + method in the spec, with unique names", () => {
    const expected = operationsFromTypes();
    expect(expected.length).toBeGreaterThan(1200);
    expect(API_OPS).toHaveLength(expected.length);
    const index = new Map(API_OPS.map((op) => [`${op.api!.method} ${op.api!.path}`, op]));
    for (const e of expected) {
      const op = index.get(`${e.method} ${e.path}`);
      expect(op, `${e.method} ${e.path}`).toBeDefined();
      expect(op!.api!.operationId).toBe(e.operationId);
    }
    const names = API_OPS.map((op) => op.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => /^appstore_api_[a-z0-9_]+$/.test(n))).toBe(true);
    const curated = new Set(ASC_OPS.map((op) => op.name));
    expect(names.some((n) => curated.has(n))).toBe(false);
    expect(ALL_OPS).toHaveLength(ASC_OPS.length + API_OPS.length);
    expect(API_SPEC_VERSION).toBe(ASC_SPEC_VERSION);
  });

  it.skipIf(!existsSync(specCache))("matches the cached OpenAPI spec exactly", () => {
    const spec = JSON.parse(readFileSync(specCache, "utf8")) as {
      info: { version: string };
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    if (spec.info.version !== API_SPEC_VERSION) return; // a newer cached spec: run pnpm generate:ops
    let count = 0;
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of ["get", "post", "patch", "put", "delete"]) {
        const op = item[method];
        if (!op) continue;
        count++;
        expect(API_OPS.some((o) => o.api!.path === path && o.api!.method === method.toUpperCase())).toBe(true);
      }
    }
    expect(API_OPS).toHaveLength(count);
  });

  it("names ops after Apple's operationId and writes = not GET", () => {
    expect(apiOpName("apps_getCollection")).toBe("appstore_api_apps_get_collection");
    expect(apiOpName("appPricePointsV3_equalizations_getToManyRelated")).toBe(
      "appstore_api_app_price_points_v3_equalizations_get_to_many_related",
    );
    const op = byName("appstore_api_apps_get_collection");
    expect(op.api).toMatchObject({ method: "GET", path: "/v1/apps", operationId: "apps_getCollection" });
    expect(op.group).toBe("apps");
    expect(op.summary).toBe("List apps");
    for (const o of API_OPS) expect(o.write, o.name).toBe(o.api!.method !== "GET");
    const counts = API_OPS.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.api!.method]: (acc[o.api!.method] ?? 0) + 1 }), {});
    expect(counts.GET! + counts.POST! + counts.PATCH! + counts.DELETE! + (counts.PUT ?? 0)).toBe(API_OPS.length);
  });

  it("builds a valid zod shape for every op, lazily", () => {
    for (const op of API_OPS) {
      expect(() => z.object(op.shape), op.name).not.toThrow();
    }
    expect(API_OPERATIONS.every((row) => row[6].every((i) => API_PARAMS[i] !== undefined))).toBe(true);
  });

  it("lists every op in the generated docs page", () => {
    const doc = readFileSync(docsFile, "utf8");
    for (const op of API_OPS) expect(doc.includes(`\`${op.name}\``), op.name).toBe(true);
  });
});

describe("path parameters", () => {
  it("substitutes and encodes ids", async () => {
    const { client, calls } = testClient(() => json({ data: { type: "apps", id: "1" } }));
    await invokeOp(client, "appstore_api_apps_get_instance", { id: "123" });
    await invokeOp(client, "appstore_api_apps_get_instance", { id: 456 });
    await invokeOp(client, "appstore_api_apps_get_instance", { id: "a b%2F" });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.appstoreconnect.apple.com/v1/apps/123",
      "https://api.appstoreconnect.apple.com/v1/apps/456",
      "https://api.appstoreconnect.apple.com/v1/apps/a%20b%252F",
    ]);
  });

  it("rejects missing ids and anything that could leave the path", async () => {
    const { client, calls } = testClient(() => json({}));
    for (const bad of ["../apps", "..", ".", "a/b", "a\\b", "x?y=1", "x#y", "a\nb", ""]) {
      await expect(invokeOp(client, "appstore_api_apps_get_instance", { id: bad }), JSON.stringify(bad)).rejects.toThrow(
        ValidationError,
      );
    }
    await expect(invokeOp(client, "appstore_api_apps_get_instance", {})).rejects.toThrow(/id/);
    expect(() => encodePathParam("id", "ok-1.2_3")).not.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("query parameters", () => {
  const op = "appstore_api_apps_app_store_versions_get_to_many_related";

  it("accepts Apple's bracket names and the grouped form", async () => {
    const { client, calls } = testClient(() => json({ data: [] }));
    await invokeOp(client, op, {
      id: "1",
      "filter[platform]": "IOS,MAC_OS",
      "fields[appStoreVersions]": ["versionString", "platform"],
      limit: "5",
    });
    await invokeOp(client, op, {
      id: "1",
      filter: { platform: ["IOS", "MAC_OS"], versionString: "2.0" },
      fields: { appStoreVersions: "versionString,platform" },
      include: ["build"],
      limit: 5,
    });
    const [first, second] = calls.map((c) => new URL(c.url));
    expect(first!.pathname).toBe("/v1/apps/1/appStoreVersions");
    expect(first!.searchParams.get("filter[platform]")).toBe("IOS,MAC_OS");
    expect(first!.searchParams.get("fields[appStoreVersions]")).toBe("versionString,platform");
    expect(first!.searchParams.get("limit")).toBe("5");
    expect(calls[0]!.url).toContain("filter[platform]=IOS%2CMAC_OS");
    expect(second!.searchParams.get("filter[platform]")).toBe("IOS,MAC_OS");
    expect(second!.searchParams.get("filter[versionString]")).toBe("2.0");
    expect(second!.searchParams.get("include")).toBe("build");
  });

  it("validates enums, limits, unknown and duplicate parameters before calling Apple", async () => {
    const { client, calls } = testClient(() => json({ data: [] }));
    await expect(invokeOp(client, op, { id: "1", "filter[platform]": "ANDROID" })).rejects.toThrow(ValidationError);
    await expect(invokeOp(client, op, { id: "1", limit: 500 })).rejects.toThrow(/limit/);
    await expect(invokeOp(client, op, { id: "1", filter: { nope: "x" } })).rejects.toThrow(/unknown filter "nope"/);
    await expect(invokeOp(client, op, { id: "1", "filter[nope]": "x" })).rejects.toThrow(/Unknown argument/);
    await expect(invokeOp(client, op, { id: "1", "filter[platform]": "IOS", filter: { platform: "IOS" } })).rejects.toThrow(
      /given twice/,
    );
    expect(calls).toHaveLength(0);
  });

  it("enforces required query parameters in either form", async () => {
    const { client, calls } = testClient(() => json({ data: [] }));
    const reviews = "appstore_api_review_submissions_get_collection";
    await expect(invokeOp(client, reviews, {})).rejects.toThrow(/filter\[app\]/);
    await invokeOp(client, reviews, { filter: { app: "123" } });
    expect(calls[0]!.url).toBe("https://api.appstoreconnect.apple.com/v1/reviewSubmissions?filter[app]=123");
  });
});

describe("pagination", () => {
  function endless(pageSize: number) {
    let n = 0;
    return testClient((call) => {
      const data = Array.from({ length: pageSize }, () => ({ type: "x", id: String(n++) }));
      return json({ data, links: { self: call.url, next: `https://api.appstoreconnect.apple.com/v1/apps?cursor=${n}` } });
    });
  }

  it("follows links.next with all: true and stops at the default cap", async () => {
    const { client, calls } = endless(200);
    const result = (await invokeOp(client, "appstore_api_apps_get_collection", { all: true })) as {
      data: unknown[];
      meta: { truncated: boolean; pages: number };
    };
    expect(result.data).toHaveLength(API_ALL_DEFAULT_MAX_ITEMS);
    expect(result.meta.truncated).toBe(true);
    expect(calls).toHaveLength(API_ALL_DEFAULT_MAX_ITEMS / 200);
    expect(new URL(calls[0]!.url).searchParams.get("limit")).toBe("200");
  });

  it("honors maxItems and the page cap", async () => {
    // Apple answering with short pages: the page cap stops the loop before maxItems.
    const { client, calls } = endless(150);
    const result = (await invokeOp(client, "appstore_api_apps_get_collection", { all: true, maxItems: 20_000 })) as {
      data: unknown[];
      meta: { truncated: boolean };
    };
    expect(calls).toHaveLength(API_ALL_MAX_PAGES);
    expect(result.data).toHaveLength(API_ALL_MAX_PAGES * 150);
    expect(result.meta.truncated).toBe(true);

    const capped = endless(200);
    const r2 = (await invokeOp(capped.client, "appstore_api_apps_get_collection", { all: true, maxItems: 250, limit: 100 })) as {
      data: unknown[];
    };
    expect(r2.data).toHaveLength(250);
    expect(capped.calls).toHaveLength(2);
    expect(new URL(capped.calls[0]!.url).searchParams.get("limit")).toBe("100");
  });

  it("rejects all on non-collections and maxItems over the cap", async () => {
    const { client, calls } = testClient(() => json({}));
    await expect(invokeOp(client, "appstore_api_apps_get_instance", { id: "1", all: true })).rejects.toThrow(ValidationError);
    await expect(invokeOp(client, "appstore_api_apps_get_collection", { all: true, maxItems: 1_000_000 })).rejects.toThrow(
      ValidationError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("writes and bodies", () => {
  it("refuses writes on read-only clients before any request", async () => {
    const { client, calls } = testClient(() => json({}), { readOnly: true });
    await expect(
      invokeOp(client, "appstore_api_beta_groups_create_instance", { body: { data: { attributes: { name: "QA" } } } }),
    ).rejects.toThrow(ReadOnlyError);
    await expect(invokeOp(client, "appstore_api_beta_groups_delete_instance", { id: "g1" })).rejects.toThrow(ReadOnlyError);
    expect(calls).toHaveLength(0);
  });

  it("sends the JSON:API body as given, filling data.type and the update id", async () => {
    const { client, calls } = testClient(() => json({ data: { type: "betaGroups", id: "g1" } }, 201));
    const body = {
      data: {
        type: "betaGroups",
        attributes: { name: "QA" },
        relationships: { app: { data: { type: "apps", id: "1" } } },
      },
    };
    await invokeOp(client, "appstore_api_beta_groups_create_instance", { body });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://api.appstoreconnect.apple.com/v1/betaGroups", body });

    await invokeOp(client, "appstore_api_beta_groups_update_instance", { id: "g1", body: { data: { attributes: { name: "QA 2" } } } });
    expect(calls[1]).toMatchObject({
      method: "PATCH",
      url: "https://api.appstoreconnect.apple.com/v1/betaGroups/g1",
      body: { data: { type: "betaGroups", id: "g1", attributes: { name: "QA 2" } } },
    });

    await invokeOp(client, "appstore_api_beta_groups_beta_testers_create_to_many_relationship", {
      id: "g1",
      body: { data: [{ type: "betaTesters", id: "t1" }] },
    });
    expect(calls[2]!.url).toBe("https://api.appstoreconnect.apple.com/v1/betaGroups/g1/relationships/betaTesters");
  });

  it("rejects missing bodies and wrong resource types", async () => {
    const { client, calls } = testClient(() => json({}));
    await expect(invokeOp(client, "appstore_api_beta_groups_create_instance", {})).rejects.toThrow(/body/);
    await expect(
      invokeOp(client, "appstore_api_beta_groups_create_instance", { body: { data: { type: "apps", attributes: {} } } }),
    ).rejects.toThrow(/betaGroups/);
    expect(() => validateOpArgs(getOp("appstore_api_beta_groups_create_instance"), { body: { nope: 1 } })).toThrow(/data/);
    expect(calls).toHaveLength(0);
  });

  it("returns ok for 204 responses and text for gzip reports", async () => {
    const { client } = testClient((call) =>
      call.url.includes("salesReports")
        ? new Response(gzipSync(Buffer.from("Provider\tSKU\nAPPLE\tsku1\n")), { headers: { "content-type": "application/a-gzip" } })
        : new Response(null, { status: 204 }),
    );
    expect(await invokeOp(client, "appstore_api_beta_groups_delete_instance", { id: "g1" })).toMatchObject({
      ok: true,
      method: "DELETE",
    });
    const report = await invokeOp(client, "appstore_api_sales_reports_get_collection", {
      filter: { vendorNumber: "1", reportType: "SALES", reportSubType: "SUMMARY", frequency: "DAILY" },
    });
    expect(report).toContain("APPLE\tsku1");
  });
});

describe("search and describe", () => {
  it("searches curated and generated ops with method, path and params", () => {
    const hits = searchOperations("app store version localizations", { limit: 5 });
    expect(hits[0]!.name).toMatch(/^appstore_api_app_store_version_localizations_/);
    expect(hits[0]).toMatchObject({ kind: "api", group: "appStoreVersionLocalizations" });
    expect(hits[0]!.method).toBeDefined();
    expect(hits[0]!.path).toContain("/appStoreVersionLocalizations");

    const builds = searchOperations("builds", { group: "apps", method: "GET" });
    expect(builds.some((h) => h.path === "/v1/apps/{id}/builds")).toBe(true);
    expect(builds.every((h) => h.method === "GET" && h.group === "apps")).toBe(true);

    const curated = searchOperations("respond review");
    expect(curated[0]).toMatchObject({ name: "appstore_respond_to_review", kind: "curated", write: true });
    expect(searchOperations("testflight groups testers").length).toBeGreaterThan(0);
    expect(searchOperations("", { kind: "api" })).toHaveLength(API_OPS.length);
    const list = searchOperations("", { kind: "api", limit: 1 })[0]!;
    expect(list.params.some((p) => p.startsWith("fields[…]"))).toBe(false);
    const apps = searchOperations("apps", { group: "apps" }).find((h) => h.name === "appstore_api_apps_get_collection")!;
    expect(apps.params).toEqual(expect.arrayContaining(["filter[bundleId]?", "limit?", "all?", "maxItems?"]));
    expect(apps.params.some((p) => p.startsWith("fields[…]?"))).toBe(true);
  });

  it("describes parameters, pagination and the request body", () => {
    const list = describeOperation("appstore_api_apps_app_store_versions_get_to_many_related");
    expect(list).toMatchObject({ kind: "api", method: "GET", path: "/v1/apps/{id}/appStoreVersions", write: false });
    expect(list.params.find((p) => p.name === "id")).toMatchObject({ in: "path", required: true });
    expect(list.params.find((p) => p.name === "filter[platform]")!.enum).toContain("IOS");
    expect(list.params.find((p) => p.name === "limit")).toMatchObject({ type: "integer", maximum: 200 });
    expect(list.pagination).toBeDefined();
    expect(list.groupedParams).toEqual(expect.arrayContaining(["filter", "fields"]));

    const create = describeOperation("appstore_api_app_store_versions_create_instance");
    expect(create.body).toMatchObject({ schema: "AppStoreVersionCreateRequest", kind: "resource", resourceType: "appStoreVersions" });
    const required = create.body!.attributes.filter((a) => a.required).map((a) => a.name).sort();
    expect(required).toEqual(["platform", "versionString"]);
    expect(create.body!.relationships.find((r) => r.name === "app")).toMatchObject({ type: "apps", required: true, toMany: false });
    expect(create.body!.example).toMatchObject({
      data: {
        type: "appStoreVersions",
        attributes: { platform: "IOS", versionString: "<versionString>" },
        relationships: { app: { data: { type: "apps" } } },
      },
    });
    // The example passes the op's own validation.
    expect(() => validateOpArgs(getOp(create.name), { body: create.body!.example as Record<string, unknown> })).not.toThrow();

    const curated = describeOperation("appstore_list_apps");
    expect(curated.kind).toBe("curated");
    expect(curated.params.some((p) => p.name === "limit" && p.in === "arg")).toBe(true);
    expect(describeOperation("appstore_request").writeDependsOnArgs).toBe(true);
    expect(() => describeOperation("appstore_api_nope")).toThrow(ValidationError);
  });
});
