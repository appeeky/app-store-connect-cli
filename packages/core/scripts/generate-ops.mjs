/**
 * Generate one operation per path + method in Apple's App Store Connect
 * OpenAPI spec.
 *
 *   pnpm generate:ops                    # cached spec from generate:types, else download
 *   pnpm generate:ops --download         # always download Apple's current spec
 *   pnpm generate:ops --spec ./spec.json # use a spec file you already have
 *
 * Output (both committed):
 *   src/generated/operations.ts          compact data table read by src/api-ops.ts
 *   docs/reference/api-operations.mdx    grouped reference table
 *
 * The table is deliberately data, not code: parameter definitions, enum lists
 * and request-body summaries are pooled and referenced by index, and the zod
 * schemas are built lazily at runtime, so 1,300 operations stay small.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { renderApiOperationsDoc } from "./api-operations-doc.mjs";
import { CORE_ROOT, loadSpecText } from "./spec.mjs";

const REPO_ROOT = join(CORE_ROOT, "../..");
const METHODS = ["get", "post", "patch", "put", "delete"];

const { values } = parseArgs({
  options: {
    spec: { type: "string" },
    download: { type: "boolean", default: false },
  },
});

const { text, source } = await loadSpecText({ spec: values.spec, download: values.download, useCache: true });
const spec = JSON.parse(text);
const specVersion = spec.info?.version ?? "unknown";
const schemas = spec.components?.schemas ?? {};

// ── Naming ─────────────────────────────────────────────────────
function snake(operationId) {
  return operationId
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function words(camel) {
  return camel
    .replace(/V\d+$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\bin app\b/g, "in-app")
    .replace(/\bios\b/g, "iOS")
    .replace(/\bmac os\b/g, "macOS")
    .replace(/\bci\b/g, "Xcode Cloud")
    .replace(/\bgame center\b/g, "Game Center")
    .replace(/\bapp store\b/g, "App Store")
    .replace(/\bapp clip\b/g, "App Clip")
    .replace(/\bscm\b/g, "SCM")
    .replace(/\bid\b/g, "ID")
    .replace(/\bids\b/g, "IDs");
}

function singular(phrase) {
  const parts = phrase.split(" ");
  const last = parts.pop() ?? "";
  let one = last;
  if (/(ss|us)$/.test(last)) one = last;
  else if (/(ch|sh|x|ss)es$/.test(last)) one = last.slice(0, -2);
  else if (/uses$/.test(last)) one = last.slice(0, -2);
  else if (/ies$/.test(last)) one = `${last.slice(0, -3)}y`;
  else if (/s$/.test(last) && !/data$/.test(last)) one = last.slice(0, -1);
  return [...parts, one].join(" ");
}

const article = (phrase) => (/^([aeiou]|xcode)/i.test(phrase) ? `an ${phrase}` : `a ${phrase}`);

function summarize(operationId, op) {
  const explicit = (op.summary ?? op.description ?? "").replace(/\s+/g, " ").trim();
  if (explicit) return explicit.length > 160 ? `${explicit.slice(0, 157)}…` : explicit;
  const parts = operationId.split("_");
  const kind = parts[parts.length - 1];
  const resource = words(parts[0]);
  const one = article(singular(resource));
  const rel = parts.length > 2 ? words(parts.slice(1, -1).join("_")) : "";
  let s;
  switch (kind) {
    case "getCollection":
      s = `List ${resource}`;
      break;
    case "getInstance":
      s = `Get ${one}`;
      break;
    case "createInstance":
      s = `Create ${one}`;
      break;
    case "updateInstance":
      s = `Update ${one}`;
      break;
    case "deleteInstance":
      s = `Delete ${one}`;
      break;
    case "getToManyRelated":
      s = `List the ${rel} of ${one}`;
      break;
    case "getToManyRelationship":
      s = `List the ${rel} linkages (IDs only) of ${one}`;
      break;
    case "getToOneRelated":
      s = `Get the ${rel} of ${one}`;
      break;
    case "getToOneRelationship":
      s = `Get the ${rel} linkage (ID only) of ${one}`;
      break;
    case "updateToOneRelationship":
      s = `Set the ${rel} of ${one}`;
      break;
    case "createToManyRelationship":
      s = `Add ${rel} to ${one}`;
      break;
    case "deleteToManyRelationship":
      s = `Remove ${rel} from ${one}`;
      break;
    case "replaceToManyRelationship":
      s = `Replace the ${rel} of ${one}`;
      break;
    case "getMetrics":
      s = `Get ${rel} metrics for ${one}`;
      break;
    default:
      s = `${kind.replace(/([a-z])([A-Z])/g, "$1 $2")} ${rel || resource}`.trim();
      s = s.charAt(0).toUpperCase() + s.slice(1);
  }
  const version = parts[0].match(/V(\d+)$/);
  if (version) s += ` (v${version[1]})`;
  return s;
}

// ── Pools ──────────────────────────────────────────────────────
const enums = [];
const enumIndex = new Map();
function poolEnum(values) {
  if (!values || values.length === 0) return -1;
  const key = JSON.stringify(values);
  if (!enumIndex.has(key)) {
    enumIndex.set(key, enums.length);
    enums.push(values);
  }
  return enumIndex.get(key);
}

const params = [];
const paramIndex = new Map();
function poolParam(row) {
  const key = JSON.stringify(row);
  if (!paramIndex.has(key)) {
    paramIndex.set(key, params.length);
    params.push(row);
  }
  return paramIndex.get(key);
}

const resolve = (schema) => {
  let s = schema;
  let guard = 0;
  while (s?.$ref && guard++ < 10) s = schemas[s.$ref.split("/").pop()];
  return s ?? {};
};
const refName = (schema) => (schema?.$ref ? schema.$ref.split("/").pop() : undefined);

function paramRow(p) {
  const schema = p.schema ?? {};
  let type = "s";
  let values;
  if (schema.type === "array") {
    type = "s[]";
    values = resolve(schema.items).enum;
  } else if (schema.type === "integer" || schema.type === "number") type = "i";
  else if (schema.type === "boolean") type = "b";
  else values = resolve(schema).enum;
  const flags = (p.required ? 1 : 0) | (p.deprecated ? 2 : 0);
  let description = (p.description ?? "").replace(/\s+/g, " ").trim();
  // Apple's stock wording is rebuilt at runtime (src/api-ops.ts); keep the rest.
  if (description === standardDescription(p.name)) description = "";
  return [p.name, type, poolEnum(values), flags, schema.maximum ?? 0, description];
}

/** Must match standardParamDescription() in src/api-ops.ts. */
function standardDescription(name) {
  if (name === "limit") return "maximum resources per page";
  if (name === "include") return "comma-separated list of relationships to include";
  if (name === "sort") return "comma-separated list of sort expressions; resources will be sorted as specified";
  if (name === "filter[id]") return "filter by id(s)";
  let m = name.match(/^fields\[(.+)\]$/);
  if (m) return `the fields to include for returned resources of type ${m[1]}`;
  m = name.match(/^limit\[(.+)\]$/);
  if (m) return `maximum number of related ${m[1]} returned (when they are included)`;
  return undefined;
}

/** Short type label for a body attribute. */
function typeLabel(schema, depth = 0) {
  const name = refName(schema);
  const s = resolve(schema);
  if (s.enum) return "enum";
  if (s.type === "array") {
    const inner = typeLabel(s.items ?? {}, depth);
    return `${inner}[]`;
  }
  if (s.type === "object" || s.properties) {
    if (s.additionalProperties && !s.properties) return "map<string,string>";
    if (depth >= 1) return name ?? "object";
    const keys = Object.entries(s.properties ?? {}).map(([k, v]) => `${k}: ${typeLabel(v, depth + 1)}`);
    return `${name ? `${name} ` : ""}{ ${keys.join(", ")} }`;
  }
  if (s.type === "string" && s.format) return `string (${s.format})`;
  return s.type ?? name ?? "unknown";
}

function enumOf(schema) {
  const s = resolve(schema);
  if (s.enum) return s.enum;
  if (s.type === "array") return resolve(s.items ?? {}).enum;
  return undefined;
}

const bodies = [];
const bodyIndex = new Map();
function poolBody(schemaRef) {
  const name = refName(schemaRef) ?? "inline";
  if (bodyIndex.has(name)) return bodyIndex.get(name);
  const root = resolve(schemaRef);
  const data = resolve(root.properties?.data ?? {});
  const included = root.properties?.included ? 2 : 0;
  let row;
  if (data.type === "array") {
    const item = resolve(data.items ?? {});
    row = [name, "linkages", resolve(item.properties?.type ?? {}).enum?.[0] ?? "", included, [], []];
  } else {
    const props = data.properties ?? {};
    const required = new Set(data.required ?? []);
    const resourceType = resolve(props.type ?? {}).enum?.[0] ?? "";
    const hasAttrs = Boolean(props.attributes);
    const hasRels = Boolean(props.relationships);
    const kind = !hasAttrs && !hasRels ? "linkage" : "resource";
    const flags =
      (required.has("id") ? 1 : 0) | included | (required.has("attributes") ? 4 : 0) | (required.has("relationships") ? 8 : 0);
    const attrSchema = resolve(props.attributes ?? {});
    const attrRequired = new Set(attrSchema.required ?? []);
    const attrs = Object.entries(attrSchema.properties ?? {}).map(([k, v]) => {
      const r = resolve(v);
      const f = (attrRequired.has(k) ? 1 : 0) | (v.nullable || r.nullable ? 2 : 0) | (v.deprecated || r.deprecated ? 4 : 0);
      return [k, typeLabel(v), f, poolEnum(enumOf(v))];
    });
    const relSchema = resolve(props.relationships ?? {});
    const relRequired = new Set(relSchema.required ?? []);
    const rels = Object.entries(relSchema.properties ?? {}).map(([k, v]) => {
      const relData = resolve(resolve(v).properties?.data ?? {});
      const many = relData.type === "array";
      const target = resolve(many ? relData.items : relData);
      const type = resolve(target.properties?.type ?? {}).enum?.[0] ?? "";
      const f = (relRequired.has(k) ? 1 : 0) | (many ? 2 : 0) | (relData.nullable ? 4 : 0);
      return [k, type, f];
    });
    row = [name, kind, resourceType, flags, attrs, rels];
  }
  bodyIndex.set(name, bodies.length);
  bodies.push(row);
  return bodies.length - 1;
}

// ── Operations ─────────────────────────────────────────────────
const operations = [];
const seenNames = new Map();
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  const shared = item.parameters ?? [];
  for (const method of METHODS) {
    const op = item[method];
    if (!op) continue;
    const merged = new Map();
    for (const p of [...shared, ...(op.parameters ?? [])]) {
      const real = p.$ref ? resolve(p) : p;
      merged.set(`${real.in}:${real.name}`, real);
    }
    const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    for (const name of pathParams) {
      if (!merged.has(`path:${name}`)) throw new Error(`${method.toUpperCase()} ${path}: path parameter {${name}} is not declared`);
    }
    const query = [...merged.values()].filter((p) => p.in === "query").map((p) => poolParam(paramRow(p)));
    for (const p of merged.values()) {
      if (p.in !== "query" && p.in !== "path") throw new Error(`${op.operationId}: unsupported parameter location ${p.in}`);
    }

    let body = -1;
    if (op.requestBody) {
      const content = op.requestBody.content ?? {};
      const json = content["application/json"];
      if (!json) throw new Error(`${op.operationId}: request body without application/json`);
      body = poolBody(json.schema);
    }

    let accept = "";
    const ok = Object.entries(op.responses ?? {}).find(([code]) => code.startsWith("2") && code !== "204");
    const types = Object.keys(ok?.[1]?.content ?? {});
    if (types.length > 0 && !types.includes("application/json")) accept = types[0];

    const operationId = op.operationId ?? `${method}_${path}`;
    let name = `appstore_api_${snake(operationId)}`;
    if (seenNames.has(name)) {
      let n = 2;
      while (seenNames.has(`${name}_${n}`)) n++;
      name = `${name}_${n}`;
    }
    seenNames.set(name, operationId);

    operations.push([
      // Empty when it is the default appstore_api_<snake operationId> (src/api-ops.ts derives it).
      name === `appstore_api_${snake(operationId)}` ? "" : name,
      operationId,
      method.toUpperCase(),
      path,
      summarize(operationId, op),
      op.deprecated ? 1 : 0,
      query,
      body,
      accept,
    ]);
  }
}

// ── Emit ───────────────────────────────────────────────────────
const j = (v) => JSON.stringify(v);
const lines = (rows) => rows.map((r) => `  ${j(r)},`).join("\n");
const byMethod = {};
for (const op of operations) byMethod[op[2]] = (byMethod[op[2]] ?? 0) + 1;

const ts = `/**
 * Every App Store Connect API operation, generated from Apple's official
 * OpenAPI spec by packages/core/scripts/generate-ops.mjs. Do not edit by hand:
 * run \`pnpm generate:ops\`.
 *
 * Spec version: ${specVersion} · ${operations.length} operations (${Object.entries(byMethod)
  .map(([m, n]) => `${m} ${n}`)
  .join(", ")})
 *
 * Compact on purpose: rows reference pooled enums, query parameters and
 * request-body summaries by index; src/api-ops.ts turns them into ops.
 */

/** Spec version this table was generated from. */
export const API_SPEC_VERSION = ${j(specVersion)};

/** Query parameter type: string, comma-separated string list, integer, boolean. */
export type ApiParamType = "s" | "s[]" | "i" | "b";

/** [name, type, enum index or -1, flags (1 required, 2 deprecated), maximum or 0, description ("" = Apple's stock wording)] */
export type ApiParamRow = readonly [string, ApiParamType, number, number, number, string];

/** [name, type label, flags (1 required, 2 nullable, 4 deprecated), enum index or -1] */
export type ApiBodyAttributeRow = readonly [string, string, number, number];

/** [name, resource type, flags (1 required, 2 to-many, 4 nullable)] */
export type ApiBodyRelationshipRow = readonly [string, string, number];

/**
 * [schema name, kind, resource type, flags (1 id required, 2 accepts included,
 * 4 attributes required, 8 relationships required), attributes, relationships]
 */
export type ApiBodyRow = readonly [
  string,
  "resource" | "linkage" | "linkages",
  string,
  number,
  readonly ApiBodyAttributeRow[],
  readonly ApiBodyRelationshipRow[],
];

/**
 * [name ("" = appstore_api_ + snake_case operationId), operationId, method,
 * path, summary, flags (1 deprecated), query parameter indexes, body index or
 * -1, non-JSON Accept type or ""]. The group is the path's first segment.
 */
export type ApiOperationRow = readonly [
  string,
  string,
  "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  string,
  string,
  number,
  readonly number[],
  number,
  string,
];

export const API_ENUMS: readonly (readonly string[])[] = [
${lines(enums)}
];

export const API_PARAMS: readonly ApiParamRow[] = [
${lines(params)}
];

export const API_BODIES: readonly ApiBodyRow[] = [
${lines(bodies)}
];

export const API_OPERATIONS: readonly ApiOperationRow[] = [
${lines(operations)}
];
`;

writeFileSync(join(CORE_ROOT, "src/generated/operations.ts"), ts);

const doc = renderApiOperationsDoc(
  operations.map((op) => ({
    name: op[0] || `appstore_api_${snake(op[1])}`,
    group: op[3].split("/")[2] ?? "misc",
    method: op[2],
    path: op[3],
    write: op[2] !== "GET",
    deprecated: op[5] === 1,
  })),
  { specVersion },
);
writeFileSync(join(REPO_ROOT, "docs/reference/api-operations.mdx"), doc);

console.log(
  `Generated ${operations.length} operations from ${source} (spec ${specVersion}): ` +
    `${params.length} parameter definitions, ${enums.length} enums, ${bodies.length} request bodies`,
);
