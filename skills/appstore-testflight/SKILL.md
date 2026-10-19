---
name: appstore-testflight
description: >-
  Builds and TestFlight: processing state, export compliance, What to Test,
  beta groups, testers, invitations, Beta App Review submission.
---

# TestFlight

```bash
appstore builds latest
appstore builds state BUILD_ID                      # wait for VALID
appstore builds what-to-test BUILD_ID "…" --confirm
appstore testflight groups list
appstore testflight groups create "QA" --internal --confirm
appstore testflight groups add-build GROUP_ID BUILD_ID --confirm
appstore testflight testers invite a@b.co --group GROUP_ID --confirm
appstore testflight submit BUILD_ID --confirm       # external testing
appstore builds expire BUILD_ID --confirm
```

MCP: `appstore_list_builds`, `appstore_get_build_processing_state`, `appstore_create_beta_build_localization`, `appstore_create_beta_group`, `appstore_add_builds_to_beta_group`, `appstore_invite_beta_tester`, `appstore_submit_for_beta_review`.

## Rules

- External groups need Beta App Review; internal groups do not.
- `usesNonExemptEncryption` must be answered before a build can be tested or submitted.
- Deleting a tester removes them from all apps; prefer removing from a group.
