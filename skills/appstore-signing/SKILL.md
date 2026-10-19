---
name: appstore-signing
description: >-
  Bundle IDs, capabilities, devices, certificates and provisioning profiles
  through the App Store Connect API.
---

# Signing

```bash
appstore bundle-ids list --identifier com.example.app
appstore bundle-ids create com.example.app --name Example --confirm
appstore devices list
appstore devices register "Ada's iPhone" UDID --confirm
appstore certificates --type DISTRIBUTION
appstore profiles list --type IOS_APP_STORE --state ACTIVE
appstore profiles create NAME --type IOS_APP_STORE --bundle-id BUNDLE_RESOURCE_ID --certificates CERT_ID --confirm
appstore profiles download PROFILE_ID -o ./App.mobileprovision
```

## Rules

- `--bundle-id` on profiles is the resource id from `bundle-ids list`, not the identifier.
- Development and ad hoc profiles need `--devices`.
- Device slots are limited per year; disabling does not free a slot.
