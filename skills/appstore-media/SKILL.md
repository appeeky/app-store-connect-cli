---
name: appstore-media
description: >-
  Manage App Store screenshots and app previews: sets per display type,
  uploads from local files, ordering and deletion.
---

# Screenshots and previews

```bash
appstore versions localizations VERSION_ID           # localization ids
appstore screenshots sets LOCALIZATION_ID
appstore screenshots create-set LOCALIZATION_ID APP_IPHONE_67 --confirm
appstore screenshots upload SET_ID ./01.png ./02.png --wait --confirm
appstore screenshots reorder SET_ID ID1 ID2 ID3 --confirm
appstore screenshots delete ID --confirm
appstore previews upload SET_ID ./preview.mov --wait --confirm
```

## Rules

- Uploads need local files: CLI or local MCP only (`appstore_upload_screenshot`, `appstore_upload_preview`), not the hosted server.
- Images must match the display type's pixel sizes; Apple rejects others after upload (`assetDeliveryState` FAILED).
- Up to 10 screenshots and 3 previews per set.
