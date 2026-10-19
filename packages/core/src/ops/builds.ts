import { z } from "zod";
import type { Platform } from "../types.js";
import { appId, id, locale, page, pageOpts, pick, platform, requireSome, str, strOrArr, type AscOp } from "./shared.js";

const buildId = id("Build");

export const BUILD_OPS: AscOp[] = [
  {
    name: "appstore_list_builds",
    group: "builds",
    summary: "List builds of an app, newest first (filter by version, build number, processing state)",
    write: false,
    shape: {
      appId,
      marketingVersion: strOrArr.optional().describe("CFBundleShortVersionString, e.g. 2.4.0"),
      buildNumber: strOrArr.optional().describe("CFBundleVersion, e.g. 412"),
      platform: platform.optional(),
      processingState: strOrArr.optional().describe("PROCESSING, FAILED, INVALID, VALID"),
      expired: z.boolean().optional(),
      ...page,
    },
    run: (c, a) =>
      c.builds.list(str(a.appId, "appId"), {
        ...pageOpts(a),
        marketingVersion: a.marketingVersion as string | undefined,
        buildNumber: a.buildNumber as string | undefined,
        platform: a.platform as Platform | undefined,
        processingState: a.processingState as string | undefined,
        expired: a.expired as boolean | undefined,
      }),
  },
  {
    name: "appstore_get_build",
    group: "builds",
    summary: "Get a build with its pre-release version, beta detail and beta review state",
    write: false,
    shape: { buildId },
    run: (c, a) => c.builds.get(str(a.buildId, "buildId")),
  },
  {
    name: "appstore_get_latest_build",
    group: "builds",
    summary: "Get the newest uploaded build of an app (optionally for a version/platform)",
    write: false,
    shape: { appId, marketingVersion: z.string().optional(), platform: platform.optional() },
    run: async (c, a) =>
      (await c.builds.latest(str(a.appId, "appId"), {
        marketingVersion: a.marketingVersion as string | undefined,
        platform: a.platform as Platform | undefined,
      })) ?? { found: false },
  },
  {
    name: "appstore_get_build_processing_state",
    group: "builds",
    summary: "Get a build's processing state, expiry and encryption flag",
    write: false,
    shape: { buildId },
    run: (c, a) => c.builds.processingState(str(a.buildId, "buildId")),
  },
  {
    name: "appstore_update_build",
    group: "builds",
    summary: "Set export compliance (usesNonExemptEncryption) or expire a build",
    write: true,
    shape: { buildId, usesNonExemptEncryption: z.boolean().optional(), expired: z.boolean().optional() },
    run: (c, a) => {
      const attrs = pick<{ expired?: boolean; usesNonExemptEncryption?: boolean }>(a, [
        "expired",
        "usesNonExemptEncryption",
      ]);
      requireSome(attrs, "field");
      return c.builds.update(str(a.buildId, "buildId"), attrs);
    },
  },
  {
    name: "appstore_expire_build",
    group: "builds",
    summary: "Expire a build so testers can no longer install it",
    write: true,
    shape: { buildId },
    run: (c, a) => c.builds.expire(str(a.buildId, "buildId")),
  },
  {
    name: "appstore_get_build_beta_detail",
    group: "builds",
    summary: "Get TestFlight beta details of a build (internal/external state, auto-notify)",
    write: false,
    shape: { buildId },
    run: (c, a) => c.builds.getBetaDetail(str(a.buildId, "buildId")),
  },
  {
    name: "appstore_update_build_beta_detail",
    group: "builds",
    summary: "Turn automatic tester notification on or off for a build",
    write: true,
    shape: { buildBetaDetailId: id("Build beta detail"), autoNotifyEnabled: z.boolean() },
    run: (c, a) =>
      c.builds.updateBetaDetail(str(a.buildBetaDetailId, "buildBetaDetailId"), {
        autoNotifyEnabled: a.autoNotifyEnabled as boolean,
      }),
  },
  {
    name: "appstore_list_beta_build_localizations",
    group: "builds",
    summary: "List 'What to Test' notes of a build per locale",
    write: false,
    shape: { buildId, ...page },
    run: (c, a) => c.builds.listBetaLocalizations(str(a.buildId, "buildId"), pageOpts(a)),
  },
  {
    name: "appstore_create_beta_build_localization",
    group: "builds",
    summary: "Add 'What to Test' notes to a build for a locale",
    write: true,
    shape: { buildId, locale, whatsNew: z.string().max(4000).optional() },
    run: (c, a) =>
      c.builds.createBetaLocalization(str(a.buildId, "buildId"), str(a.locale, "locale"), a.whatsNew as string | undefined),
  },
  {
    name: "appstore_update_beta_build_localization",
    group: "builds",
    summary: "Update 'What to Test' notes",
    write: true,
    shape: { localizationId: id("Beta build localization"), whatsNew: z.string().max(4000) },
    run: (c, a) => c.builds.updateBetaLocalization(str(a.localizationId, "localizationId"), str(a.whatsNew, "whatsNew")),
  },
  {
    name: "appstore_delete_beta_build_localization",
    group: "builds",
    summary: "Delete 'What to Test' notes for a locale",
    write: true,
    shape: { localizationId: id("Beta build localization") },
    run: (c, a) => c.builds.deleteBetaLocalization(str(a.localizationId, "localizationId")),
  },
];
