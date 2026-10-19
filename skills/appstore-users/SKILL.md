---
name: appstore-users
description: >-
  App Store Connect team members and invitations: list, invite with roles,
  change roles or app access, remove.
---

# Users

```bash
appstore users list
appstore users invite a@b.co --first-name A --last-name B --roles DEVELOPER --confirm
appstore users set-roles USER_ID --roles APP_MANAGER --confirm
appstore users invitations
appstore users remove USER_ID --confirm
```

Roles: ADMIN, FINANCE, SALES, MARKETING, APP_MANAGER, DEVELOPER, CUSTOMER_SUPPORT, ACCESS_TO_REPORTS, CREATE_APPS.

## Rules

- Needs an Admin key.
- Removing users and changing roles always need explicit user approval.
