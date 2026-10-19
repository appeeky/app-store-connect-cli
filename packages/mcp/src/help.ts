export const MCP_HELP = `appstore-mcp — App Store Connect MCP server (stdio)

Usage:
  appstore-mcp [--issuer-id <id>] [--key-id <id>] [--private-key <path|pem>] [--account <id>] [--read-only]

Environment:
  ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY_PATH (or ASC_PRIVATE_KEY with the PEM)
  ASC_VENDOR_NUMBER (sales and finance reports)

Multi-account:
  Configure ~/.config/appstore/config.json with named accounts (appstore accounts add).
  Pass --account, or the tool argument "account". Apps registered under one account route there.
`;
