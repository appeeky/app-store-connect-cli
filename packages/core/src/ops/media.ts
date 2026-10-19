import { z } from "zod";
import type { MediaKind } from "../resources/media.js";
import type { PreviewType, ScreenshotDisplayType } from "../types.js";
import { id, ids, page, pageOpts, str, strList, type AscOp } from "./shared.js";

const localizationId = id("Version localization");
const kind = z.enum(["screenshot", "preview"]).describe("screenshot or preview");

export const MEDIA_OPS: AscOp[] = [
  {
    name: "appstore_list_screenshot_sets",
    group: "media",
    summary: "List screenshot sets (one per display type) of a version localization",
    write: false,
    shape: { localizationId, ...page },
    run: (c, a) => c.media.listScreenshotSets(str(a.localizationId, "localizationId"), pageOpts(a)),
  },
  {
    name: "appstore_create_screenshot_set",
    group: "media",
    summary: "Create a screenshot set for a display type, e.g. APP_IPHONE_67",
    write: true,
    shape: { localizationId, displayType: z.string().min(1).describe("ScreenshotDisplayType, e.g. APP_IPHONE_67, APP_IPAD_PRO_3GEN_129") },
    run: (c, a) =>
      c.media.createScreenshotSet(str(a.localizationId, "localizationId"), a.displayType as ScreenshotDisplayType),
  },
  {
    name: "appstore_list_screenshots",
    group: "media",
    summary: "List screenshots in a set, in display order",
    write: false,
    shape: { setId: id("Screenshot set"), ...page },
    run: (c, a) => c.media.listItems("screenshot", str(a.setId, "setId"), pageOpts(a)),
  },
  {
    name: "appstore_list_preview_sets",
    group: "media",
    summary: "List app preview sets of a version localization",
    write: false,
    shape: { localizationId, ...page },
    run: (c, a) => c.media.listPreviewSets(str(a.localizationId, "localizationId"), pageOpts(a)),
  },
  {
    name: "appstore_create_preview_set",
    group: "media",
    summary: "Create an app preview set for a preview type, e.g. IPHONE_67",
    write: true,
    shape: { localizationId, previewType: z.string().min(1).describe("PreviewType, e.g. IPHONE_67, IPAD_PRO_3GEN_129") },
    run: (c, a) => c.media.createPreviewSet(str(a.localizationId, "localizationId"), a.previewType as PreviewType),
  },
  {
    name: "appstore_list_previews",
    group: "media",
    summary: "List app previews in a set, in display order",
    write: false,
    shape: { setId: id("Preview set"), ...page },
    run: (c, a) => c.media.listItems("preview", str(a.setId, "setId"), pageOpts(a)),
  },
  {
    name: "appstore_get_media_asset",
    group: "media",
    summary: "Get a screenshot or preview with its processing state",
    write: false,
    shape: { kind, assetId: id("Screenshot or preview") },
    run: (c, a) => c.media.getItem(a.kind as MediaKind, str(a.assetId, "assetId")),
  },
  {
    name: "appstore_delete_media_asset",
    group: "media",
    summary: "Delete a screenshot or preview",
    write: true,
    shape: { kind, assetId: id("Screenshot or preview") },
    run: (c, a) => c.media.deleteItem(a.kind as MediaKind, str(a.assetId, "assetId")),
  },
  {
    name: "appstore_delete_media_set",
    group: "media",
    summary: "Delete a whole screenshot or preview set",
    write: true,
    shape: { kind, setId: id("Screenshot or preview set") },
    run: (c, a) => c.media.deleteSet(a.kind as MediaKind, str(a.setId, "setId")),
  },
  {
    name: "appstore_reorder_media",
    group: "media",
    summary: "Reorder screenshots or previews in a set (ids in their new order)",
    write: true,
    shape: { kind, setId: id("Screenshot or preview set"), assetIds: ids("Screenshot or preview") },
    run: (c, a) => c.media.reorder(a.kind as MediaKind, str(a.setId, "setId"), strList(a.assetIds, "assetIds")),
  },
  {
    name: "appstore_upload_screenshot",
    group: "media",
    summary: "Upload a local image into a screenshot set (reserve, upload parts, commit)",
    write: true,
    shape: {
      setId: id("Screenshot set"),
      filePath: z.string().min(1).describe("Local PNG or JPEG"),
      wait: z.boolean().optional().describe("Wait until Apple finishes processing"),
    },
    run: (c, a) =>
      c.media.upload("screenshot", str(a.setId, "setId"), str(a.filePath, "filePath"), { wait: a.wait as boolean | undefined }),
  },
  {
    name: "appstore_upload_preview",
    group: "media",
    summary: "Upload a local video into an app preview set (reserve, upload parts, commit)",
    write: true,
    shape: {
      setId: id("Preview set"),
      filePath: z.string().min(1).describe("Local .mov, .m4v or .mp4"),
      previewFrameTimeCode: z.string().optional().describe("Poster frame, e.g. 00:00:05:00"),
      wait: z.boolean().optional(),
    },
    run: (c, a) =>
      c.media.upload("preview", str(a.setId, "setId"), str(a.filePath, "filePath"), {
        wait: a.wait as boolean | undefined,
        previewFrameTimeCode: a.previewFrameTimeCode as string | undefined,
      }),
  },
];
