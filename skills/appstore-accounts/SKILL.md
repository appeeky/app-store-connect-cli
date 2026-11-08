---
name: appstore-accounts
description: >-
  Manage several App Store Connect API keys and default apps in
  ~/.config/appstore/config.json. Use for agencies, multiple teams, or when
  the user asks to switch accounts or set a default app.
---

# Accounts and default apps

```bash
appstore accounts add studio --key-id ABC123DEFG --issuer-id … --private-key-path ~/keys/AuthKey_ABC123DEFG.p8 --vendor-number 85012345 --default
appstore accounts list
appstore accounts use studio
appstore accounts check
appstore --account client-acme apps list
```

Default app per account:

```bash
appstore apps register 1234567890 --to studio --bundle-id com.studio.app --default
appstore apps registered
```

Apple Search Ads key on the same account (EC private key from Search Ads → Account Settings → API):

```bash
appstore accounts search-ads studio --client-id SEARCHADS.… --team-id SEARCHADS.… --key-id … --private-key-path ~/keys/searchads-private-key.pem [--org-id 1234567]
appstore --account studio search-ads orgs
appstore --account studio search-ads call GET '/api/v5/campaigns?limit=1000'
appstore accounts search-ads studio --remove
```

MCP: `appstore_list_accounts`, `appstore_register_account`, `appstore_register_app`, `appstore_set_default_account`; every tool accepts `account`. A registered app id routes to its account automatically.

## Rules

- Apps do not need registering to be used; `appstore apps list` reads them from Apple.
- Store `.p8` files outside the repo; the config only keeps the path.
- Search Ads needs the private key, never the public key that was uploaded to Apple.
- Search Ads `POST /api/v5/reports/…` and `…/find` are reads; other `POST`, `PUT` and `DELETE` calls need `--confirm`.
