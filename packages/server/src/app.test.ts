import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHandler } from "./app.js";

const SESSION = {
  accessToken: "eyJhbGciOiJFUzI1NiJ9.session.token",
  expiresAt: "2030-01-01T00:00:00.000Z",
  keyId: "KEY123",
  issuerId: "issuer-uuid",
  vendorNumber: "88990011",
};

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function start(sessionResponse: { status: number; body: unknown } = { status: 200, body: { data: SESSION } }) {
  const sessionFetch = vi.fn(async () => jsonResponse(sessionResponse.body, sessionResponse.status));
  const appleFetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/v1/apps")) {
      return jsonResponse({
        data: [{ type: "apps", id: "123", attributes: { name: "Example", bundleId: "com.example.app", sku: "EX" } }],
        links: { self: url },
      });
    }
    return jsonResponse({ data: [] });
  });
  server = createServer(
    createHandler({
      apiUrl: "http://api.internal",
      gatewaySecret: "gw-secret",
      fetch: sessionFetch as typeof fetch,
      appleFetch: appleFetch as typeof fetch,
    }),
  );
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  return { base, sessionFetch, appleFetch };
}

let rpcId = 0;
async function mcp(base: string, method: string, params: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer apk_user",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  return (await res.json()) as {
    result: { tools: Array<{ name: string }>; content: Array<{ text: string }>; isError?: boolean };
  };
}

describe("hosted appstore server", () => {
  it("answers health without a key and refuses requests without one", async () => {
    const { base } = await start();
    expect((await fetch(`${base}/health`)).status).toBe(200);
    const res = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    const rest = await fetch(`${base}/v1/ops`);
    expect(rest.status).toBe(401);
  });

  it("lists read-only, hostable tools without touching the Appeeky session", async () => {
    const { base, sessionFetch } = await start();
    const names = (await mcp(base, "tools/list", {})).result.tools.map((t) => t.name);
    expect(names).toContain("appstore_list_apps");
    expect(names).toContain("appstore_list_customer_reviews");
    expect(names).toContain("appstore_request");
    expect(names).not.toContain("appstore_respond_to_review");
    expect(names).not.toContain("appstore_submit_version");
    expect(names).not.toContain("appstore_upload_screenshot");
    expect(names).not.toContain("appstore_download_profile");
    expect(names).not.toContain("appstore_register_account");
    expect(names).not.toContain("appstore_list_accounts");
    expect(sessionFetch).not.toHaveBeenCalled();

    const writable = (await mcp(base, "tools/list", {}, { "x-asc-allow-writes": "true" })).result.tools.map((t) => t.name);
    expect(writable).toContain("appstore_respond_to_review");
    expect(writable).toContain("appstore_submit_version");
    expect(writable).not.toContain("appstore_upload_screenshot");
    expect(writable).not.toContain("appstore_upload_preview");
    expect(writable).not.toContain("appstore_download_profile");
  });

  it("fetches the session with the user's key and the gateway secret, then calls Apple with the session token", async () => {
    const { base, sessionFetch, appleFetch } = await start();
    const result = (await mcp(base, "tools/call", { name: "appstore_list_apps", arguments: { limit: 5 } })).result;
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text).data[0].id).toBe("123");

    const [url, init] = sessionFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.internal/v1/store-gateway/app-store-connect/session");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer apk_user");
    expect((init.headers as Record<string, string>)["x-store-gateway-secret"]).toBe("gw-secret");

    const [appleUrl, appleInit] = appleFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(appleUrl).toBe("https://api.appstoreconnect.apple.com/v1/apps?limit=5");
    expect((appleInit.headers as Record<string, string>).authorization).toBe(`Bearer ${SESSION.accessToken}`);
  });

  it("passes Appeeky refusals through as tool errors", async () => {
    const { base, appleFetch } = await start({
      status: 429,
      body: { error: { code: "RATE_LIMIT_EXCEEDED", message: "Monthly credit limit reached." } },
    });
    const result = (await mcp(base, "tools/call", { name: "appstore_list_apps", arguments: {} })).result;
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Monthly credit limit reached.");
    expect(appleFetch).not.toHaveBeenCalled();
  });

  it("refuses non-GET appstore_request calls in read-only MCP sessions", async () => {
    const { base, appleFetch } = await start();
    const result = (
      await mcp(base, "tools/call", {
        name: "appstore_request",
        arguments: { method: "DELETE", path: "/v1/betaTesters/1" },
      })
    ).result;
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("read-only");
    expect(appleFetch).not.toHaveBeenCalled();
  });

  it("REST lists apps through the API", async () => {
    const { base, appleFetch } = await start();
    const res = await fetch(`${base}/v1/apps`, { headers: { "x-api-key": "apk_user" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { apps: Array<{ id: string; bundleId: string }>; keyId: string } };
    expect(body.data.apps).toEqual([{ id: "123", name: "Example", bundleId: "com.example.app", sku: "EX" }]);
    expect(body.data.keyId).toBe("KEY123");
    expect(appleFetch).toHaveBeenCalledTimes(1);
  });

  it("REST keeps writes behind the opt-in header", async () => {
    const { base, sessionFetch } = await start();
    const headers = { authorization: "Bearer apk_user", "content-type": "application/json" };
    const ops = (await (await fetch(`${base}/v1/ops`, { headers })).json()) as { data: Array<{ name: string }> };
    expect(ops.data.some((o) => o.name === "appstore_list_builds")).toBe(true);
    expect(ops.data.some((o) => o.name === "appstore_respond_to_review")).toBe(false);

    const blocked = await fetch(`${base}/v1/ops/appstore_respond_to_review`, { method: "POST", headers, body: "{}" });
    expect(blocked.status).toBe(403);
    const blockedRequest = await fetch(`${base}/v1/ops/appstore_request`, {
      method: "POST",
      headers,
      body: JSON.stringify({ method: "POST", path: "/v1/betaGroups", body: {} }),
    });
    expect(blockedRequest.status).toBe(403);
    expect(((await blockedRequest.json()) as { error: { code: string } }).error.code).toBe("WRITES_DISABLED");
    const cliOnly = await fetch(`${base}/v1/ops/appstore_upload_screenshot`, { method: "POST", headers, body: "{}" });
    expect(cliOnly.status).toBe(404);
    const local = await fetch(`${base}/v1/ops/appstore_register_account`, { method: "POST", headers, body: "{}" });
    expect(local.status).toBe(404);
    const invalid = await fetch(`${base}/v1/ops/appstore_list_builds`, { method: "POST", headers, body: "{}" });
    expect(invalid.status).toBe(400);
    expect(sessionFetch).not.toHaveBeenCalled();
  });

  it("REST runs an operation and allows writes with the header", async () => {
    const { base, appleFetch } = await start();
    const headers = { authorization: "Bearer apk_user", "content-type": "application/json" };
    const ok = await fetch(`${base}/v1/ops/appstore_list_builds`, {
      method: "POST",
      headers,
      body: JSON.stringify({ appId: "123", limit: 3 }),
    });
    expect(ok.status).toBe(200);
    expect(String(appleFetch.mock.calls[0]![0])).toContain("/v1/builds?");

    const write = await fetch(`${base}/v1/ops/appstore_respond_to_review`, {
      method: "POST",
      headers: { ...headers, "x-asc-allow-writes": "true" },
      body: JSON.stringify({ reviewId: "r1", responseBody: "Thanks!" }),
    });
    expect(write.status).toBe(200);
    const [, init] = appleFetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
  });

  it("caps request bodies at 1 MB", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/v1/ops/appstore_list_apps`, {
      method: "POST",
      headers: { authorization: "Bearer apk_user", "content-type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(1024 * 1024 + 10) }),
    });
    expect(res.status).toBe(413);
  });

  it("REST lists, searches and describes generated operations behind the write gate", async () => {
    const { base, sessionFetch } = await start();
    const headers = { authorization: "Bearer apk_user" };
    const all = (await (await fetch(`${base}/v1/ops`, { headers })).json()) as {
      data: Array<{ name: string; kind: string; write: boolean; method?: string }>;
      total: number;
    };
    expect(all.data.some((o) => o.name === "appstore_api_apps_get_collection" && o.kind === "api" && o.method === "GET")).toBe(true);
    expect(all.data.some((o) => o.name === "appstore_api_beta_groups_create_instance")).toBe(false);
    expect(all.data.some((o) => o.name === "appstore_upload_screenshot")).toBe(false);
    expect(all.data.every((o) => !o.write || o.name === "appstore_request")).toBe(true);
    expect(all.total).toBeGreaterThan(800);

    const writable = (await (
      await fetch(`${base}/v1/ops`, { headers: { ...headers, "x-asc-allow-writes": "true" } })
    ).json()) as { total: number; data: Array<{ name: string }> };
    expect(writable.total).toBeGreaterThan(all.total);
    expect(writable.data.some((o) => o.name === "appstore_api_beta_groups_create_instance")).toBe(true);

    const search = (await (await fetch(`${base}/v1/ops?q=customer%20reviews&limit=5`, { headers })).json()) as {
      data: Array<{ name: string; params: string[] }>;
      total: number;
    };
    expect(search.data).toHaveLength(5);
    expect(search.data.every((h) => Array.isArray(h.params))).toBe(true);
    expect(search.data.some((h) => h.name.includes("customer_review"))).toBe(true);

    const described = await fetch(`${base}/v1/ops/appstore_api_apps_get_instance`, { headers });
    expect(described.status).toBe(200);
    expect(((await described.json()) as { data: { path: string } }).data.path).toBe("/v1/apps/{id}");
    const hiddenDescribe = await fetch(`${base}/v1/ops/appstore_api_beta_groups_create_instance`, { headers });
    expect(hiddenDescribe.status).toBe(403);
    expect(sessionFetch).not.toHaveBeenCalled();
  });

  it("REST runs a generated operation, keeps generated writes behind the header, and validates first", async () => {
    const { base, sessionFetch, appleFetch } = await start();
    const headers = { authorization: "Bearer apk_user", "content-type": "application/json" };
    const ok = await fetch(`${base}/v1/ops/appstore_api_apps_get_collection`, {
      method: "POST",
      headers,
      body: JSON.stringify({ filter: { bundleId: "com.example.app" }, limit: 1 }),
    });
    expect(ok.status).toBe(200);
    expect(String(appleFetch.mock.calls[0]![0])).toBe(
      "https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=com.example.app&limit=1",
    );

    const blocked = await fetch(`${base}/v1/ops/appstore_api_beta_groups_delete_instance`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "g1" }),
    });
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("WRITES_DISABLED");

    const sessionsBefore = sessionFetch.mock.calls.length;
    const invalid = await fetch(`${base}/v1/ops/appstore_api_apps_get_instance`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "../users" }),
    });
    expect(invalid.status).toBe(400);
    const unknownArg = await fetch(`${base}/v1/ops/appstore_api_apps_get_collection`, {
      method: "POST",
      headers,
      body: JSON.stringify({ "filter[nope]": "x" }),
    });
    expect(unknownArg.status).toBe(400);
    expect(sessionFetch.mock.calls.length).toBe(sessionsBefore);

    const write = await fetch(`${base}/v1/ops/appstore_api_beta_groups_delete_instance`, {
      method: "POST",
      headers: { ...headers, "x-asc-allow-writes": "true" },
      body: JSON.stringify({ id: "g1" }),
    });
    expect(write.status).toBe(200);
    const last = appleFetch.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(last[0]).toBe("https://api.appstoreconnect.apple.com/v1/betaGroups/g1");
    expect(last[1].method).toBe("DELETE");
  });

  it("hosted MCP exposes search/describe/call (not 1,300 tools) and gates call_operation", async () => {
    const { base, sessionFetch, appleFetch } = await start();
    const names = (await mcp(base, "tools/list", {})).result.tools.map((t) => t.name);
    expect(names).toContain("appstore_search_operations");
    expect(names).toContain("appstore_describe_operation");
    expect(names).toContain("appstore_call_operation");
    expect(names.some((n) => n.startsWith("appstore_api_"))).toBe(false);
    expect(names.length).toBeLessThan(200);

    const write = (
      await mcp(base, "tools/call", {
        name: "appstore_call_operation",
        arguments: { name: "appstore_api_beta_groups_delete_instance", args: { id: "g1" } },
      })
    ).result;
    expect(write.isError).toBe(true);
    expect(write.content[0]!.text).toContain("X-ASC-Allow-Writes");

    const curatedWrite = (
      await mcp(base, "tools/call", {
        name: "appstore_call_operation",
        arguments: { name: "appstore_respond_to_review", args: { reviewId: "r", responseBody: "hi" } },
      })
    ).result;
    expect(curatedWrite.content[0]!.text).toContain("X-ASC-Allow-Writes");

    const cliOnly = (
      await mcp(
        base,
        "tools/call",
        { name: "appstore_call_operation", arguments: { name: "appstore_upload_screenshot", args: {} } },
        { "x-asc-allow-writes": "true" },
      )
    ).result;
    expect(cliOnly.isError).toBe(true);
    expect(cliOnly.content[0]!.text).toContain("CLI-only");

    const requestWrite = (
      await mcp(base, "tools/call", {
        name: "appstore_call_operation",
        arguments: { name: "appstore_request", args: { method: "DELETE", path: "/v1/betaGroups/g1" } },
      })
    ).result;
    expect(requestWrite.isError).toBe(true);
    expect(sessionFetch).not.toHaveBeenCalled();
    expect(appleFetch).not.toHaveBeenCalled();

    const read = (
      await mcp(base, "tools/call", {
        name: "appstore_call_operation",
        arguments: { name: "appstore_api_apps_get_collection", args: { limit: 1 } },
      })
    ).result;
    expect(read.isError).toBeFalsy();
    expect(JSON.parse(read.content[0]!.text).data[0].id).toBe("123");

    const allowed = (
      await mcp(
        base,
        "tools/call",
        { name: "appstore_call_operation", arguments: { name: "appstore_api_beta_groups_delete_instance", args: { id: "g1" } } },
        { "x-asc-allow-writes": "true" },
      )
    ).result;
    expect(allowed.isError).toBeFalsy();
    expect(String((appleFetch.mock.calls.at(-1) as unknown as [string])[0])).toBe(
      "https://api.appstoreconnect.apple.com/v1/betaGroups/g1",
    );
  });
});
