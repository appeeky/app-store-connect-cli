import { z } from "zod";
import { SUBMISSION_ITEM_KINDS, type SubmissionItemKind } from "../resources/submissions.js";
import type { Platform } from "../types.js";
import { appId, id, page, pageOpts, platform, str, strOrArr, type AscOp } from "./shared.js";

const submissionId = id("Review submission");
const kinds = Object.keys(SUBMISSION_ITEM_KINDS) as [SubmissionItemKind, ...SubmissionItemKind[]];

export const SUBMISSION_OPS: AscOp[] = [
  {
    name: "appstore_list_review_submissions",
    group: "submissions",
    summary: "List App Review submissions for an app (filter by platform and state)",
    write: false,
    shape: {
      appId,
      platform: platform.optional(),
      state: strOrArr
        .optional()
        .describe("READY_FOR_REVIEW, WAITING_FOR_REVIEW, IN_REVIEW, UNRESOLVED_ISSUES, CANCELING, COMPLETING, COMPLETE"),
      ...page,
    },
    run: (c, a) =>
      c.submissions.list(str(a.appId, "appId"), {
        ...pageOpts(a),
        platform: a.platform as Platform | undefined,
        state: a.state as string | undefined,
      }),
  },
  {
    name: "appstore_get_review_submission",
    group: "submissions",
    summary: "Get a review submission with its items",
    write: false,
    shape: { submissionId },
    run: (c, a) => c.submissions.get(str(a.submissionId, "submissionId")),
  },
  {
    name: "appstore_list_review_submission_items",
    group: "submissions",
    summary: "List the items (versions, in-app events…) in a review submission",
    write: false,
    shape: { submissionId, ...page },
    run: (c, a) => c.submissions.listItems(str(a.submissionId, "submissionId"), pageOpts(a)),
  },
  {
    name: "appstore_create_review_submission",
    group: "submissions",
    summary: "Create an empty review submission for an app and platform",
    write: true,
    shape: { appId, platform },
    run: (c, a) => c.submissions.create(str(a.appId, "appId"), a.platform as Platform),
  },
  {
    name: "appstore_add_review_submission_item",
    group: "submissions",
    summary: "Add a version (or another reviewable item) to a review submission",
    write: true,
    shape: {
      submissionId,
      itemId: id("Item (e.g. App Store version)"),
      kind: z.enum(kinds).optional().describe("Item relationship, default appStoreVersion"),
    },
    run: (c, a) =>
      c.submissions.addItem(
        str(a.submissionId, "submissionId"),
        str(a.itemId, "itemId"),
        (a.kind as SubmissionItemKind | undefined) ?? "appStoreVersion",
      ),
  },
  {
    name: "appstore_remove_review_submission_item",
    group: "submissions",
    summary: "Remove an item from a review submission",
    write: true,
    shape: { itemId: id("Review submission item") },
    run: (c, a) => c.submissions.removeItem(str(a.itemId, "itemId")),
  },
  {
    name: "appstore_submit_review_submission",
    group: "submissions",
    summary: "Submit a review submission to App Review",
    write: true,
    shape: { submissionId },
    run: (c, a) => c.submissions.submit(str(a.submissionId, "submissionId")),
  },
  {
    name: "appstore_cancel_review_submission",
    group: "submissions",
    summary: "Cancel a review submission (removes it from App Review)",
    write: true,
    shape: { submissionId },
    run: (c, a) => c.submissions.cancel(str(a.submissionId, "submissionId")),
  },
  {
    name: "appstore_submit_version",
    group: "submissions",
    summary: "Send a version to App Review in one step (open or create submission, add version, submit)",
    write: true,
    shape: { appId, versionId: id("App Store version"), platform: platform.optional().describe("Default IOS") },
    run: (c, a) =>
      c.submissions.submitVersion(
        str(a.appId, "appId"),
        str(a.versionId, "versionId"),
        (a.platform as Platform | undefined) ?? "IOS",
      ),
  },
];
