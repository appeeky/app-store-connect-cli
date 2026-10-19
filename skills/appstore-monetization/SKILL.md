---
name: appstore-monetization
description: >-
  In-app purchases, subscription groups, subscriptions, localizations and
  price points in App Store Connect.
---

# In-app purchases and subscriptions

```bash
appstore iap list
appstore iap create com.example.coins100 --name "100 Coins" --type CONSUMABLE --confirm
appstore iap localize IAP_ID en-US --name "100 Coins" --description "…" --confirm
appstore subscriptions groups
appstore subscriptions create GROUP_ID com.example.pro.monthly --name "Pro Monthly" --period ONE_MONTH --confirm
appstore subscriptions localize SUB_ID en-US --name "Pro" --confirm
appstore subscriptions prices SUB_ID --territory USA
appstore subscriptions price-points SUB_ID --territory USA
appstore pricing schedule
```

## Rules

- Product ids are permanent; confirm spelling before creating.
- Display names ≤30, descriptions ≤45 characters.
- Price changes are not wrapped yet: use `appstore_request` and confirm amounts with the user.
