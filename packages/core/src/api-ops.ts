/**
 * Every App Store Connect API operation as a named op, built from the
 * generated table in ./generated/operations.ts (one row per path + method in
 * Apple's OpenAPI spec).
 *
 * Names are `appstore_api_` + the snake_case operationId, e.g.
 * apps_getCollection → appstore_api_apps_get_collection.
 *
 * Arguments:
 * - path parameters by name (`id`), validated as one safe path segment
 * - query parameters by Apple's own names (`filter[platform]`, `fields[apps]`,
 *   `include`, `limit`, `sort`, `exists[...]`, `limit[builds]`…), or grouped:
 *   `{ "filter": { "platform": "IOS" }, "fields": { "apps": ["name"] } }`
 * - list values as arrays or comma-separated strings
 * - `body`: the JSON:API request document, sent as given (data.type and, for
 *   updates, data.id are filled in when missing)
 * - `all` / `maxItems` on GET collections: follow pagination, capped
 *
 * Zod schemas are built on first use per operation, so loading 1,300 ops
 * costs a table walk, not 1,300 schemas.
 */
import { z, type ZodRawShape, type ZodTypeAny } from "zod";
import type { AppStoreConnectClient } from "./client.js";
import { ValidationError } from "./errors.js";
import type { Query } from "./jsonapi.js";
import {
  API_BODIES,
  API_ENUMS,
  API_OPERATIONS,
  API_PARAMS,
  API_SPEC_VERSION,
  type ApiBodyRow,
  type ApiOperationRow,
} from "./generated/operations.js";
import type { ApiOpInfo, AscOp } from "./ops/shared.js";

export { API_SPEC_VERSION };

export const API_OP_PREFIX = "appstore_api_";
/** `all: true` without maxItems stops after this many items. */
export const API_ALL_DEFAULT_MAX_ITEMS = 1000;
/** Highest maxItems accepted with `all`. */
export const API_ALL_MAX_ITEMS = 20_000;
/** Page cap for `all`, whatever maxItems says. */
export const API_ALL_MAX_PAGES = 100;

/** Query parameter families that also accept a grouped object form. */
const GROUPED = ["filter", "fields", "exists"] as const;

// ── Names and wording (mirrors scripts/generate-ops.mjs) ──────────

/** appstore_api_ + snake_case operationId. */
export function apiOpName(operationId: string): string {
  const snake = operationId
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
  return `${API_OP_PREFIX}${snake}`;
}

/** Apple's stock description for common query parameters (omitted from the table). */
export function standardParamDescription(name: string): string | undefined {
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

// ── Metadata ──────────────────────────────────────────────────

export interface ApiParam {
  name: string;
  in: "path" | "query";
  type: "string" | "string[]" | "integer" | "boolean";
  required: boolean;
  deprecated: boolean;
  enum?: readonly string[];
  maximum?: number;
  description: string;
}

export interface ApiBodyAttribute {
  name: string;
  type: string;
  required: boolean;
  nullable: boolean;
  deprecated: boolean;
  enum?: readonly string[];
}

export interface ApiBodyRelationship {
  name: string;
  /** Resource type of the related object(s). */
  type: string;
  toMany: boolean;
  required: boolean;
  nullable: boolean;
}

export interface ApiBodySummary {
  /** OpenAPI component name, e.g. AppStoreVersionCreateRequest. */
  schema: string;
  /** resource: data with attributes/relationships; linkage: one {type,id}; linkages: [{type,id}]. */
  kind: "resource" | "linkage" | "linkages";
  resourceType: string;
  idRequired: boolean;
  acceptsIncluded: boolean;
  attributesRequired: boolean;
  relationshipsRequired: boolean;
  attributes: ApiBodyAttribute[];
  relationships: ApiBodyRelationship[];
  /** Minimal body with the required members filled with placeholders. */
  example: unknown;
}

const TYPE_LABEL = { s: "string", "s[]": "string[]", i: "integer", b: "boolean" } as const;

function rowOf(op: AscOp): ApiOperationRow {
  const row = op.api ? API_OPERATIONS[op.api.index] : undefined;
  if (!row) throw new ValidationError(`${op.name} is not a generated API operation`);
  return row;
}

function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
}

function queryParams(row: ApiOperationRow): ApiParam[] {
  return row[6].map((i) => {
    const [name, type, enumIndex, flags, maximum, description] = API_PARAMS[i]!;
    const param: ApiParam = {
      name,
      in: "query",
      type: TYPE_LABEL[type],
      required: (flags & 1) === 1,
      deprecated: (flags & 2) === 2,
      description: description || standardParamDescription(name) || "",
    };
    if (enumIndex >= 0) param.enum = API_ENUMS[enumIndex];
    if (maximum) param.maximum = maximum;
    return param;
  });
}

/** Path and query parameters of a generated op. */
export function apiParams(op: AscOp): ApiParam[] {
  const row = rowOf(op);
  const path: ApiParam[] = pathParamNames(row[3]).map((name) => ({
    name,
    in: "path",
    type: "string",
    required: true,
    deprecated: false,
    description: name === "id" ? "the id of the requested resource" : `path parameter ${name}`,
  }));
  return [...path, ...queryParams(row)];
}

function placeholder(attr: ApiBodyAttribute): unknown {
  if (attr.enum?.length) return attr.type.endsWith("[]") ? [attr.enum[0]] : attr.enum[0];
  if (attr.type.endsWith("[]")) return [];
  if (attr.type === "boolean") return false;
  if (attr.type === "integer" || attr.type === "number") return 0;
  if (attr.type.startsWith("string (date")) return "2026-01-01T00:00:00Z";
  if (attr.type.startsWith("string")) return `<${attr.name}>`;
  return {};
}

function bodyExample(b: Omit<ApiBodySummary, "example">): unknown {
  const ident = (type: string) => ({ type, id: `<${type} id>` });
  if (b.kind === "linkages") return { data: [ident(b.resourceType)] };
  if (b.kind === "linkage") return { data: ident(b.resourceType) };
  const data: Record<string, unknown> = { type: b.resourceType };
  if (b.idRequired) data.id = "<id, same as the path id>";
  const attrs = b.attributes.filter((a) => a.required);
  const shown = attrs.length > 0 ? attrs : b.idRequired ? b.attributes.filter((a) => !a.deprecated).slice(0, 1) : [];
  if (shown.length > 0 || b.attributesRequired) {
    data.attributes = Object.fromEntries(shown.map((a) => [a.name, placeholder(a)]));
  }
  const rels = b.relationships.filter((r) => r.required);
  if (rels.length > 0) {
    data.relationships = Object.fromEntries(
      rels.map((r) => [r.name, { data: r.toMany ? [ident(r.type)] : ident(r.type) }]),
    );
  }
  return { data };
}

function bodySummary(row: ApiBodyRow): ApiBodySummary {
  const [schema, kind, resourceType, flags, attrs, rels] = row;
  const base = {
    schema,
    kind,
    resourceType,
    idRequired: (flags & 1) === 1,
    acceptsIncluded: (flags & 2) === 2,
    attributesRequired: (flags & 4) === 4,
    relationshipsRequired: (flags & 8) === 8,
    attributes: attrs.map(([name, type, f, enumIndex]) => {
      const a: ApiBodyAttribute = {
        name,
        type,
        required: (f & 1) === 1,
        nullable: (f & 2) === 2,
        deprecated: (f & 4) === 4,
      };
      if (enumIndex >= 0) a.enum = API_ENUMS[enumIndex];
      return a;
    }),
    relationships: rels.map(([name, type, f]) => ({
      name,
      type,
      required: (f & 1) === 1,
      toMany: (f & 2) === 2,
      nullable: (f & 4) === 4,
    })),
  };
  return { ...base, example: bodyExample(base) };
}

/** Request body summary of a generated op, if it takes a body. */
export function apiBody(op: AscOp): ApiBodySummary | undefined {
  const row = rowOf(op);
  const body = row[7] >= 0 ? API_BODIES[row[7]] : undefined;
  return body ? bodySummary(body) : undefined;
}

/** Non-JSON response type (reports, CSV exports), if any. */
export function apiAccept(op: AscOp): string | undefined {
  return rowOf(op)[8] || undefined;
}

/** GET collections with a page size: `all` / `maxItems` apply. */
export function apiPaginates(op: AscOp): boolean {
  const row = rowOf(op);
  return row[2] === "GET" && !row[8] && row[6].some((i) => API_PARAMS[i]![0] === "limit");
}

// ── Argument handling ─────────────────────────────────────────

const toList = (v: unknown) => {
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  if (typeof v === "number" || typeof v === "boolean") return [String(v)];
  if (Array.isArray(v)) return v.map((x) => (typeof x === "number" || typeof x === "boolean" ? String(x) : x));
  return v;
};
const toNumber = (v: unknown) => (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v);
const toBool = (v: unknown) => (v === "true" ? true : v === "false" ? false : v);
const toStr = (v: unknown) => (typeof v === "number" ? String(v) : v);

function paramSchema(p: ApiParam): ZodTypeAny {
  const values = p.enum as [string, ...string[]] | undefined;
  let schema: ZodTypeAny;
  switch (p.type) {
    case "string[]":
      schema = z.preprocess(toList, z.array(values ? z.enum(values) : z.string().min(1)).min(1));
      break;
    case "integer": {
      let n = z.number().int().min(1);
      if (p.maximum) n = n.max(p.maximum);
      schema = z.preprocess(toNumber, n);
      break;
    }
    case "boolean":
      schema = z.preprocess(toBool, z.boolean());
      break;
    default:
      schema = values ? z.enum(values) : z.preprocess(toStr, z.string().min(1));
  }
  return schema.describe(p.description);
}

interface Built {
  /** Lenient shape: grouped forms allowed, required query params checked after grouping. */
  shape: ZodRawShape;
  strict: z.ZodObject<ZodRawShape>;
  params: ApiParam[];
  allowed: Set<string>;
  grouped: Set<string>;
  paginates: boolean;
  body?: ApiBodySummary;
}

function build(op: AscOp): Built {
  const params = apiParams(op);
  const paginates = apiPaginates(op);
  const body = apiBody(op);
  const shape: ZodRawShape = {};
  const strict: ZodRawShape = {};
  for (const p of params) {
    if (p.in === "path") {
      const s = z.preprocess(toStr, z.string().min(1)).describe(p.description);
      shape[p.name] = s;
      strict[p.name] = s;
      continue;
    }
    const s = paramSchema(p);
    shape[p.name] = s.optional();
    strict[p.name] = p.required ? s : s.optional();
  }
  const grouped = new Set<string>();
  for (const family of GROUPED) {
    const members = params.filter((p) => p.name.startsWith(`${family}[`));
    if (members.length === 0) continue;
    grouped.add(family);
    const sample = members[0]!.name.slice(family.length + 1, -1);
    shape[family] = z
      .record(z.unknown())
      .optional()
      .describe(`Grouped form of the ${family}[...] parameters, e.g. {"${sample}": …}`);
  }
  if (body) {
    const b = z.record(z.unknown()).describe(`JSON:API request body (${body.schema}); see appstore_describe_operation`);
    shape.body = b;
    strict.body = b;
  }
  if (paginates) {
    const all = z.preprocess(toBool, z.boolean()).optional().describe("Follow pagination and return every page (capped)");
    const maxItems = z
      .preprocess(toNumber, z.number().int().min(1).max(API_ALL_MAX_ITEMS))
      .optional()
      .describe(`With all: stop after this many items (default ${API_ALL_DEFAULT_MAX_ITEMS}, max ${API_ALL_MAX_ITEMS})`);
    shape.all = all;
    shape.maxItems = maxItems;
    strict.all = all;
    strict.maxItems = maxItems;
  }
  const allowed = new Set([...Object.keys(strict), ...grouped]);
  return { shape, strict: z.object(strict), params, allowed, grouped, paginates, body };
}

/**
 * Encode one path parameter as a single safe segment. Rejects anything that
 * could change the path: "/", "\", "..", "?", "#" and control characters.
 */
export function encodePathParam(name: string, value: unknown): string {
  const v = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof v !== "string" || v.trim() === "") throw new ValidationError(`Path parameter "${name}" is required`);
  if (/[/\\?#\u0000-\u001f\u007f]/.test(v) || v.includes("..") || v === ".") {
    throw new ValidationError(
      `Invalid path parameter ${name}="${v}": it must be a single id without "/", "\\", "..", "?", "#" or control characters`,
    );
  }
  return encodeURIComponent(v);
}

/** Fill a path template; every {param} must be present and safe. */
export function fillPath(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => encodePathParam(name, args[name]));
}

/**
 * Merge grouped forms (`filter: {platform: "IOS"}`) into Apple's bracket
 * names (`filter[platform]`). Unknown keys and duplicates are errors.
 */
function normalizeArgs(op: AscOp, built: Built, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    if (built.grouped.has(key)) continue;
    out[key] = value;
  }
  for (const family of built.grouped) {
    const group = args[family];
    if (group === undefined || group === null) continue;
    if (typeof group !== "object" || Array.isArray(group)) {
      throw new ValidationError(`${op.name}: "${family}" must be an object such as {"name": value}`);
    }
    for (const [k, v] of Object.entries(group as Record<string, unknown>)) {
      const bracket = `${family}[${k}]`;
      if (!built.allowed.has(bracket)) {
        const known = built.params.filter((p) => p.name.startsWith(`${family}[`)).map((p) => p.name.slice(family.length + 1, -1));
        throw new ValidationError(`${op.name}: unknown ${family} "${k}". Known: ${known.join(", ")}`);
      }
      if (out[bracket] !== undefined) throw new ValidationError(`${op.name}: ${bracket} is given twice`);
      if (v !== undefined) out[bracket] = v;
    }
  }
  const unknown = Object.keys(out).filter((k) => !built.allowed.has(k));
  if (unknown.length > 0) {
    const valid = [...built.allowed];
    const shown = valid.slice(0, 40).join(", ") + (valid.length > 40 ? `, … (${valid.length - 40} more)` : "");
    throw new ValidationError(
      `Unknown argument${unknown.length > 1 ? "s" : ""} for ${op.name}: ${unknown.join(", ")}. Valid: ${shown}. See appstore_describe_operation.`,
    );
  }
  return out;
}

function prepareBody(op: AscOp, built: Built, args: Record<string, unknown>): unknown {
  const b = built.body;
  if (!b) return undefined;
  const raw = args.body;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("data" in raw)) {
    throw new ValidationError(`${op.name} needs body: a JSON:API document with a "data" member (${b.schema})`);
  }
  const doc = { ...(raw as Record<string, unknown>) };
  const data = doc.data;
  if (b.kind === "linkages") {
    if (!Array.isArray(data)) throw new ValidationError(`${op.name}: body.data must be an array of {type, id}`);
    return doc;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError(`${op.name}: body.data must be an object`);
  }
  const d = { ...(data as Record<string, unknown>) };
  if (b.resourceType) {
    if (d.type === undefined) d.type = b.resourceType;
    else if (d.type !== b.resourceType) {
      throw new ValidationError(`${op.name}: body.data.type must be "${b.resourceType}", got "${String(d.type)}"`);
    }
  }
  if (b.kind === "resource" && b.idRequired && d.id === undefined && typeof args.id === "string") d.id = args.id;
  doc.data = d;
  return doc;
}

interface PreparedCall {
  args: Record<string, unknown>;
  path: string;
  query: Query;
  body: unknown;
}

function prepare(op: AscOp, input: Record<string, unknown>): PreparedCall {
  const built = builtFor(op);
  const normalized = normalizeArgs(op, built, input);
  const parsed = built.strict.safeParse(normalized);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ");
    throw new ValidationError(`Invalid arguments for ${op.name}: ${issues}`, parsed.error.issues);
  }
  const args = parsed.data as Record<string, unknown>;
  const path = fillPath(op.api!.path, args);
  const query: Query = {};
  for (const p of built.params) {
    if (p.in === "query" && args[p.name] !== undefined) query[p.name] = args[p.name] as Query[string];
  }
  if ((args.all === true || args.maxItems !== undefined) && !built.paginates) {
    throw new ValidationError(`${op.name} is not a paginated collection`);
  }
  return { args, path, query, body: prepareBody(op, built, args) };
}

/**
 * Validate a generated op's arguments without calling Apple: grouped and
 * bracket query names, required parameters, enums, path ids and the body.
 */
export function validateApiArgs(op: AscOp, input: Record<string, unknown>): void {
  prepare(op, input);
}

async function runApiOp(op: AscOp, client: AppStoreConnectClient, input: Record<string, unknown>): Promise<unknown> {
  const info = op.api!;
  const row = rowOf(op);
  const built = builtFor(op);
  if (op.write) client.assertWritable(op.name);
  const { args, path, query, body } = prepare(op, input);
  const accept = row[8];

  if (args.all === true || args.maxItems !== undefined) {
    const limitParam = built.params.find((p) => p.name === "limit");
    if (query.limit === undefined) query.limit = Math.min(200, limitParam?.maximum ?? 200);
    const maxItems = Math.min((args.maxItems as number | undefined) ?? API_ALL_DEFAULT_MAX_ITEMS, API_ALL_MAX_ITEMS);
    return client.paginate(path, query, { maxItems, maxPages: API_ALL_MAX_PAGES });
  }
  if (accept === "application/a-gzip") {
    return (await client.download(path, query)).toString("utf8");
  }
  const result = await client.request(info.method, path, {
    query,
    body,
    accept: accept || undefined,
    operation: op.name,
  });
  return result ?? { ok: true, method: info.method, path };
}

const builtCache = new Map<string, Built>();
function builtFor(op: AscOp): Built {
  let b = builtCache.get(op.name);
  if (!b) {
    b = build(op);
    builtCache.set(op.name, b);
  }
  return b;
}

function makeOp(row: ApiOperationRow, index: number): AscOp {
  const [explicitName, operationId, method, path, summary, flags] = row;
  const api: ApiOpInfo = { operationId, method, path, deprecated: (flags & 1) === 1, index };
  const op: AscOp = {
    name: explicitName || apiOpName(operationId),
    group: path.split("/")[2] ?? "misc",
    summary,
    write: method !== "GET",
    get shape() {
      return builtFor(op).shape;
    },
    run: (client, args) => runApiOp(op, client, args),
    api,
  };
  return op;
}

/** One op per operation in Apple's OpenAPI spec. */
export const API_OPS: AscOp[] = API_OPERATIONS.map(makeOp);
