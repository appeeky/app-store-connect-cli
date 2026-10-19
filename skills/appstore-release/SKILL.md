---
name: appstore-release
description: >-
  Prepare and ship an App Store version: create the version, edit
  localizations (description, keywords, what's new, promo text), attach a
  build, App Review details, submit for review, release, phased release.
---

# Release workflow

```bash
export ASC_APP_ID=1234567890
appstore versions create 2.4.0 --platform IOS --release-type MANUAL --confirm
appstore versions localizations VERSION_ID
appstore versions set-localization VERSION_ID en-US --whats-new "…" --confirm
appstore builds list --marketing-version 2.4.0 --state VALID
appstore builds encryption BUILD_ID --uses-non-exempt-encryption false --confirm
appstore versions attach-build VERSION_ID BUILD_ID --confirm
appstore versions set-review-details VERSION_ID --email … --phone … --notes … --confirm
appstore submit VERSION_ID --confirm
appstore submissions list --state WAITING_FOR_REVIEW,IN_REVIEW
```

After approval:

```bash
appstore release VERSION_ID --confirm
appstore phased-release start|pause|resume|complete VERSION_ID --confirm
```

MCP: `appstore_create_version`, `appstore_update_version_localization`, `appstore_attach_build`, `appstore_create_review_details`, `appstore_submit_version`, `appstore_release_version`, `appstore_update_phased_release`.

## Rules

- Keywords: comma-separated, ≤100 bytes. Promotional text ≤170. Name and subtitle ≤30 (`apps set-localization`).
- If submit fails, read every line of the error: Apple lists missing fields per resource.
- Never submit or release without explicit user approval.
