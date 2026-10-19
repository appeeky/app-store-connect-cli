import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import type { AppStoreConnectClient } from "../client.js";
import { AscError, ValidationError } from "../errors.js";
import { enc, listQuery, relMany, relOne, type JsonApiDocument, type ListOptions, type Resource } from "../jsonapi.js";
import type { PreviewType, Schemas, ScreenshotDisplayType, UploadOperation } from "../types.js";

export type MediaKind = "screenshot" | "preview";

const KIND = {
  screenshot: { set: "appScreenshotSets", item: "appScreenshots", setRel: "appScreenshotSet" },
  preview: { set: "appPreviewSets", item: "appPreviews", setRel: "appPreviewSet" },
} as const;

const PREVIEW_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
};

export interface UploadResult {
  id: string;
  kind: MediaKind;
  fileName: string;
  fileSize: number;
  checksum: string;
  parts: number;
  assetDeliveryState?: unknown;
}

/**
 * PUT each part of a file to the URLs Apple reserved for it. Parts are sent
 * a few at a time; the App Store Connect token is never attached.
 */
export async function uploadParts(
  client: AppStoreConnectClient,
  operations: UploadOperation[],
  bytes: Uint8Array,
  concurrency = 4,
): Promise<void> {
  const queue = [...operations];
  const worker = async () => {
    for (let op = queue.shift(); op; op = queue.shift()) {
      if (!op.url || op.offset === undefined || op.length === undefined) {
        throw new AscError("Apple returned an incomplete upload operation", { details: op });
      }
      const headers: Record<string, string> = {};
      for (const h of op.requestHeaders ?? []) {
        if (h.name && h.value !== undefined) headers[h.name] = h.value;
      }
      const chunk = bytes.subarray(op.offset, op.offset + op.length);
      await client.fetchExternal(op.url, {
        method: op.method ?? "PUT",
        headers,
        body: chunk,
        idempotent: true,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, operations.length)) }, worker));
}

export class MediaApi {
  constructor(private readonly client: AppStoreConnectClient) {}

  // ── Sets ─────────────────────────────────────────────────────
  listScreenshotSets(localizationId: string, options: ListOptions & { displayType?: ScreenshotDisplayType[] } = {}) {
    return this.client.list(
      `/v1/appStoreVersionLocalizations/${enc(localizationId)}/appScreenshotSets`,
      listQuery({ include: ["appScreenshots"], ...options }, { screenshotDisplayType: options.displayType }),
      options,
    );
  }

  createScreenshotSet(localizationId: string, displayType: ScreenshotDisplayType) {
    const body: Schemas["AppScreenshotSetCreateRequest"] = {
      data: {
        type: "appScreenshotSets",
        attributes: { screenshotDisplayType: displayType },
        relationships: { appStoreVersionLocalization: relOne("appStoreVersionLocalizations", localizationId) },
      },
    };
    return this.client.post<JsonApiDocument<Resource>>("/v1/appScreenshotSets", body, "appScreenshotSets.create");
  }

  listPreviewSets(localizationId: string, options: ListOptions & { previewType?: PreviewType[] } = {}) {
    return this.client.list(
      `/v1/appStoreVersionLocalizations/${enc(localizationId)}/appPreviewSets`,
      listQuery({ include: ["appPreviews"], ...options }, { previewType: options.previewType }),
      options,
    );
  }

  createPreviewSet(localizationId: string, previewType: PreviewType) {
    const body: Schemas["AppPreviewSetCreateRequest"] = {
      data: {
        type: "appPreviewSets",
        attributes: { previewType },
        relationships: { appStoreVersionLocalization: relOne("appStoreVersionLocalizations", localizationId) },
      },
    };
    return this.client.post<JsonApiDocument<Resource>>("/v1/appPreviewSets", body, "appPreviewSets.create");
  }

  deleteSet(kind: MediaKind, setId: string) {
    return this.client.delete(`/v1/${KIND[kind].set}/${enc(setId)}`, undefined, `${KIND[kind].set}.delete`);
  }

  // ── Items ────────────────────────────────────────────────────
  listItems(kind: MediaKind, setId: string, options: ListOptions = {}) {
    return this.client.list(`/v1/${KIND[kind].set}/${enc(setId)}/${KIND[kind].item}`, listQuery(options), options);
  }

  getItem(kind: MediaKind, id: string) {
    return this.client.get<JsonApiDocument<Resource>>(`/v1/${KIND[kind].item}/${enc(id)}`);
  }

  deleteItem(kind: MediaKind, id: string) {
    return this.client.delete(`/v1/${KIND[kind].item}/${enc(id)}`, undefined, `${KIND[kind].item}.delete`);
  }

  /** Set the display order of a set: `ids` in the order they should appear. */
  reorder(kind: MediaKind, setId: string, ids: string[]) {
    if (!ids.length) throw new ValidationError("Pass the ids in their new order");
    const body = relMany(KIND[kind].item, ids);
    return this.client.patch(
      `/v1/${KIND[kind].set}/${enc(setId)}/relationships/${KIND[kind].item}`,
      body,
      `${KIND[kind].set}.reorder`,
    );
  }

  /**
   * Upload a local screenshot or preview into a set:
   * reserve (POST with name and size) → PUT each part → commit with the MD5
   * checksum. With `wait`, poll until Apple finishes processing.
   */
  async upload(
    kind: MediaKind,
    setId: string,
    filePath: string,
    options: { wait?: boolean; timeoutMs?: number; pollMs?: number; previewFrameTimeCode?: string; mimeType?: string } = {},
  ): Promise<UploadResult> {
    this.client.assertWritable(`${KIND[kind].item}.upload`);
    const stat = statSync(filePath);
    if (!stat.isFile()) throw new ValidationError(`Not a file: ${filePath}`);
    const bytes = readFileSync(filePath);
    const fileName = basename(filePath);
    const checksum = createHash("md5").update(bytes).digest("hex");

    let reserveBody: unknown;
    if (kind === "screenshot") {
      reserveBody = {
        data: {
          type: "appScreenshots",
          attributes: { fileName, fileSize: bytes.length },
          relationships: { appScreenshotSet: relOne("appScreenshotSets", setId) },
        },
      } satisfies Schemas["AppScreenshotCreateRequest"];
    } else {
      const mimeType = options.mimeType ?? PREVIEW_MIME[extname(fileName).toLowerCase()];
      reserveBody = {
        data: {
          type: "appPreviews",
          attributes: {
            fileName,
            fileSize: bytes.length,
            ...(mimeType ? { mimeType } : {}),
            ...(options.previewFrameTimeCode ? { previewFrameTimeCode: options.previewFrameTimeCode } : {}),
          },
          relationships: { appPreviewSet: relOne("appPreviewSets", setId) },
        },
      } satisfies Schemas["AppPreviewCreateRequest"];
    }

    const reserved = await this.client.post<JsonApiDocument<Resource>>(
      `/v1/${KIND[kind].item}`,
      reserveBody,
      `${KIND[kind].item}.create`,
    );
    const id = reserved.data.id;
    const operations = (reserved.data.attributes?.uploadOperations ?? []) as UploadOperation[];
    if (!operations.length) throw new AscError("Apple returned no upload operations for this file", { details: reserved });

    await uploadParts(this.client, operations, bytes);

    const commitBody = {
      data: { type: KIND[kind].item, id, attributes: { uploaded: true, sourceFileChecksum: checksum } },
    };
    await this.client.patch(`/v1/${KIND[kind].item}/${enc(id)}`, commitBody, `${KIND[kind].item}.commit`);

    const result: UploadResult = { id, kind, fileName, fileSize: bytes.length, checksum, parts: operations.length };
    if (options.wait) {
      result.assetDeliveryState = await this.waitForProcessing(kind, id, options.timeoutMs, options.pollMs);
    }
    return result;
  }

  /** Poll an uploaded asset until Apple reports COMPLETE or FAILED. */
  async waitForProcessing(kind: MediaKind, id: string, timeoutMs = 5 * 60_000, pollMs = 3_000): Promise<unknown> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const doc = await this.getItem(kind, id);
      const state = doc.data.attributes?.assetDeliveryState as { state?: string; errors?: unknown[] } | undefined;
      if (state?.state === "COMPLETE") return state;
      if (state?.state === "FAILED") {
        throw new AscError(`Apple could not process ${id}: ${JSON.stringify(state.errors ?? [])}`, { details: state });
      }
      if (Date.now() >= deadline) return state;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}
