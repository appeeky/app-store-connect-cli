---
name: appstore-mcp
description: >-
  Configure and use the appstore-mcp server (stdio) or the hosted App Store
  Connect MCP at asc-api.appeeky.com. Use when wiring MCP clients or choosing
  App Store Connect tools.
---

# App Store Connect MCP

## Local (your key)

```json
{ "mcpServers": { "app-store-connect": { "command": "appstore-mcp" } } }
```

Env alternative: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY_PATH`. Read-only: `"args": ["--read-only"]`. Pick an account: `"args": ["--account", "studio"]`.

## Hosted (Appeeky connection, no key file)

```json
{
  "mcpServers": {
    "app-store-connect": {
      "url": "https://asc-api.appeeky.com/mcp",
      "headers": { "Authorization": "Bearer APPEEKY_API_KEY" }
    }
  }
}
```

Read-only unless the header `X-ASC-Allow-Writes: true` is added. No uploads or profile downloads.

## Using the tools

1. `appstore_list_apps` or `appstore_find_app` to get the numeric `appId`.
2. `appstore_search_capabilities` with a keyword to find the right tool.
3. Read before writing; ask the user before any write tool.
4. `appstore_request` covers endpoints without a dedicated tool.
