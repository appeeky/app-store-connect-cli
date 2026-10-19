import { afterEach, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AppStoreConnectClient, ASC_OPS } from "@appeeky/app-store-connect-core";
import { registerTools, type ClientSource } from "./tools.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function connect(source: ClientSource) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, source);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

function source(responder: (url: string) => Response, readOnly = false) {
  const requested: Array<{ account?: string; appId?: string }> = [];
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return responder(String(input));
  }) as typeof fetch;
  const src: ClientSource = {
    readOnly,
    async getClientForArgs(args) {
      requested.push(args);
      return {
        client: AppStoreConnectClient.fromAccessToken("t", { fetch: fetchImpl, readOnly }),
        accountId: args.account ?? "default",
      };
    },
  };
  return { src, requested, calls };
}

describe("registerTools", () => {
  it("registers every op plus the two discovery tools, with an account argument", async () => {
    const { src } = source(() => new Response("{}"));
    const client = await connect(src);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(ASC_OPS.length + 2);
    const listApps = tools.find((t) => t.name === "appstore_list_apps")!;
    expect(Object.keys(listApps.inputSchema.properties ?? {})).toContain("account");
    const search = await client.callTool({ name: "appstore_search_capabilities", arguments: { query: "testflight" } });
    expect(JSON.parse((search.content as Array<{ text: string }>)[0]!.text).length).toBeGreaterThan(5);
  });

  it("routes by account and app id and tags the result with the account", async () => {
    const { src, requested, calls } = source(() =>
      new Response(JSON.stringify({ data: { type: "apps", id: "42" } }), { headers: { "content-type": "application/json" } }),
    );
    const client = await connect(src);
    const res = await client.callTool({ name: "appstore_get_app", arguments: { appId: "42", account: "team-b" } });
    expect(requested[0]).toEqual({ account: "team-b", appId: "42" });
    expect(calls[0]).toBe("https://api.appstoreconnect.apple.com/v1/apps/42");
    expect(JSON.parse((res.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ account: "team-b", data: { id: "42" } });
  });

  it("returns read-only refusals as tool errors", async () => {
    const { src, calls } = source(() => new Response("{}"), true);
    const client = await connect(src);
    const res = await client.callTool({ name: "appstore_expire_build", arguments: { buildId: "b1" } });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0]!.text).toContain("read-only");
    expect(calls).toHaveLength(0);
  });

  it("runs local config ops without asking the source for a key", async () => {
    const { src, requested } = source(() => new Response("{}"), true);
    const client = await connect(src);
    const res = await client.callTool({
      name: "appstore_register_account",
      arguments: { account: "x", keyId: "K", privateKeyPath: "/tmp/none.p8" },
    });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0]!.text).toContain("read-only");
    expect(requested).toHaveLength(0);
  });
});
