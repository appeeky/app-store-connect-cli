import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AppStoreConnectClient,
  ASC_OPS,
  API_OPS,
  ReadOnlyError,
  ValidationError,
  describeOperation,
  invokeOp,
  opIsWrite,
  searchOperations,
  validateOpArgs,
  type AscOp,
} from "@appeeky/app-store-connect-core";

/** Where tools get a client from: the local ClientRegistry or a hosted session. */
export interface ClientSource {
  /** Read-only mode, used for local config ops that run without a key. */
  readonly readOnly?: boolean;
  getClientForArgs(args: {
    account?: string;
    appId?: string;
  }): Promise<{ client: AppStoreConnectClient; accountId?: string }>;
}

export interface RegisterToolsOptions {
  /** Curated operations registered as one tool each (default: all of ASC_OPS). Hosted mode drops local-file ops. */
  ops?: AscOp[];
  /**
   * Operations reachable through appstore_search_operations,
   * appstore_describe_operation and appstore_call_operation
   * (default: `ops` plus every generated API op).
   */
  callableOps?: AscOp[];
  /**
   * Explains why a name outside `callableOps` cannot be used here (hosted:
   * writes disabled, CLI-only). Undefined means the operation is unknown.
   */
  explainUnavailable?: (name: string) => string | undefined;
  /** Message for a write refused because the source is read-only. */
  writeRefusal?: (op: AscOp) => string;
  /** Add the `account` argument (multi-key local config). Default true. */
  accountArg?: boolean;
}

function text(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result ?? { ok: true }, null, 2) }],
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

const accountField = z
  .string()
  .optional()
  .describe("Named account id from ~/.config/appstore/config.json (multi-key)");

type Runner = (client: AppStoreConnectClient, args: Record<string, unknown>) => Promise<unknown>;

/** Run one op with a client from the source; tags object results with the account. */
async function execute(
  source: ClientSource,
  op: AscOp,
  args: Record<string, unknown>,
  account: string | undefined,
  run: Runner = op.run,
): Promise<unknown> {
  const { client, accountId } =
    op.group === "accounts"
      ? { client: AppStoreConnectClient.unauthenticated({ readOnly: source.readOnly }), accountId: undefined }
      : await source.getClientForArgs({
          account,
          appId: typeof args.appId === "string" ? args.appId : undefined,
        });
  const result = await run(client, args);
  if (accountId && result && typeof result === "object" && !Array.isArray(result)) {
    return { account: accountId, ...(result as object) };
  }
  return result;
}

export function registerTools(server: McpServer, source: ClientSource, options: RegisterToolsOptions = {}): void {
  const ops = options.ops ?? ASC_OPS;
  const callable = options.callableOps ?? [...ops, ...API_OPS];
  const callableByName = new Map(callable.map((op) => [op.name, op]));
  const withAccount = options.accountArg ?? true;
  const capabilities = ops.map((op) => ({
    id: op.name,
    group: op.group,
    summary: op.summary,
    write: op.write,
  }));

  const lookup = (name: string): AscOp => {
    const op = callableByName.get(name);
    if (!op) throw new ValidationError(options.explainUnavailable?.(name) ?? `Unknown operation: ${name}`);
    return op;
  };

  server.tool(
    "appstore_search_capabilities",
    "Search the curated App Store Connect tools (every API endpoint: appstore_search_operations)",
    { query: z.string().optional().describe("Search query") },
    async ({ query }) => {
      const q = (query ?? "").trim().toLowerCase();
      return text(
        q
          ? capabilities.filter(
              (c) =>
                c.id.toLowerCase().includes(q) ||
                c.group.toLowerCase().includes(q) ||
                c.summary.toLowerCase().includes(q),
            )
          : capabilities,
      );
    },
  );

  server.tool("appstore_list_capabilities", "List the curated App Store Connect tools", {}, async () =>
    text(capabilities),
  );

  server.tool(
    "appstore_search_operations",
    "Search every App Store Connect API operation (one per endpoint in Apple's OpenAPI spec) and the curated tools. Returns name, method, path, write and parameter names. Next: appstore_describe_operation, then appstore_call_operation.",
    {
      query: z
        .string()
        .optional()
        .describe('Words matched against name, path, group and summary, e.g. "app store version localizations"'),
      group: z.string().optional().describe("Resource group (first path segment), e.g. apps, builds, betaGroups"),
      method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]).optional(),
      limit: z.number().int().min(1).max(200).optional().describe("Max results (default 20)"),
    },
    async ({ query, group, method, limit }) => {
      const all = searchOperations(query ?? "", { ops: callable, group, method });
      return text({ total: all.length, results: all.slice(0, limit ?? 20) });
    },
  );

  server.tool(
    "appstore_describe_operation",
    "Full parameters of one operation: path and query parameters with types and enums, pagination, and the JSON:API request body (required attributes and relationships, with an example).",
    { name: z.string().min(1).describe("Operation name from appstore_search_operations") },
    async ({ name }) => {
      try {
        return text(describeOperation(lookup(name).name, { ops: callable }));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.tool(
    "appstore_call_operation",
    "Call any operation by name: a generated API operation or a curated tool. Writes change the user's App Store Connect account: ask before calling them.",
    {
      name: z.string().min(1).describe("Operation name, e.g. appstore_api_apps_get_collection"),
      args: z
        .record(z.unknown())
        .optional()
        .describe(
          'Arguments, e.g. {"id": "123", "filter[platform]": "IOS", "limit": 50} or grouped {"filter": {"platform": "IOS"}}; writes take "body"',
        ),
      ...(withAccount ? { account: accountField } : {}),
    },
    async (input) => {
      const { name, args = {}, account } = input as { name: string; args?: Record<string, unknown>; account?: string };
      let op: AscOp | undefined;
      try {
        op = lookup(name);
        if (source.readOnly && opIsWrite(op, args)) throw new ReadOnlyError(op.name);
        // Reject bad arguments before asking the source for a key or session.
        validateOpArgs(op, args);
        return text(await execute(source, op, args, account, (client, a) => invokeOp(client, name, a)));
      } catch (error) {
        if (error instanceof ReadOnlyError && op && options.writeRefusal) {
          return toolError(new Error(options.writeRefusal(op)));
        }
        return toolError(error);
      }
    },
  );

  for (const op of ops) {
    // Local config ops carry their own `account` argument.
    const shape = withAccount && !("account" in op.shape) ? { ...op.shape, account: accountField } : op.shape;
    server.tool(op.name, op.summary, shape, async (args) => {
      try {
        const record = args as Record<string, unknown>;
        return text(await execute(source, op, record, record.account as string | undefined));
      } catch (error) {
        return toolError(error);
      }
    });
  }
}
