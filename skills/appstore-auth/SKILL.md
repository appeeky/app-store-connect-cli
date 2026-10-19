---
name: appstore-auth
description: >-
  Set up App Store Connect API key authentication for appstore and
  appstore-mcp: key id, issuer id, .p8 file, env vars, Individual keys,
  read-only mode. Use when auth fails or a new key must be configured.
---

# App Store Connect auth

Keys come from App Store Connect → Users and Access → Integrations → App Store Connect API. Needed: **Key ID**, **Issuer ID** (team keys only) and the `.p8` file.

## Options (first match wins)

1. Flags: `--key-id`, `--issuer-id`, `--private-key <path|pem>`
2. Env: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY_PATH` or `ASC_PRIVATE_KEY` (PEM, `\n` escapes ok)
3. Saved account: `appstore accounts add NAME --key-id … --issuer-id … --private-key-path … --default`

`--account NAME` always uses that saved account.

## Individual keys

No issuer id: omit `--issuer-id`. Tokens then use `sub: "user"`.

## Check

```bash
appstore whoami
appstore accounts check
```

## Rules

- Never print, paste or commit the `.p8` contents. Point at the file path.
- Reports need a key with Finance/Sales/Admin and a vendor number (`ASC_VENDOR_NUMBER` or `--vendor-number` on the account).
- For inspection-only sessions use `--read-only` (`appstore-mcp --read-only`).
