/**
 * Offline check that docs/reference/api-operations.mdx matches the committed
 * generated table (packages/core/src/generated/operations.ts). Run after
 * `pnpm build`. It does not need Apple's spec: freshness of the table itself
 * against the spec is checked by the core tests (against the committed
 * OpenAPI types) and by re-running `pnpm generate:ops`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { API_OPS, API_SPEC_VERSION } from "../packages/core/dist/index.js";
import { renderApiOperationsDoc } from "../packages/core/scripts/api-operations-doc.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "docs/reference/api-operations.mdx");

const expected = renderApiOperationsDoc(
  API_OPS.map((op) => ({
    name: op.name,
    group: op.group,
    method: op.api.method,
    path: op.api.path,
    write: op.write,
    deprecated: op.api.deprecated,
  })),
  { specVersion: API_SPEC_VERSION },
);

if (readFileSync(target, "utf8") !== expected) {
  console.error("docs/reference/api-operations.mdx is out of date. Run: pnpm generate:ops");
  process.exit(1);
}
console.log(`docs/reference/api-operations.mdx is up to date (${API_OPS.length} operations)`);
