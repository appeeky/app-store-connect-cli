/**
 * Search and describe every operation: the curated ones (ASC_OPS) and the
 * ones generated from Apple's OpenAPI spec (API_OPS).
 */
import { z, type ZodTypeAny } from "zod";
import {
  API_ALL_DEFAULT_MAX_ITEMS,
  API_ALL_MAX_ITEMS,
  apiAccept,
  apiBody,
  apiParams,
  apiPaginates,
  type ApiBodySummary,
} from "./api-ops.js";
import { ValidationError } from "./errors.js";
import { ALL_OPS, getOp } from "./ops.js";
import type { AscOp } from "./ops/shared.js";

export type OperationKind = "curated" | "api";

export interface OperationSearchResult {
  name: string;
  kind: OperationKind;
  group: string;
  summary: string;
  /** HTTP method and path template (generated ops only). */
  method?: string;
  path?: string;
  write: boolean;
  deprecated?: boolean;
  /**
   * Argument names; optional ones end with "?". fields[…] and limit[…]
   * sparse-fieldset parameters are folded into one entry each.
   */
  params: string[];
}

export interface OperationParam {
  name: string;
  /** path / query for generated ops; arg for curated ops; body for the request body. */
  in: "path" | "query" | "body" | "arg";
  type: string;
  required: boolean;
  description: string;
  enum?: readonly string[];
  maximum?: number;
  deprecated?: boolean;
}

export interface OperationDescription {
  name: string;
  kind: OperationKind;
  group: string;
  summary: string;
  write: boolean;
  /** Write-ness depends on the arguments (appstore_request). */
  writeDependsOnArgs?: boolean;
  operationId?: string;
  method?: string;
  path?: string;
  deprecated?: boolean;
  /** Response type when it is not JSON (reports, CSV). */
  responseType?: string;
  params: OperationParam[];
  /** Grouped alternatives to bracket names, e.g. filter → filter[platform]. */
  groupedParams?: string[];
  pagination?: { maxItemsDefault: number; maxItemsMax: number };
  body?: ApiBodySummary;
}

export interface SearchOptions {
  /** Ops to search (default: curated + generated). */
  ops?: readonly AscOp[];
  group?: string;
  method?: string;
  kind?: OperationKind;
  limit?: number;
}

const kindOf = (op: AscOp): OperationKind => (op.api ? "api" : "curated");

function unwrap(schema: ZodTypeAny): ZodTypeAny {
  let s = schema;
  for (let i = 0; i < 10; i++) {
    if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) s = s.unwrap();
    else if (s instanceof z.ZodDefault) s = s._def.innerType;
    else if (s instanceof z.ZodEffects) s = s.innerType();
    else break;
  }
  return s;
}

function zodLabel(schema: ZodTypeAny): { type: string; enum?: readonly string[] } {
  const s = unwrap(schema);
  if (s instanceof z.ZodString) return { type: "string" };
  if (s instanceof z.ZodNumber) return { type: "number" };
  if (s instanceof z.ZodBoolean) return { type: "boolean" };
  if (s instanceof z.ZodEnum) return { type: "enum", enum: s.options as string[] };
  if (s instanceof z.ZodArray) {
    const inner = zodLabel(s.element);
    return { type: `${inner.type}[]`, ...(inner.enum ? { enum: inner.enum } : {}) };
  }
  if (s instanceof z.ZodUnion) {
    return { type: (s.options as ZodTypeAny[]).map((o) => zodLabel(o).type).join(" | ") };
  }
  if (s instanceof z.ZodRecord || s instanceof z.ZodObject) return { type: "object" };
  return { type: "unknown" };
}

function paramNames(op: AscOp): string[] {
  if (!op.api) return Object.entries(op.shape).map(([k, s]) => (s.isOptional() ? `${k}?` : k));
  const out: string[] = [];
  let fields = 0;
  let limits = 0;
  for (const p of apiParams(op)) {
    if (p.name.startsWith("fields[")) fields++;
    else if (p.name.startsWith("limit[")) limits++;
    else out.push(p.required ? p.name : `${p.name}?`);
  }
  if (fields) out.push(`fields[…]? (${fields})`);
  if (limits) out.push(`limit[…]? (${limits})`);
  if (apiBody(op)) out.push("body");
  if (apiPaginates(op)) out.push("all?", "maxItems?");
  return out;
}

export function toSearchResult(op: AscOp): OperationSearchResult {
  const result: OperationSearchResult = {
    name: op.name,
    kind: kindOf(op),
    group: op.group,
    summary: op.summary,
    write: op.write,
    params: paramNames(op),
  };
  if (op.api) {
    result.method = op.api.method;
    result.path = op.api.path;
    if (op.api.deprecated) result.deprecated = true;
  }
  return result;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

const STOP_WORDS = new Set(["a", "an", "the", "of", "for", "to", "and", "in", "on", "by", "with", "my"]);

/** Common words that differ from Apple's resource names. */
const SYNONYMS: Record<string, string> = {
  testflight: "beta",
  iap: "inapppurchase",
  iaps: "inapppurchase",
  xcodecloud: "ci",
  screenshot: "screenshots",
  preview: "previews",
};

/**
 * Higher is better; 0 when fewer than `need` tokens match anywhere in the
 * name, group, path or summary.
 */
function score(op: AscOp, tokens: string[], phrase: string, need: number): number {
  const name = squash(op.name.replace(/^appstore_(api_)?/, ""));
  const path = squash(op.api?.path ?? "");
  const summary = squash(op.summary);
  const group = squash(op.group);
  // The whole query naming the resource family or the start of the name wins.
  let total = group === phrase ? 12 : name.startsWith(phrase) ? 8 : name.includes(phrase) ? 4 : 0;
  let matched = 0;
  for (const t of tokens) {
    let s = 0;
    if (name.includes(t)) s += 3;
    if (group === t) s += 2;
    else if (group.includes(t)) s += 1;
    if (path.includes(t)) s += 2;
    if (summary.includes(t)) s += 2;
    if (s > 0) matched++;
    total += s;
  }
  if (matched < need) return 0;
  // Prefer curated ops and short, specific names.
  if (!op.api) total += 2;
  if (op.api?.deprecated) total -= 2;
  return total - op.name.length / 40;
}

/**
 * Search operations by words in the name, group, path and summary. Every
 * word must match somewhere; when nothing matches every word, results that
 * match most of them are returned. Ranked, curated ops first on ties.
 */
export function searchOperations(query = "", options: SearchOptions = {}): OperationSearchResult[] {
  let ops = options.ops ?? ALL_OPS;
  if (options.group) {
    const g = options.group.toLowerCase();
    ops = ops.filter((op) => op.group.toLowerCase() === g);
  }
  if (options.method) {
    const m = options.method.toUpperCase();
    ops = ops.filter((op) => op.api?.method === m);
  }
  if (options.kind) ops = ops.filter((op) => kindOf(op) === options.kind);
  const tokens = query
    .toLowerCase()
    .split(/[\s,]+/)
    .map(squash)
    .filter((t) => t && !STOP_WORDS.has(t))
    .map((t) => SYNONYMS[t] ?? t);
  const rank = (need: number) =>
    ops
      .map((op) => ({ op, s: score(op, tokens, tokens.join(""), need) }))
      .filter((h) => h.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((h) => h.op);
  let hits: AscOp[];
  if (tokens.length === 0) hits = [...ops];
  else {
    hits = rank(tokens.length);
    if (hits.length === 0 && tokens.length > 1) hits = rank(Math.ceil(tokens.length / 2));
  }
  if (options.limit !== undefined) hits = hits.slice(0, options.limit);
  return hits.map(toSearchResult);
}

/**
 * Full parameter information for one operation, plus the request body
 * summary (required attributes and relationships with types) for generated
 * ops that take a body.
 */
export function describeOperation(name: string, options: { ops?: readonly AscOp[] } = {}): OperationDescription {
  const op = options.ops ? options.ops.find((o) => o.name === name) : getOp(name);
  if (!op) throw new ValidationError(`Unknown operation: ${name}`);
  const base = {
    name: op.name,
    kind: kindOf(op),
    group: op.group,
    summary: op.summary,
    write: op.write,
  };
  if (!op.api) {
    return {
      ...base,
      ...(op.isWrite ? { writeDependsOnArgs: true } : {}),
      params: Object.entries(op.shape).map(([key, schema]) => {
        const label = zodLabel(schema);
        return {
          name: key,
          in: "arg" as const,
          type: label.type,
          required: !schema.isOptional(),
          description: schema.description ?? "",
          ...(label.enum ? { enum: label.enum } : {}),
        };
      }),
    };
  }
  const params: OperationParam[] = apiParams(op).map((p) => ({
    name: p.name,
    in: p.in,
    type: p.type,
    required: p.required,
    description: p.description,
    ...(p.enum ? { enum: p.enum } : {}),
    ...(p.maximum ? { maximum: p.maximum } : {}),
    ...(p.deprecated ? { deprecated: true } : {}),
  }));
  const body = apiBody(op);
  if (body) {
    params.push({
      name: "body",
      in: "body",
      type: "object",
      required: true,
      description: `JSON:API request document (${body.schema}); data.type${body.idRequired && body.kind === "resource" ? " and data.id" : ""} are filled in when missing`,
    });
  }
  const paginates = apiPaginates(op);
  if (paginates) {
    params.push(
      { name: "all", in: "arg", type: "boolean", required: false, description: "Follow pagination and return every page (capped)" },
      {
        name: "maxItems",
        in: "arg",
        type: "integer",
        required: false,
        description: `With all: stop after this many items (default ${API_ALL_DEFAULT_MAX_ITEMS}, max ${API_ALL_MAX_ITEMS})`,
        maximum: API_ALL_MAX_ITEMS,
      },
    );
  }
  const grouped = ["filter", "fields", "exists"].filter((f) => params.some((p) => p.name.startsWith(`${f}[`)));
  const desc: OperationDescription = {
    ...base,
    operationId: op.api.operationId,
    method: op.api.method,
    path: op.api.path,
    params,
  };
  if (op.api.deprecated) desc.deprecated = true;
  const accept = apiAccept(op);
  if (accept) desc.responseType = accept;
  if (grouped.length) desc.groupedParams = grouped;
  if (paginates) desc.pagination = { maxItemsDefault: API_ALL_DEFAULT_MAX_ITEMS, maxItemsMax: API_ALL_MAX_ITEMS };
  if (body) desc.body = body;
  return desc;
}
