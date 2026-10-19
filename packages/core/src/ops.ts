import { z } from "zod";
import type { AppStoreConnectClient } from "./client.js";
import { ValidationError } from "./errors.js";
import { ACCOUNT_OPS } from "./ops/accounts.js";
import { APPS_OPS } from "./ops/apps.js";
import { BUILD_OPS } from "./ops/builds.js";
import { MEDIA_OPS } from "./ops/media.js";
import { META_OPS } from "./ops/meta.js";
import { IAP_OPS, PRICING_OPS, SUBSCRIPTION_OPS } from "./ops/monetization.js";
import { REPORT_OPS } from "./ops/reports.js";
import { REVIEW_OPS } from "./ops/reviews.js";
import { SIGNING_OPS } from "./ops/signing.js";
import { SUBMISSION_OPS } from "./ops/submissions.js";
import { TESTFLIGHT_OPS } from "./ops/testflight.js";
import { USER_OPS } from "./ops/users.js";
import { RELEASE_OPS, VERSIONS_OPS } from "./ops/versions.js";
import type { AscOp } from "./ops/shared.js";

export { opIsWrite, type AscOp } from "./ops/shared.js";

/** Every operation: MCP tools, `appstore ops call`, and the hosted REST API. */
export const ASC_OPS: AscOp[] = [
  ...META_OPS,
  ...ACCOUNT_OPS,
  ...APPS_OPS,
  ...VERSIONS_OPS,
  ...SUBMISSION_OPS,
  ...RELEASE_OPS,
  ...BUILD_OPS,
  ...TESTFLIGHT_OPS,
  ...REVIEW_OPS,
  ...MEDIA_OPS,
  ...IAP_OPS,
  ...SUBSCRIPTION_OPS,
  ...PRICING_OPS,
  ...USER_OPS,
  ...SIGNING_OPS,
  ...REPORT_OPS,
];

const byName = new Map(ASC_OPS.map((op) => [op.name, op]));

export function listOps(query = ""): AscOp[] {
  const q = query.trim().toLowerCase();
  if (!q) return ASC_OPS;
  return ASC_OPS.filter(
    (op) =>
      op.name.toLowerCase().includes(q) ||
      op.group.toLowerCase().includes(q) ||
      op.summary.toLowerCase().includes(q),
  );
}

export function getOp(name: string): AscOp {
  const op = byName.get(name);
  if (!op) throw new ValidationError(`Unknown operation: ${name}`);
  return op;
}

/** Validate args against the op's schema and run it. */
export async function invokeOp(
  client: AppStoreConnectClient,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const op = getOp(name);
  const parsed = z.object(op.shape).passthrough().safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ");
    throw new ValidationError(`Invalid arguments for ${name}: ${issues}`, parsed.error.issues);
  }
  return op.run(client, parsed.data as Record<string, unknown>);
}
