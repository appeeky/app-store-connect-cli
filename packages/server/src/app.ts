/**
 * Hosted appstore: App Store Connect for agents and scripts, on the App Store
 * Connect connection a user already set up in Appeeky.
 *
 *   POST /mcp              remote MCP (streamable HTTP, stateless)
 *   GET  /v1/apps          apps the connected key can see
 *   GET  /v1/ops           operations this caller can run (?q= search, ?group=, ?method=, ?kind=, ?limit=)
 *   GET  /v1/ops/:name     parameters and request body of one operation
 *   POST /v1/ops/:name     run one operation, JSON args in the body
 *   GET  /health
 *
 * Auth: the user's Appeeky API key (Authorization: Bearer … or X-API-Key).
 * Read-only unless the caller sends X-ASC-Allow-Writes: true.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  AppStoreConnectClient,
  ReadOnlyError,
  ValidationError,
  describeOperation,
  opIsWrite,
  searchOperations,
  validateOpArgs,
  type AscOp,
  type JsonApiDocument,
  type Resource,
} from "@appeeky/app-store-connect-core";
import { registerTools, type ClientSource } from "@appeeky/app-store-connect-mcp";
import { findHostedOp, hostedCallableOps, hostedOps, hostedRefusal, writesDisabledMessage } from "./hosted-ops.js";
import { fetchAscSession, SessionError, type AscSession, type SessionConfig } from "./session.js";

const MAX_BODY_BYTES = 1024 * 1024;
const WRITE_HEADER = "x-asc-allow-writes";

const INSTRUCTIONS = `App Store Connect through the user's Appeeky connection.
Call appstore_list_apps first to find app ids.
Every endpoint of the App Store Connect API is reachable: find it with appstore_search_operations, read its parameters and body with appstore_describe_operation, run it with appstore_call_operation.
Write operations (versions, submissions, TestFlight, review responses, prices, users…) are hidden unless the client sends the header X-ASC-Allow-Writes: true; appstore_request only allows GET without it.
Uploading screenshots or previews and downloading profiles needs local files, so use the appstore CLI for those.`;

export interface AppConfig extends SessionConfig {
  version?: string;
  /** fetch used for App Store Connect calls (tests). */
  appleFetch?: typeof fetch;
  /** App Store Connect base URL override (tests). */
  appleBaseUrl?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}

function readApiKey(req: IncomingMessage): string | null {
  const header = req.headers["x-api-key"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  const match = typeof auth === "string" ? auth.match(/^Bearer\s+(.+)$/i) : null;
  return match?.[1]?.trim() || null;
}

function allowsWrites(req: IncomingMessage): boolean {
  return String(req.headers[WRITE_HEADER] ?? "").toLowerCase() === "true";
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "BODY_TOO_LARGE", "Request body is over 1 MB.");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be JSON.");
  }
}

/**
 * Clients for one HTTP request. The Appeeky session is fetched on the first
 * tool call that needs Apple, so initialize and tools/list stay free.
 */
function sessionSource(apiKey: string, readOnly: boolean, config: AppConfig) {
  let pending: Promise<AscSession> | null = null;
  const session = () => (pending ??= fetchAscSession(apiKey, config));
  const source: ClientSource = {
    readOnly,
    async getClientForArgs() {
      const s = await session();
      return {
        client: AppStoreConnectClient.fromAccessToken(s.accessToken, {
          readOnly,
          keyId: s.keyId,
          issuerId: s.issuerId,
          vendorNumber: s.vendorNumber,
          fetch: config.appleFetch,
          baseUrl: config.appleBaseUrl,
        }),
      };
    },
  };
  return { session, source };
}

function buildMcpServer(apiKey: string, allowWrites: boolean, config: AppConfig): McpServer {
  const server = new McpServer(
    { name: "appeeky-app-store-connect", version: config.version ?? "0.1.0" },
    { instructions: INSTRUCTIONS },
  );
  const { source } = sessionSource(apiKey, !allowWrites, config);
  registerTools(server, source, {
    ops: hostedOps(allowWrites),
    callableOps: hostedCallableOps(allowWrites),
    explainUnavailable: (name) => hostedRefusal(name, allowWrites).message,
    writeRefusal: (op) => writesDisabledMessage(op.name),
    accountArg: false,
  });
  return server;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse, apiKey: string, config: AppConfig) {
  if (req.method !== "POST") {
    // Stateless server: no SSE stream to resume and no session to delete.
    res.setHeader("allow", "POST");
    sendError(res, 405, "METHOD_NOT_ALLOWED", "Use POST for MCP requests.");
    return;
  }
  const body = await readBody(req);
  const server = buildMcpServer(apiKey, allowsWrites(req), config);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

function summarizeApps(doc: JsonApiDocument<Resource[]>) {
  return doc.data.map((app) => ({
    id: app.id,
    name: app.attributes?.name,
    bundleId: app.attributes?.bundleId,
    sku: app.attributes?.sku,
    primaryLocale: app.attributes?.primaryLocale,
  }));
}

async function handleRest(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  apiKey: string,
  config: AppConfig,
) {
  const allowWrites = allowsWrites(req);
  const url = new URL(req.url ?? "/", "http://localhost");

  if (path === "/v1/ops" && req.method === "GET") {
    const callable = hostedCallableOps(allowWrites);
    const q = url.searchParams.get("q") ?? "";
    const group = url.searchParams.get("group") ?? undefined;
    const method = url.searchParams.get("method") ?? undefined;
    const kindParam = url.searchParams.get("kind");
    const kind = kindParam === "api" || kindParam === "curated" ? kindParam : undefined;
    if (q || group || method || kind) {
      const limitParam = Number(url.searchParams.get("limit") ?? (q ? 50 : 0));
      const all = searchOperations(q, { ops: callable, group, method, kind });
      const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 2000) : all.length;
      sendJson(res, 200, { data: all.slice(0, limit), total: all.length });
      return;
    }
    sendJson(res, 200, {
      data: callable.map((op) => ({
        name: op.name,
        kind: op.api ? "api" : "curated",
        group: op.group,
        summary: op.summary,
        write: op.write,
        ...(op.api ? { method: op.api.method, path: op.api.path } : {}),
      })),
      total: callable.length,
    });
    return;
  }
  if (path === "/v1/apps" && req.method === "GET") {
    const { source, session } = sessionSource(apiKey, true, config);
    const { client } = await source.getClientForArgs({});
    const doc = (await client.apps.list({ limit: 200 })) as JsonApiDocument<Resource[]>;
    const s = await session();
    sendJson(res, 200, {
      data: { keyId: s.keyId, issuerId: s.issuerId, apps: summarizeApps(doc), next: doc.links?.next ?? null },
    });
    return;
  }

  const match = path.match(/^\/v1\/ops\/([a-z0-9_]+)$/);
  if (!match || (req.method !== "POST" && req.method !== "GET")) {
    sendError(res, 404, "NOT_FOUND", "Not found.");
    return;
  }
  const name = match[1]!;
  const op: AscOp | undefined = findHostedOp(name, allowWrites);
  if (!op) {
    const refusal = hostedRefusal(name, allowWrites);
    sendError(res, refusal.status, refusal.code, refusal.message);
    return;
  }
  if (req.method === "GET") {
    sendJson(res, 200, { data: describeOperation(name, { ops: [op] }) });
    return;
  }

  const body = (await readBody(req)) ?? {};
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "INVALID_ARGS", "Body must be a JSON object of operation arguments.");
  }
  // Unknown keys are kept: generated ops reject them with a precise message.
  const parsed = z.object(op.shape).passthrough().safeParse(body);
  if (!parsed.success) {
    sendJson(res, 400, {
      error: { code: "INVALID_ARGS", message: "Invalid arguments.", details: parsed.error.issues },
    });
    return;
  }
  const args = parsed.data as Record<string, unknown>;
  // Full check (required filters, unknown keys, body) before the metered session.
  validateOpArgs(op, args);
  if (!allowWrites && opIsWrite(op, args)) {
    sendError(res, 403, "WRITES_DISABLED", `This call: ${writesDisabledMessage(op.name)}`);
    return;
  }
  const { source } = sessionSource(apiKey, !allowWrites, config);
  const { client } = await source.getClientForArgs({});
  const result = await op.run(client, args);
  sendJson(res, 200, { data: result ?? { ok: true } });
}

export function createHandler(config: AppConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    try {
      if (path === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }
      const apiKey = readApiKey(req);
      if (!apiKey) {
        sendError(res, 401, "MISSING_API_KEY", "Pass your Appeeky API key as Authorization: Bearer <key> or X-API-Key.");
        return;
      }
      if (path === "/mcp") {
        await handleMcp(req, res, apiKey, config);
        return;
      }
      await handleRest(req, res, path, apiKey, config);
    } catch (error) {
      if (res.headersSent) return;
      if (error instanceof HttpError || error instanceof SessionError) {
        sendError(res, error.status, error.code, error.message);
        return;
      }
      if (error instanceof ReadOnlyError) {
        sendError(res, 403, "WRITES_DISABLED", `${error.message}. Send X-ASC-Allow-Writes: true to allow writes.`);
        return;
      }
      if (error instanceof ValidationError) {
        sendError(res, 400, "INVALID_ARGS", error.message);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      // App Store Connect errors carry Apple's message; they are the caller's to read.
      sendError(res, 502, "APP_STORE_CONNECT_ERROR", message);
    }
  };
}
