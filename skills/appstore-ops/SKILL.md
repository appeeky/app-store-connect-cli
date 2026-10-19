---
name: appstore-ops
description: >-
  Run any App Store Connect operation through the registry (appstore ops
  call, MCP tool names) or a raw endpoint (appstore api / appstore_request).
  Use when no dedicated command exists.
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

## Raw endpoints

```bash
appstore api GET /v1/apps/1234567890/appCustomProductPages --query limit=20
appstore api POST /v1/… --body '{"data":{…}}' --confirm
```

MCP: `appstore_request` with `method`, `path`, `query`, `body`, `all`. Non-GET is a write.

## Rules

- Paths start with `/v1`, `/v2`, …; full URLs are refused.
- Bodies are JSON:API: `{"data":{"type":…, "id":…, "attributes":{…}, "relationships":{…}}}`.
