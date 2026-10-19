import { z, type ZodRawShape } from "zod";
import type { AppStoreConnectClient } from "../client.js";
import { ValidationError } from "../errors.js";

export interface AscOp {
  /** Stable id, also the MCP tool name, e.g. appstore_list_apps. */
  name: string;
  group: string;
  summary: string;
  /** Whether the op changes App Store Connect (or local config). */
  write: boolean;
  /**
   * For ops whose effect depends on the arguments (appstore_request): decides
   * per call. Read-only clients still refuse every non-GET request.
   */
  isWrite?: (args: Record<string, unknown>) => boolean;
  shape: ZodRawShape;
  run: (client: AppStoreConnectClient, args: Record<string, unknown>) => Promise<unknown>;
}

/** Does this call change anything? */
export function opIsWrite(op: AscOp, args: Record<string, unknown> = {}): boolean {
  return op.isWrite ? op.isWrite(args) : op.write;
}

// ── Shared argument schemas ────────────────────────────────────
export const appId = z.string().min(1).describe("Apple app id (digits), e.g. 1234567890");
export const id = (what: string) => z.string().min(1).describe(`${what} id`);
export const ids = (what: string) => z.array(z.string().min(1)).min(1).describe(`${what} ids`);
export const locale = z.string().min(2).describe("Locale code, e.g. en-US, de-DE, ja");
export const platform = z.enum(["IOS", "MAC_OS", "TV_OS", "VISION_OS"]).describe("App platform");
export const strOrArr = z.union([z.string(), z.array(z.string())]);

export const page = {
  limit: z.number().int().min(1).max(200).optional().describe("Page size (max 200)"),
  all: z.boolean().optional().describe("Follow pagination and return every page"),
  maxItems: z.number().int().min(1).optional().describe("With all: stop after this many items"),
};

export function pageOpts(a: Record<string, unknown>): { limit?: number; all?: boolean; maxItems?: number } {
  return {
    limit: a.limit as number | undefined,
    all: a.all as boolean | undefined,
    maxItems: a.maxItems as number | undefined,
  };
}

export function str(v: unknown, name: string): string {
  if (typeof v !== "string" || !v) throw new ValidationError(`${name} is required`);
  return v;
}

export function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

export function strList(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || v.length === 0) throw new ValidationError(`${name} must be a non-empty array`);
  return v.map((x) => String(x));
}

/** Pick the listed keys from args, keeping only defined values. */
export function pick<T extends Record<string, unknown>>(a: Record<string, unknown>, keys: readonly string[]): T {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (a[k] !== undefined) out[k] = a[k];
  return out as T;
}

export function requireSome(obj: Record<string, unknown>, what: string): void {
  if (Object.keys(obj).length === 0) throw new ValidationError(`Pass at least one ${what} to change`);
}
