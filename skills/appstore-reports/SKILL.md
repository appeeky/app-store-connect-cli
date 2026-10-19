---
name: appstore-reports
description: >-
  Download Sales and Trends, finance and analytics reports from App Store
  Connect as JSON rows or raw files. Use for revenue, units, subscriptions
  and engagement questions.
---

# Reports

```bash
appstore reports sales --date 2026-10-18
appstore reports sales --type SUBSCRIPTION --frequency DAILY --report-version 1_3 --date 2026-10-18
appstore reports finance --date 2026-09 --region ZZ --type FINANCE_DETAIL
appstore reports sales --date 2026-10-18 -o ./sales.tsv
appstore --app $APP analytics requests
appstore analytics reports REQUEST_ID --category COMMERCE
appstore analytics instances REPORT_ID --granularity DAILY
appstore analytics segments INSTANCE_ID
appstore analytics download SEGMENT_ID
```

MCP: `appstore_download_sales_report`, `appstore_download_finance_report`, `appstore_list_analytics_*`, `appstore_download_analytics_segment`.

## Rules

- Needs a vendor number (`ASC_VENDOR_NUMBER`, account `vendorNumber`, or `--vendor`).
- Daily reports are ready the next day (Pacific time); a 404 usually means "not yet".
- Results return 1000 rows by default; check `totalRows` / `truncated` before summing.
