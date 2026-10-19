---
name: appstore-ops
description: >-
  Run any App Store Connect operation: curated ops (appstore ops call, MCP
  tool names), the generated operation for every API endpoint (appstore api
  list/describe/call, appstore_search_operations / appstore_call_operation),
  or a raw request. Use when no dedicated command exists.
---

# Operations registry

```bash
appstore ops list                 # all 168
appstore ops list testflight      # filter
appstore ops describe appstore_update_subscription
appstore ops call appstore_list_versions '{"appId":"1234567890","platform":"IOS"}'
appstore ops call appstore_update_subscription '{"subscriptionId":"…","reviewNote":"…"}' --confirm
```

List ops accept `limit` (≤200), `all: true`, `maxItems`.

## Every endpoint, by name

One generated operation per endpoint in Apple's OpenAPI spec, named `appstore_api_<snake_case operationId>`:

```bash
appstore api list --search "custom product pages"
appstore api describe appstore_api_app_custom_product_pages_create_instance
appstore api call appstore_api_apps_app_custom_product_pages_get_to_many_related --param id=1234567890 --param limit=20
appstore api call appstore_api_beta_groups_create_instance --body @group.json --confirm
```

- Query params by Apple's names (`filter[platform]=IOS`, `fields[apps]=name`, `include=builds`) or grouped (`{"filter":{"platform":"IOS"}}`).
- `describe` shows required body attributes/relationships and an example body.
- `--all` follows pagination (capped at 1,000 items unless `--max-items`).

MCP: `appstore_search_operations` → `appstore_describe_operation` → `appstore_call_operation` with `{"name": …, "args": {…}}`.

## Raw endpoints

```bash
appstore api GET /v1/apps/1234567890/appCustomProductPages --query limit=20
appstore api POST /v1/… --body '{"data":{…}}' --confirm
```

MCP: `appstore_request` with `method`, `path`, `query`, `body`, `all`. Non-GET is a write.

## Rules

- Paths start with `/v1`, `/v2`, …; full URLs are refused.
- Bodies are JSON:API: `{"data":{"type":…, "id":…, "attributes":{…}, "relationships":{…}}}`.
