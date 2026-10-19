import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppStoreConnectClient, ASC_OPS, type AscOp } from "@appeeky/app-store-connect-core";

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
  /** Operations to expose (default: all). Hosted mode drops local-file ops. */
  ops?: AscOp[];
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

export function registerTools(server: McpServer, source: ClientSource, options: RegisterToolsOptions = {}): void {
  const ops = options.ops ?? ASC_OPS;
  const withAccount = options.accountArg ?? true;
  const capabilities = ops.map((op) => ({
    id: op.name,
    group: op.group,
    summary: op.summary,
    write: op.write,
  }));

  server.tool(
    "appstore_search_capabilities",
    "Search available App Store Connect operations",
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

  server.tool("appstore_list_capabilities", "List all App Store Connect operations", {}, async () =>
    text(capabilities),
  );

  for (const op of ops) {
    // Local config ops carry their own `account` argument.
    const shape = withAccount && !("account" in op.shape) ? { ...op.shape, account: accountField } : op.shape;
    server.tool(op.name, op.summary, shape, async (args) => {
      try {
        const record = args as Record<string, unknown>;
        const { client, accountId } =
          op.group === "accounts"
            ? { client: AppStoreConnectClient.unauthenticated({ readOnly: source.readOnly }), accountId: undefined }
            : await source.getClientForArgs({
                account: record.account as string | undefined,
                appId: record.appId as string | undefined,
              });
        const result = await op.run(client, record);
        if (accountId && result && typeof result === "object" && !Array.isArray(result)) {
          return text({ account: accountId, ...(result as object) });
        }
        return text(result);
      } catch (error) {
        return toolError(error);
      }
    });
  }
}
