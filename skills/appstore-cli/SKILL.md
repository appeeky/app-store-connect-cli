---
name: appstore-cli
description: >-
  Use the appstore CLI for App Store Connect automation (apps, versions,
  builds, TestFlight, reviews, IAP, signing, reports). Use for general appstore
  commands, flags, JSON output, or when unsure which appstore-* skill to load.
---

# App Store Connect CLI (`appstore`)

## Auth

```bash
appstore whoami            # which key, team or individual, read-only?
```

If that fails, load `appstore-auth`.

## Rules

- Writes need `--confirm`. Get the user's approval first, then add it.
- Use `--read-only` when the user only wants to look.
- Use `--json` when you need to parse output.
- `--app` takes the numeric Apple id or a bundle id. Default: account `defaultAppId` or `ASC_APP_ID`.

## Everyday commands

```bash
appstore apps list
appstore --app com.example.app versions list
appstore --app com.example.app builds latest
appstore --app com.example.app reviews summary
appstore --app com.example.app testflight groups list
```

## Discovery

```bash
appstore search phased
appstore ops list subscriptions
appstore ops describe appstore_create_version
appstore ops call appstore_list_builds '{"appId":"1234567890","limit":5}'
appstore api list --search "app clips"
appstore api call appstore_api_apps_app_clips_get_to_many_related --param id=1234567890
appstore api GET /v1/apps/1234567890/appClips
```

## Specialized skills

| Task | Skill |
|------|-------|
| Keys, env vars | `appstore-auth` |
| Several keys / default apps | `appstore-accounts` |
| MCP setup | `appstore-mcp` |
| Versions, submit, release | `appstore-release` |
| Builds, TestFlight | `appstore-testflight` |
| Customer reviews | `appstore-reviews` |
| Screenshots, previews | `appstore-media` |
| IAP, subscriptions | `appstore-monetization` |
| Certificates, profiles, devices | `appstore-signing` |
| Team members | `appstore-users` |
| Sales, finance, analytics | `appstore-reports` |
| Any other endpoint | `appstore-ops` |
| Errors | `appstore-troubleshooting` |
