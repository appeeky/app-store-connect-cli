import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ClientRegistry } from "@appeeky/app-store-connect-core";
import { registerTools } from "./tools.js";

export interface McpServerOptions {
  issuerId?: string;
  keyId?: string;
  privateKey?: string;
  account?: string;
  readOnly?: boolean;
}

export const MCP_INSTRUCTIONS = `App Store Connect through the user's own API key.
Call appstore_list_apps first to find app ids (or appstore_find_app with a bundle id).
Write operations change the user's App Store Connect account: ask before calling them.
Uploads (screenshots, previews) and profile downloads read or write local files.`;

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  const registry = ClientRegistry.load({
    issuerId: options.issuerId,
    keyId: options.keyId,
    privateKey: options.privateKey,
    account: options.account,
    readOnly: options.readOnly,
  });

  const server = new McpServer(
    { name: "app-store-connect", version: "0.1.0" },
    { instructions: MCP_INSTRUCTIONS },
  );

  registerTools(server, registry);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { registerTools } from "./tools.js";
