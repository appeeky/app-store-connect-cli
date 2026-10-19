import { z } from "zod";
import type {
  PhasedReleaseState,
  ReviewDetailAttributes,
  VersionCreateAttributes,
  VersionLocalizationAttributes,
  VersionUpdateAttributes,
} from "../resources/versions.js";
import type { Platform } from "../types.js";
import { appId, id, locale, page, pageOpts, pick, platform, requireSome, str, strOrArr, type AscOp } from "./shared.js";

const versionId = id("App Store version");
const releaseType = z
  .enum(["MANUAL", "AFTER_APPROVAL", "SCHEDULED"])
  .optional()
  .describe("MANUAL: you release; AFTER_APPROVAL: automatic; SCHEDULED: at earliestReleaseDate");
const VERSION_FIELDS = ["versionString", "copyright", "releaseType", "earliestReleaseDate", "downloadable"] as const;

const LOC_FIELDS = ["description", "keywords", "whatsNew", "promotionalText", "marketingUrl", "supportUrl"] as const;
const locShape = {
  description: z.string().max(4000).optional().describe("Description (max 4000)"),
  keywords: z.string().max(100).optional().describe("Comma-separated keywords (max 100 bytes)"),
  whatsNew: z.string().max(4000).optional().describe("What's New in This Version"),
  promotionalText: z.string().max(170).optional().describe("Promotional text (max 170, editable any time)"),
  marketingUrl: z.string().url().optional(),
  supportUrl: z.string().url().optional(),
};

const REVIEW_FIELDS = [
  "contactFirstName",
  "contactLastName",
  "contactPhone",
  "contactEmail",
  "demoAccountName",
  "demoAccountPassword",
  "demoAccountRequired",
  "notes",
] as const;
const reviewShape = {
  contactFirstName: z.string().optional(),
  contactLastName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional(),
  demoAccountName: z.string().optional(),
  demoAccountPassword: z.string().optional(),
  demoAccountRequired: z.boolean().optional(),
  notes: z.string().max(4000).optional().describe("Notes for App Review"),
};

export const VERSIONS_OPS: AscOp[] = [
  {
    name: "appstore_list_versions",
    group: "versions",
    summary: "List App Store versions of an app (filter by platform, version string, state)",
    write: false,
    shape: {
      appId,
      platform: platform.optional(),
      versionString: strOrArr.optional(),
      appStoreState: strOrArr.optional().describe("e.g. PREPARE_FOR_SUBMISSION, READY_FOR_SALE, PENDING_DEVELOPER_RELEASE"),
      ...page,
    },
    run: (c, a) =>
      c.versions.list(str(a.appId, "appId"), {
        ...pageOpts(a),
        platform: a.platform as Platform | undefined,
        versionString: a.versionString as string | undefined,
        appStoreState: a.appStoreState as string | undefined,
      }),
  },
  {
    name: "appstore_get_version",
    group: "versions",
    summary: "Get an App Store version with its build and phased release",
    write: false,
    shape: { versionId },
    run: (c, a) => c.versions.get(str(a.versionId, "versionId")),
  },
  {
    name: "appstore_create_version",
    group: "versions",
    summary: "Create a new App Store version (optionally attach a build)",
    write: true,
    shape: {
      appId,
      platform,
      versionString: z.string().min(1).describe("Marketing version, e.g. 2.4.0"),
      copyright: z.string().optional(),
      releaseType,
      earliestReleaseDate: z.string().optional().describe("ISO 8601 date-time for SCHEDULED releases"),
      buildId: z.string().optional(),
    },
    run: (c, a) =>
      c.versions.create(
        str(a.appId, "appId"),
        {
          platform: a.platform as Platform,
          ...pick<Partial<VersionCreateAttributes>>(a, ["versionString", "copyright", "releaseType", "earliestReleaseDate"]),
        } as VersionCreateAttributes,
        { buildId: a.buildId as string | undefined },
      ),
  },
  {
    name: "appstore_update_version",
    group: "versions",
    summary: "Update version string, copyright, release type or scheduled date",
    write: true,
    shape: {
      versionId,
      versionString: z.string().optional(),
      copyright: z.string().optional(),
      releaseType,
      earliestReleaseDate: z.string().optional(),
      downloadable: z.boolean().optional(),
    },
    run: (c, a) => {
      const attrs = pick<VersionUpdateAttributes>(a, VERSION_FIELDS);
      requireSome(attrs, "field");
      return c.versions.update(str(a.versionId, "versionId"), attrs);
    },
  },
  {
    name: "appstore_delete_version",
    group: "versions",
    summary: "Delete an App Store version that was never submitted",
    write: true,
    shape: { versionId },
    run: (c, a) => c.versions.delete(str(a.versionId, "versionId")),
  },
  {
    name: "appstore_list_version_localizations",
    group: "versions",
    summary: "List version localizations (description, keywords, what's new, promo text, URLs)",
    write: false,
    shape: { versionId, locale: z.string().optional(), ...page },
    run: (c, a) =>
      c.versions.listLocalizations(str(a.versionId, "versionId"), {
        ...pageOpts(a),
        locale: a.locale as string | undefined,
      }),
  },
  {
    name: "appstore_get_version_localization",
    group: "versions",
    summary: "Get one version localization",
    write: false,
    shape: { localizationId: id("Version localization") },
    run: (c, a) => c.versions.getLocalization(str(a.localizationId, "localizationId")),
  },
  {
    name: "appstore_create_version_localization",
    group: "versions",
    summary: "Add a locale to a version with description, keywords, what's new and URLs",
    write: true,
    shape: { versionId, locale, ...locShape },
    run: (c, a) =>
      c.versions.createLocalization(
        str(a.versionId, "versionId"),
        str(a.locale, "locale"),
        pick<VersionLocalizationAttributes>(a, LOC_FIELDS),
      ),
  },
  {
    name: "appstore_update_version_localization",
    group: "versions",
    summary: "Update description, keywords, what's new, promotional text or URLs for one locale",
    write: true,
    shape: { localizationId: id("Version localization"), ...locShape },
    run: (c, a) => {
      const attrs = pick<VersionLocalizationAttributes>(a, LOC_FIELDS);
      requireSome(attrs, "field");
      return c.versions.updateLocalization(str(a.localizationId, "localizationId"), attrs);
    },
  },
  {
    name: "appstore_delete_version_localization",
    group: "versions",
    summary: "Remove a locale from a version",
    write: true,
    shape: { localizationId: id("Version localization") },
    run: (c, a) => c.versions.deleteLocalization(str(a.localizationId, "localizationId")),
  },
  {
    name: "appstore_get_version_build",
    group: "versions",
    summary: "Get the build attached to a version",
    write: false,
    shape: { versionId },
    run: (c, a) => c.versions.getBuild(str(a.versionId, "versionId")),
  },
  {
    name: "appstore_attach_build",
    group: "versions",
    summary: "Attach a processed build to a version",
    write: true,
    shape: { versionId, buildId: id("Build") },
    run: (c, a) => c.versions.attachBuild(str(a.versionId, "versionId"), str(a.buildId, "buildId")),
  },
  {
    name: "appstore_detach_build",
    group: "versions",
    summary: "Detach the build from a version",
    write: true,
    shape: { versionId },
    run: (c, a) => c.versions.detachBuild(str(a.versionId, "versionId")),
  },
  {
    name: "appstore_get_review_details",
    group: "versions",
    summary: "Get App Review contact, demo account and notes for a version",
    write: false,
    shape: { versionId },
    run: (c, a) => c.versions.getReviewDetail(str(a.versionId, "versionId")),
  },
  {
    name: "appstore_create_review_details",
    group: "versions",
    summary: "Create App Review details (contact, demo account, notes) for a version",
    write: true,
    shape: { versionId, ...reviewShape },
    run: (c, a) =>
      c.versions.createReviewDetail(str(a.versionId, "versionId"), pick<ReviewDetailAttributes>(a, REVIEW_FIELDS)),
  },
  {
    name: "appstore_update_review_details",
    group: "versions",
    summary: "Update App Review contact, demo account or notes",
    write: true,
    shape: { reviewDetailId: id("App Store review detail"), ...reviewShape },
    run: (c, a) => {
      const attrs = pick<ReviewDetailAttributes>(a, REVIEW_FIELDS);
      requireSome(attrs, "field");
      return c.versions.updateReviewDetail(str(a.reviewDetailId, "reviewDetailId"), attrs);
    },
  },
];

export const RELEASE_OPS: AscOp[] = [
  {
    name: "appstore_get_phased_release",
    group: "release",
    summary: "Get the phased (7-day) release of a version",
    write: false,
    shape: { versionId },
    run: (c, a) => c.versions.getPhasedRelease(str(a.versionId, "versionId")),
  },
  {
    name: "appstore_create_phased_release",
    group: "release",
    summary: "Turn on phased release for a version (before or after approval)",
    write: true,
    shape: {
      versionId,
      state: z.enum(["INACTIVE", "ACTIVE"]).optional().describe("INACTIVE until release (default) or ACTIVE"),
    },
    run: (c, a) =>
      c.versions.createPhasedRelease(str(a.versionId, "versionId"), a.state as PhasedReleaseState | undefined),
  },
  {
    name: "appstore_update_phased_release",
    group: "release",
    summary: "Pause (PAUSED), resume (ACTIVE) or finish (COMPLETE) a phased release",
    write: true,
    shape: { phasedReleaseId: id("Phased release"), state: z.enum(["ACTIVE", "PAUSED", "COMPLETE"]) },
    run: (c, a) =>
      c.versions.updatePhasedRelease(str(a.phasedReleaseId, "phasedReleaseId"), a.state as PhasedReleaseState),
  },
  {
    name: "appstore_delete_phased_release",
    group: "release",
    summary: "Turn off phased release (only before it starts)",
    write: true,
    shape: { phasedReleaseId: id("Phased release") },
    run: (c, a) => c.versions.deletePhasedRelease(str(a.phasedReleaseId, "phasedReleaseId")),
  },
  {
    name: "appstore_release_version",
    group: "release",
    summary: "Release a version that is Pending Developer Release",
    write: true,
    shape: { versionId },
    run: (c, a) => c.versions.release(str(a.versionId, "versionId")),
  },
];
