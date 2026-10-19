# Changelog

## Unreleased

- Full API coverage: `API_OPS`, one generated operation per path + method in Apple's App Store Connect OpenAPI spec 4.5.1 (1,303 operations: GET 826, POST 180, PATCH 162, DELETE 135), named `appstore_api_<snake_case operationId>`
- `pnpm generate:ops` (after `pnpm generate:types`) writes `packages/core/src/generated/operations.ts` (compact table, lazily built zod schemas) and `docs/reference/api-operations.mdx`
- Generated ops validate path ids (no `/`, `..`, `?`, `#`), query parameters by Apple's bracket names or grouped objects, enums, required filters and JSON:API bodies; `all` pagination is capped (1,000 items by default, 20,000 / 100 pages max)
- `searchOperations` / `describeOperation` over curated and generated ops; descriptions include request body schemas and an example body
- MCP: `appstore_search_operations`, `appstore_describe_operation`, `appstore_call_operation` on `appstore-mcp` and the hosted server
- Hosted REST: generated ops in `/v1/ops` (write-gated), `?q=` search, `GET /v1/ops/{name}`, validation before the Appeeky session, `CLI_ONLY` refusals
- CLI: `appstore api list|describe|call`; raw requests moved to `appstore api request` (`appstore api GET …` still works)
- CI: offline `pnpm check:generated`

## 0.1.0

- Initial release: `appstore` CLI, `appstore-mcp` stdio server, `@appeeky/app-store-connect-core` SDK and the hosted server
- ES256 API key auth (team and Individual keys), token caching, hosted access tokens
- HTTP client with JSON:API helpers, `links.next` pagination, retries with Retry-After, timeouts, and error messages that include Apple's `associatedErrors`
- TypeScript types generated from Apple's App Store Connect OpenAPI spec 4.5.1
- Shared operations registry (`ASC_OPS`, 168 operations): apps, versions, submissions, phased release, builds, TestFlight, customer reviews, screenshots and previews, in-app purchases, subscriptions, pricing, users, signing, sales/finance/analytics reports, and a generic `appstore_request`
- Multi-account config in `~/.config/appstore/config.json`, `--read-only` and `--confirm` safeguards
- Hosted MCP + REST server on Appeeky sessions (read-only by default)
- Agent skills under `skills/`
