---
name: appstore-troubleshooting
description: >-
  Diagnose appstore and App Store Connect API errors: 401/403 auth problems,
  409 state errors with associatedErrors, read-only refusals, rate limits,
  missing vendor numbers.
---

# Troubleshooting

| Symptom | Fix |
|---------|-----|
| `No App Store Connect API key found` | Set `ASC_*` env vars or `appstore accounts add` (see `appstore-auth`) |
| HTTP 401 NOT_AUTHORIZED | Wrong key id / issuer id pair, revoked key, or a team key used without its issuer id |
| HTTP 403 FORBIDDEN_ERROR | The key's role cannot do this (reports need Finance/Sales; users need Admin) |
| HTTP 409 with indented lines | Read each `- /v1/…` line: Apple lists the missing or invalid fields per resource |
| `Cannot perform write operation … in read-only mode` | Drop `--read-only`, or add `X-ASC-Allow-Writes: true` on the hosted server |
| `Refusing to run write operation … without --confirm` | Ask the user, then add `--confirm` |
| HTTP 429 | Retried automatically with Retry-After; slow down loops |
| `A vendor number is required` | `ASC_VENDOR_NUMBER` or `--vendor-number` on the account |
| HTTP 404 on a report | The report for that date is not generated yet |

Run `appstore whoami` to see which key and account are in use.
