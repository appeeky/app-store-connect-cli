import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { AppStoreConnectClient, assertApiPath } from "./client.js";
import { ApiError, ReadOnlyError, ValidationError, formatAppleErrors } from "./errors.js";
import { buildQuery } from "./jsonapi.js";
import { parseRetryAfter, withRetry } from "./retry.js";
import { decodeJwt } from "./auth.js";
import { json, mockFetch, testClient } from "./test-utils.js";

const BASE = "https://api.appstoreconnect.apple.com";

describe("requests", () => {
  it("sends a signed bearer token and JSON:API query parameters", async () => {
    const { client, calls } = testClient(() => json({ data: [] }));
    await client.apps.list({ bundleId: ["com.a", "com.b"], limit: 5 });
    const call = calls[0]!;
    expect(call.method).toBe("GET");
    expect(call.url).toBe(`${BASE}/v1/apps?limit=5&filter[bundleId]=com.a%2Ccom.b`);
    const token = call.headers.authorization!.replace(/^Bearer /, "");
    expect(decodeJwt(token).header.kid).toBe("KEY123");
    expect(decodeJwt(token).payload.iss).toBe("issuer-uuid");
  });

  it("builds queries with brackets kept and empties dropped", () => {
    expect(buildQuery({ "filter[app]": "1", "exists[x]": false, empty: "", nope: undefined, list: ["a", "b"] })).toBe(
      "?filter[app]=1&exists[x]=false&list=a%2Cb",
    );
  });

  it("uses an access token as-is in hosted mode", async () => {
    const mock = mockFetch(() => json({ data: { id: "1", type: "apps" } }));
    const client = AppStoreConnectClient.fromAccessToken("signed.jwt.token", { fetch: mock.fetch });
    await client.apps.get("1");
    expect(mock.calls[0]!.headers.authorization).toBe("Bearer signed.jwt.token");
    expect(client.whoami().authMode).toBe("accessToken");
  });

  it("only accepts API paths", () => {
    expect(() => assertApiPath("/v1/apps")).not.toThrow();
    expect(() => assertApiPath("/v2/inAppPurchases/1")).not.toThrow();
    expect(() => assertApiPath("https://evil.example/v1/apps")).toThrow(ValidationError);
    expect(() => assertApiPath("/v1/../admin")).toThrow(ValidationError);
    expect(() => assertApiPath("/internal")).toThrow(ValidationError);
  });
});

describe("pagination", () => {
  it("follows links.next and merges included resources", async () => {
    const pages = [
      {
        data: [{ type: "apps", id: "1" }, { type: "apps", id: "2" }],
        included: [{ type: "appInfos", id: "x" }],
        links: { next: `${BASE}/v1/apps?cursor=AB&limit=2` },
        meta: { paging: { total: 5, limit: 2 } },
      },
      {
        data: [{ type: "apps", id: "3" }, { type: "apps", id: "4" }],
        included: [{ type: "appInfos", id: "x" }, { type: "appInfos", id: "y" }],
        links: { next: `${BASE}/v1/apps?cursor=CD&limit=2` },
      },
      { data: [{ type: "apps", id: "5" }], links: {} },
    ];
    const { client, calls } = testClient(() => json(pages[calls.length - 1]));
    const all = await client.paginate("/v1/apps", { limit: 2 });
    expect(all.data.map((a) => (a as { id: string }).id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(all.included).toHaveLength(2);
    expect(all.meta).toEqual({ total: 5, pages: 3, truncated: false });
    expect(calls[1]!.url).toBe(`${BASE}/v1/apps?cursor=AB&limit=2`);
  });

  it("stops at maxItems and reports truncation", async () => {
    const { client, calls } = testClient(() =>
      json({ data: [{ type: "apps", id: "1" }, { type: "apps", id: "2" }], links: { next: `${BASE}/v1/apps?cursor=Z` } }),
    );
    const res = await client.paginate("/v1/apps", {}, { maxItems: 3 });
    expect(res.data).toHaveLength(3);
    expect(res.meta.truncated).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("never sends the token to another host via links.next", async () => {
    const { client, calls } = testClient(() =>
      json({ data: [{ type: "apps", id: "1" }], links: { next: "https://attacker.example/v1/apps" } }),
    );
    await expect(client.paginate("/v1/apps")).rejects.toThrow(/Refusing to send/);
    expect(calls).toHaveLength(1);
  });
});

describe("retries", () => {
  it("retries 429 honoring Retry-After, then succeeds", async () => {
    const waits: number[] = [];
    let n = 0;
    const mock = mockFetch(() => {
      n += 1;
      return n < 3 ? json({ errors: [{ status: "429", code: "RATE_LIMIT_EXCEEDED" }] }, 429, { "retry-after": "2" }) : json({ data: [] });
    });
    const client = AppStoreConnectClient.fromAccessToken("t", {
      fetch: mock.fetch,
      retry: { baseDelayMs: 10, maxDelayMs: 1000, sleep: async (ms) => void waits.push(ms) },
    });
    await client.get("/v1/apps");
    expect(mock.calls).toHaveLength(3);
    expect(waits).toEqual([2000, 2000]);
  });

  it("backs off exponentially on 5xx for GET", async () => {
    const waits: number[] = [];
    let n = 0;
    const mock = mockFetch(() => (++n < 4 ? json({}, 503) : json({ data: [] })));
    const client = AppStoreConnectClient.fromAccessToken("t", {
      fetch: mock.fetch,
      retry: { baseDelayMs: 100, maxDelayMs: 250, maxAttempts: 4, sleep: async (ms) => void waits.push(ms) },
    });
    await client.get("/v1/apps");
    expect(waits).toEqual([100, 200, 250]);
  });

  it("does not repeat a POST after a 5xx, but does after a 429", async () => {
    const { client: c1, calls: calls1 } = testClient(() => json({ errors: [{ status: "500", title: "boom" }] }, 500));
    await expect(c1.post("/v1/betaGroups", { data: {} })).rejects.toBeInstanceOf(ApiError);
    expect(calls1).toHaveLength(1);

    let n = 0;
    const { client: c2, calls: calls2 } = testClient(() => (++n === 1 ? json({}, 429) : json({ data: { id: "g" } }, 201)));
    await c2.post("/v1/betaGroups", { data: {} });
    expect(calls2).toHaveLength(2);
  });

  it("gives up after maxAttempts with the last error", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw Object.assign(new Error("down"), { status: 503 });
        },
        { maxAttempts: 3, sleep: async () => {} },
      ),
    ).rejects.toThrow("down");
    expect(attempts).toBe(3);
  });

  it("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter("soon")).toBeUndefined();
  });

  it("turns timeouts into ApiError TIMEOUT", async () => {
    const fetchImpl = (async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    const client = AppStoreConnectClient.fromAccessToken("t", {
      fetch: fetchImpl,
      timeoutMs: 5,
      retry: { maxAttempts: 2, sleep: async () => {} },
    });
    await expect(client.get("/v1/apps")).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("errors", () => {
  const body = {
    errors: [
      {
        id: "e1",
        status: "409",
        code: "STATE_ERROR.ENTITY_STATE_INVALID",
        title: "The request cannot be fulfilled because of the state of another resource.",
        detail: "Submission cannot be submitted.",
        meta: {
          associatedErrors: {
            "/v1/appStoreVersions/123": [
              { code: "ENTITY_ERROR.ATTRIBUTE.REQUIRED", detail: "You must provide a value for the attribute 'whatsNew'." },
            ],
            "/v1/appStoreReviewDetails/9": [{ code: "ENTITY_ERROR.ATTRIBUTE.INVALID", title: "Contact phone is invalid" }],
          },
        },
      },
      { status: "409", code: "ENTITY_ERROR", title: "Another problem", source: { pointer: "/data/attributes/name" } },
    ],
  };

  it("joins every error and associated error", () => {
    const text = formatAppleErrors(body)!;
    expect(text).toContain("409 STATE_ERROR.ENTITY_STATE_INVALID");
    expect(text).toContain("Submission cannot be submitted.");
    expect(text).toContain("/v1/appStoreVersions/123: ENTITY_ERROR.ATTRIBUTE.REQUIRED You must provide a value for the attribute 'whatsNew'.");
    expect(text).toContain("/v1/appStoreReviewDetails/9: ENTITY_ERROR.ATTRIBUTE.INVALID Contact phone is invalid");
    expect(text).toContain("Another problem (at /data/attributes/name)");
    expect(formatAppleErrors({})).toBeUndefined();
  });

  it("raises ApiError with status, parsed errors and the formatted message", async () => {
    const { client } = testClient(() => json(body, 409));
    const err = (await client.submissions.submit("sub-1").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.errors).toHaveLength(2);
    expect(err.message).toContain("PATCH /v1/reviewSubmissions/sub-1 failed (HTTP 409)");
    expect(err.message).toContain("whatsNew");
  });
});

describe("read-only", () => {
  it("refuses every non-GET request before calling Apple", async () => {
    const { client, calls } = testClient(() => json({ data: {} }), { readOnly: true });
    await expect(client.reviews.respond("r1", "Thanks!")).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(client.request("DELETE", "/v1/betaTesters/1")).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(client.versions.attachBuild("v", "b")).rejects.toBeInstanceOf(ReadOnlyError);
    expect(calls).toHaveLength(0);
    await client.apps.get("1");
    expect(calls).toHaveLength(1);
  });
});

describe("downloads", () => {
  it("gunzips report bodies", async () => {
    const tsv = "Provider\tSKU\tUnits\nAPPLE\tsku1\t3\nAPPLE\tsku2\t5\n";
    const { client, calls } = testClient(
      () => new Response(gzipSync(Buffer.from(tsv)), { status: 200, headers: { "content-type": "application/a-gzip" } }),
      { vendorNumber: "8899" },
    );
    const report = await client.reports.salesReport({ reportType: "SALES", reportSubType: "SUMMARY", frequency: "DAILY", reportDate: "2026-10-01" });
    expect(calls[0]!.url).toContain("filter[vendorNumber]=8899");
    expect(calls[0]!.url).toContain("filter[reportDate]=2026-10-01");
    expect(calls[0]!.headers.accept).toContain("application/a-gzip");
    expect(report.columns).toEqual(["Provider", "SKU", "Units"]);
    expect(report.rows).toEqual([
      { Provider: "APPLE", SKU: "sku1", Units: "3" },
      { Provider: "APPLE", SKU: "sku2", Units: "5" },
    ]);
  });
});
