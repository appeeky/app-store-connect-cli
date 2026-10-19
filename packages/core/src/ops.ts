import { z } from "zod";
import { API_OPS, validateApiArgs } from "./api-ops.js";
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

export { opIsWrite, type AscOp, type ApiOpInfo } from "./ops/shared.js";

/**
 * Curated operations: one MCP tool each, `appstore ops call`, and the hosted
 * REST API. The generated API_OPS (every endpoint in Apple's spec) are
 * reached through search/describe/call instead.
 */
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

/** Curated ops followed by every generated API op. */
export const ALL_OPS: AscOp[] = [...ASC_OPS, ...API_OPS];

const byName = new Map(ALL_OPS.map((op) => [op.name, op]));

/** Curated ops whose name, group or summary contains the query. */
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

/** A curated or generated op by name. */
export function getOp(name: string): AscOp {
  const op = byName.get(name);
  if (!op) throw new ValidationError(`Unknown operation: ${name}`);
  return op;
}

/**
 * Check args without calling Apple: the op's zod shape, and for generated
 * ops also required query parameters, unknown keys, path ids and the body.
 * Returns the parsed args.
 */
export function validateOpArgs(op: AscOp, args: Record<string, unknown> = {}): Record<string, unknown> {
  const parsed = z.object(op.shape).passthrough().safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ");
    throw new ValidationError(`Invalid arguments for ${op.name}: ${issues}`, parsed.error.issues);
  }
  const data = parsed.data as Record<string, unknown>;
  if (op.api) validateApiArgs(op, data);
  return data;
}

/** Validate args against the op's schema and run it. */
export async function invokeOp(
  client: AppStoreConnectClient,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const op = getOp(name);
  return op.run(client, validateOpArgs(op, args));
}
