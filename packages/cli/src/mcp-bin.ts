#!/usr/bin/env node
import { parseArgs } from "node:util";
import { MCP_HELP, startMcpServer } from "@appeeky/app-store-connect-mcp";

const { values } = parseArgs({
  options: {
    "issuer-id": { type: "string" },
    "key-id": { type: "string" },
    "private-key": { type: "string" },
    account: { type: "string", short: "a" },
    "read-only": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(MCP_HELP);
  process.exit(0);
}

startMcpServer({
  issuerId: values["issuer-id"],
  keyId: values["key-id"],
  privateKey: values["private-key"],
  account: values.account,
  readOnly: values["read-only"],
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
