# App Store Connect CLI

**Powered by [Appeeky](https://appeeky.com).**

A scriptable **CLI + MCP + TypeScript SDK** for the [App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi).

Ship iOS, macOS, tvOS and visionOS apps from your terminal, CI or AI agent: versions and metadata, App Review submissions, TestFlight, customer reviews, screenshots, in-app purchases, subscriptions, signing and reports.

| Package | Binaries | Role |
| ------- | -------- | ---- |
| [`@appeeky/app-store-connect-cli`](https://www.npmjs.com/package/@appeeky/app-store-connect-cli) | `appstore`, `appstore-mcp` | CLI + MCP server |

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [Multi-account](#multi-account)
- [Common workflows](#common-workflows)
- [Full API coverage](#full-api-coverage)
- [MCP](#mcp)
- [Agent skills](#agent-skills)
- [SDK](#sdk)
- [Documentation](#documentation)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Install

```bash
npm install -g @appeeky/app-store-connect-cli
```

This installs both binaries:

- `appstore`: CLI
- `appstore-mcp`: MCP server (stdio)

```bash
appstore --help
appstore-mcp --help
```

Also available with other package managers:

```bash
pnpm add -g @appeeky/app-store-connect-cli
yarn global add @appeeky/app-store-connect-cli
bun add -g @appeeky/app-store-connect-cli
```

## Quick start

### 1. Authenticate

Create an API key in App Store Connect → **Users and Access → Integrations → App Store Connect API**. Note the Key ID and Issuer ID and download the `.p8` (never commit it).

```bash
appstore accounts add my-team \
  --key-id ABC123DEFG \
  --issuer-id 00000000-0000-0000-0000-000000000000 \
  --private-key-path ~/.appstoreconnect/AuthKey_ABC123DEFG.p8 \
  --default
appstore whoami
```

Or with environment variables:

```bash
export ASC_KEY_ID=ABC123DEFG
export ASC_ISSUER_ID=00000000-0000-0000-0000-000000000000
export ASC_PRIVATE_KEY_PATH=~/.appstoreconnect/AuthKey_ABC123DEFG.p8   # or ASC_PRIVATE_KEY with the PEM
```

Individual keys work too: leave out the issuer id.

Precedence: flags (`--key-id`, `--issuer-id`, `--private-key`) → `ASC_*` env → `--account` / default account in `~/.config/appstore/config.json`.

### 2. First commands

```bash
appstore apps list
appstore --app com.example.app versions list
appstore --app com.example.app builds latest
appstore --app com.example.app reviews summary
```

Writes need `--confirm`:

```bash
appstore --app com.example.app versions create 2.4.0 --confirm
```

## Multi-account

```bash
appstore accounts add studio --key-id … --issuer-id … --private-key-path … --default
appstore accounts add client-acme --key-id … --issuer-id … --private-key-path …
appstore --account client-acme apps list
appstore apps register 1234567890 --to studio --bundle-id com.studio.app --default
```

Details: [docs/authentication-accounts.mdx](./docs/authentication-accounts.mdx).

## Common workflows

### Submit a version

```bash
export ASC_APP_ID=1234567890
appstore versions create 2.4.0 --confirm
appstore versions set-localization VERSION_ID en-US --whats-new "Faster sync." --confirm
appstore versions attach-build VERSION_ID BUILD_ID --confirm
appstore submit VERSION_ID --confirm
appstore phased-release start VERSION_ID --confirm
```

### TestFlight

```bash
appstore builds latest
appstore testflight groups create "QA" --internal --confirm
appstore testflight groups add-build GROUP_ID BUILD_ID --confirm
appstore testflight testers invite ada@example.com --group GROUP_ID --confirm
appstore testflight submit BUILD_ID --confirm
```

### Reviews

```bash
appstore reviews list --rating 1,2 --unanswered
appstore reviews respond REVIEW_ID "Thanks, fixed in 2.4.1!" --confirm
```

### Reports

```bash
appstore reports sales --date 2026-10-18 --vendor 85012345
appstore reports finance --date 2026-09 --region ZZ
```

### Curated operations

```bash
appstore ops list subscriptions
appstore ops call appstore_list_subscription_groups '{"appId":"1234567890"}'
```

## Full API coverage

Every operation in Apple's App Store Connect OpenAPI spec (4.5.1: **1,303** operations) is available as a named, validated operation generated from the spec: `appstore_api_` + the snake_case operationId, e.g. `apps_getCollection` → `appstore_api_apps_get_collection`.

```bash
appstore api list --search "app clips"                       # search names, paths, summaries
appstore api describe appstore_api_beta_groups_create_instance   # params, enums, body schema + example
appstore api call appstore_api_apps_app_clips_get_to_many_related --param id=1234567890 --param limit=10
appstore api call appstore_api_apps_get_collection --param filter[bundleId]=com.example.app --all
appstore api call appstore_api_beta_groups_create_instance --body @group.json --confirm
appstore api GET /v1/apps/1234567890/appClips                # raw request
```

Query parameters use Apple's names (`filter[platform]`, `fields[apps]`, `include`, `sort`, `limit`) or a grouped object (`{"filter": {"platform": "IOS"}}`). Path ids are checked to be a single segment, writes need `--confirm`, and `--all` pagination is capped.

MCP does not register 1,300 tools: agents use `appstore_search_operations`, `appstore_describe_operation` and `appstore_call_operation` (local and hosted; hosted writes still need `X-ASC-Allow-Writes: true`). Hosted REST: `GET /v1/ops?q=…`, `GET /v1/ops/<name>`, `POST /v1/ops/<name>`.

When Apple ships a new spec: `pnpm generate:types && pnpm generate:ops`, then commit. Details: [docs/concepts/full-api-coverage.mdx](./docs/concepts/full-api-coverage.mdx), reference: [docs/reference/api-operations.mdx](./docs/reference/api-operations.mdx).

## MCP

```json
{
  "mcpServers": {
    "app-store-connect": {
      "command": "appstore-mcp"
    }
  }
}
```

Read-only:

```bash
appstore-mcp --read-only
```

See [docs/mcp/setup.mdx](./docs/mcp/setup.mdx).

Hosted, without a key file (uses your App Store Connect connection in [Appeeky](https://appeeky.com)):

```json
{
  "mcpServers": {
    "app-store-connect": {
      "url": "https://asc-api.appeeky.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_APPEEKY_API_KEY" }
    }
  }
}
```

Read-only unless you add `"X-ASC-Allow-Writes": "true"`. See [docs/mcp/hosted.mdx](./docs/mcp/hosted.mdx).

## Agent skills

Workflow skills for coding agents: releases, TestFlight, reviews, media, monetization, signing, reports and troubleshooting.

```bash
appstore install-skills
```

Or:

```bash
npx skills add ./skills --skill '*' -g -y
```

Docs: [docs/skills/overview.mdx](./docs/skills/overview.mdx).

## SDK

The same client ships as a TypeScript SDK in this monorepo (`packages/core`, import `@appeeky/app-store-connect-core`), with request types generated from Apple's OpenAPI spec. It is bundled into the published CLI and not published separately yet. See [docs/sdk/overview.mdx](./docs/sdk/overview.mdx).

## Documentation

- Site: [asc.appeeky.com](https://asc.appeeky.com)
- Source: [`docs/`](./docs)

```bash
cd docs && npx mintlify dev
```

## Development

```bash
git clone https://github.com/appeeky/app-store-connect-cli.git
cd app-store-connect-cli
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Regenerate the OpenAPI types with `pnpm generate:types`, the generated operations with `pnpm generate:ops`, and the curated operations reference with `pnpm docs:ops`. `pnpm check:generated` verifies the reference pages offline.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, package layout and testing notes.

## License

MIT — see [LICENSE](./LICENSE).

---

This project is an independent tool for the App Store Connect API and is not affiliated with, endorsed by, or sponsored by Apple Inc. App Store, App Store Connect, TestFlight, iOS, macOS, tvOS and visionOS are trademarks of Apple Inc.
