# Changelog

## 0.1.0

- Initial release: `appstore` CLI, `appstore-mcp` stdio server, `@appeeky/app-store-connect-core` SDK and the hosted server
- ES256 API key auth (team and Individual keys), token caching, hosted access tokens
- HTTP client with JSON:API helpers, `links.next` pagination, retries with Retry-After, timeouts, and error messages that include Apple's `associatedErrors`
- TypeScript types generated from Apple's App Store Connect OpenAPI spec 4.5.1
- Shared operations registry (`ASC_OPS`, 168 operations): apps, versions, submissions, phased release, builds, TestFlight, customer reviews, screenshots and previews, in-app purchases, subscriptions, pricing, users, signing, sales/finance/analytics reports, and a generic `appstore_request`
- Multi-account config in `~/.config/appstore/config.json`, `--read-only` and `--confirm` safeguards
- Hosted MCP + REST server on Appeeky sessions (read-only by default)
- Agent skills under `skills/`
