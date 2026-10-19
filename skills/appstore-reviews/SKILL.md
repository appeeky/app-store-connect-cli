---
name: appstore-reviews
description: >-
  Read, summarize and respond to App Store customer reviews. Use when the user
  asks about ratings, unhappy users, or replying to reviews.
---

# Customer reviews

```bash
appstore --app $APP reviews summary --max 500
appstore --app $APP reviews list --rating 1,2 --unanswered --limit 50
appstore reviews get REVIEW_ID
appstore reviews respond REVIEW_ID "…" --confirm
```

MCP: `appstore_reviews_summary`, `appstore_list_customer_reviews` (`hasResponse: false`), `appstore_respond_to_review`, `appstore_delete_review_response`.

## Rules

- Draft replies, show them to the user, and post only after approval.
- Reply in the review's language; keep it short, specific and polite. Max 5970 characters.
- A new response replaces the old one. New responses show as PENDING_PUBLISH first.
