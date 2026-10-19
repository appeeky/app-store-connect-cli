import { z } from "zod";
import { assertApiPath, type HttpMethod } from "../client.js";
import type { Query } from "../jsonapi.js";
import { str, type AscOp } from "./shared.js";

const methods = ["GET", "POST", "PATCH", "DELETE"] as const;

export const META_OPS: AscOp[] = [
  {
    name: "appstore_whoami",
    group: "meta",
    summary: "Show which API key is in use (key id, issuer, team or individual) and read-only mode",
    write: false,
    shape: {},
    run: async (c) => c.whoami(),
  },
  {
    name: "appstore_request",
    group: "meta",
    summary: "Call any App Store Connect endpoint (method, path under /v1 or /v2…, query, JSON body). Non-GET counts as a write",
    write: true,
    isWrite: (a) => String(a.method ?? "GET").toUpperCase() !== "GET",
    shape: {
      method: z.enum(methods).default("GET"),
      path: z.string().min(1).describe("API path, e.g. /v1/apps/123/appStoreVersions"),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
        .optional()
        .describe('Query parameters, e.g. {"filter[platform]": "IOS", "limit": 50}'),
      body: z.unknown().optional().describe("JSON:API request body"),
      all: z.boolean().optional().describe("GET only: follow links.next and return every page"),
      maxItems: z.number().int().min(1).optional(),
    },
    run: async (c, a) => {
      const method = String(a.method ?? "GET").toUpperCase() as HttpMethod;
      const path = str(a.path, "path");
      assertApiPath(path.split("?")[0] ?? path);
      const query = a.query as Query | undefined;
      if (method === "GET" && (a.all || a.maxItems)) {
        return c.paginate(path, query, { maxItems: a.maxItems as number | undefined });
      }
      const result = await c.request(method, path, { query, body: a.body });
      return result ?? { ok: true, method, path };
    },
  },
];
