# Contributing

Thanks for contributing to the App Store Connect CLI.

## Setup

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

## Package layout

| Package | Path | Role |
| ------- | ---- | ---- |
| `@appeeky/app-store-connect-core` | `packages/core` | Client, resources, ops registry, generated types (private / bundled) |
| `@appeeky/app-store-connect-cli` | `packages/cli` | Published package: `appstore` + `appstore-mcp` |
| `@appeeky/app-store-connect-mcp` | `packages/mcp` | MCP internals (private / bundled) |
| `@appeeky/app-store-connect-server` | `packages/server` | Hosted MCP + REST (private, deployed with `railway.json`) |

Add API coverage in **core** first, register it in the ops registry (`packages/core/src/ops/`), then add CLI commands only where they shorten a common workflow. MCP tools and the hosted API come from the registry. Refresh the docs table with `pnpm build && pnpm docs:ops`.

## OpenAPI types and generated operations

`pnpm generate:types` downloads Apple's App Store Connect OpenAPI spec and regenerates the types in `packages/core/src/generated/`. Then `pnpm generate:ops` regenerates `packages/core/src/generated/operations.ts` (one operation per path + method) and `docs/reference/api-operations.mdx` from the same spec (cached in `packages/core/.spec/`, not committed). Commit the results and mention the spec version. `pnpm check:generated` (run in CI after `pnpm build`) checks the reference pages against the committed tables without network.

## Agent skills

Workflow skills live in `skills/`. After changing them:

```bash
appstore install-skills
```

## Tests

Unit tests use a scripted `fetch` and a throwaway P-256 key (`packages/core/src/test-utils.ts`); they never call Apple. Do not commit `.p8` keys.

## Releasing

Bump `packages/cli/package.json`, update `CHANGELOG.md`, and push a `v<version>` tag. The release workflow publishes `@appeeky/app-store-connect-cli` with `NPM_TOKEN`.

## Docs

Mintlify docs are in [`docs/`](./docs). Preview with:

```bash
cd docs && npx mintlify dev
```
