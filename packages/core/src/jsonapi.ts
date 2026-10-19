import { ValidationError } from "./errors.js";

/**
 * Small JSON:API helpers for App Store Connect request and response documents.
 */

export type QueryValue = string | number | boolean | ReadonlyArray<string | number> | undefined | null;
export type Query = Record<string, QueryValue>;

export interface ResourceIdentifier<T extends string = string> {
  type: T;
  id: string;
}

export interface Resource<T extends string = string> extends ResourceIdentifier<T> {
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  links?: Record<string, unknown>;
}

export interface JsonApiDocument<D = Resource | Resource[] | null> {
  data: D;
  included?: Resource[];
  links?: { self?: string; next?: string; first?: string };
  meta?: { paging?: { total?: number; limit?: number; nextCursor?: string }; [key: string]: unknown };
}

/** A paginated list collected across pages. */
export interface CollectedList<T = Resource> {
  data: T[];
  included: Resource[];
  meta: { total?: number; pages: number; truncated: boolean };
}

/**
 * Serialize query parameters the way App Store Connect expects:
 * arrays become comma-separated, undefined/null are dropped, brackets kept.
 */
export function buildQuery(query: Query = {}): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    const str = Array.isArray(value) ? value.join(",") : String(value);
    if (str === "") continue;
    parts.push(`${encodeURIComponent(key).replace(/%5B/g, "[").replace(/%5D/g, "]")}=${encodeURIComponent(str)}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export function relOne<T extends string>(type: T, id: string): { data: { type: T; id: string } } {
  return { data: { type, id } };
}

export function relMany<T extends string>(type: T, ids: readonly string[]): { data: Array<{ type: T; id: string }> } {
  return { data: ids.map((id) => ({ type, id })) };
}

/** Drop keys whose value is undefined (JSON:API PATCH sends only changed attributes). */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

export interface ListOptions {
  /** Page size (Apple max is usually 200). */
  limit?: number;
  /** Follow `links.next` and return every page. */
  all?: boolean;
  /** Stop after this many items when `all` is set. */
  maxItems?: number;
  include?: string[];
  sort?: string;
  /** Extra filters, keyed without the `filter[...]` wrapper. */
  filter?: Record<string, QueryValue>;
  /** Sparse fieldsets, keyed by resource type. */
  fields?: Record<string, string[]>;
  /** Raw extra query parameters. */
  query?: Query;
}

export function listQuery(options: ListOptions = {}, filters: Record<string, QueryValue> = {}): Query {
  const query: Query = { ...(options.query ?? {}) };
  if (options.limit !== undefined) query.limit = options.limit;
  if (options.include?.length) query.include = options.include;
  if (options.sort) query.sort = options.sort;
  for (const [k, v] of Object.entries({ ...filters, ...(options.filter ?? {}) })) {
    if (v !== undefined && v !== null && v !== "") query[`filter[${k}]`] = v;
  }
  for (const [type, names] of Object.entries(options.fields ?? {})) {
    if (names.length) query[`fields[${type}]`] = names;
  }
  return query;
}

/** Find an included resource by type and id. */
export function findIncluded(doc: { included?: Resource[] }, type: string, id: string | undefined): Resource | undefined {
  if (!id) return undefined;
  return doc.included?.find((r) => r.type === type && r.id === id);
}

/** Read a to-one relationship id from a resource. */
export function relId(resource: Resource | undefined, name: string): string | undefined {
  const rel = resource?.relationships?.[name] as { data?: { id?: string } | null } | undefined;
  return rel?.data?.id ?? undefined;
}

/** Encode one path segment (a resource id). */
export function enc(id: string): string {
  if (!id || typeof id !== "string") throw new ValidationError("A resource id is required");
  return encodeURIComponent(id);
}
