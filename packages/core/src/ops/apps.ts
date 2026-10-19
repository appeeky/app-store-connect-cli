import { z } from "zod";
import type { AgeRatingAttributes, AppInfoLocalizationAttributes } from "../resources/apps.js";
import type { Platform } from "../types.js";
import { appId, id, locale, page, pageOpts, pick, requireSome, str, strOrArr, type AscOp } from "./shared.js";

const APP_INFO_LOC_FIELDS = ["name", "subtitle", "privacyPolicyUrl", "privacyChoicesUrl", "privacyPolicyText"] as const;
const appInfoLocShape = {
  name: z.string().max(30).optional().describe("App name (max 30)"),
  subtitle: z.string().max(30).optional().describe("Subtitle (max 30)"),
  privacyPolicyUrl: z.string().url().optional(),
  privacyChoicesUrl: z.string().url().optional(),
  privacyPolicyText: z.string().optional().describe("Privacy policy text (tvOS)"),
};

const category = z.string().nullable().optional().describe("App category id, e.g. GAMES, PRODUCTIVITY; null clears");

export const APPS_OPS: AscOp[] = [
  {
    name: "appstore_list_apps",
    group: "apps",
    summary: "List apps visible to the API key (filter by bundle id, name or SKU)",
    write: false,
    shape: {
      bundleId: strOrArr.optional().describe("Bundle identifier(s)"),
      name: strOrArr.optional(),
      sku: strOrArr.optional(),
      ...page,
    },
    run: (c, a) =>
      c.apps.list({
        ...pageOpts(a),
        bundleId: a.bundleId as string | string[] | undefined,
        name: a.name as string | string[] | undefined,
        sku: a.sku as string | string[] | undefined,
      }),
  },
  {
    name: "appstore_get_app",
    group: "apps",
    summary: "Get one app by id",
    write: false,
    shape: { appId, include: z.array(z.string()).optional().describe("Related resources, e.g. appInfos") },
    run: (c, a) => c.apps.get(str(a.appId, "appId"), { include: a.include as string[] | undefined }),
  },
  {
    name: "appstore_find_app",
    group: "apps",
    summary: "Find an app by bundle identifier and return its Apple app id",
    write: false,
    shape: { bundleId: z.string().min(1) },
    run: async (c, a) => {
      const app = await c.apps.findByBundleId(str(a.bundleId, "bundleId"));
      return app ?? { found: false, bundleId: a.bundleId };
    },
  },
  {
    name: "appstore_list_app_infos",
    group: "apps",
    summary: "List app infos (name/subtitle/category container per App Store state)",
    write: false,
    shape: { appId },
    run: (c, a) => c.apps.listAppInfos(str(a.appId, "appId"), { include: ["primaryCategory", "secondaryCategory"] }),
  },
  {
    name: "appstore_get_app_info",
    group: "apps",
    summary: "Get an app info with its categories",
    write: false,
    shape: { appInfoId: id("App info") },
    run: (c, a) =>
      c.apps.getAppInfo(str(a.appInfoId, "appInfoId"), {
        include: ["primaryCategory", "secondaryCategory", "ageRatingDeclaration"],
      }),
  },
  {
    name: "appstore_update_app_categories",
    group: "apps",
    summary: "Set primary/secondary categories (and subcategories) on an app info",
    write: true,
    shape: {
      appInfoId: id("App info"),
      primaryCategory: category,
      primarySubcategoryOne: category,
      primarySubcategoryTwo: category,
      secondaryCategory: category,
      secondarySubcategoryOne: category,
      secondarySubcategoryTwo: category,
    },
    run: (c, a) =>
      c.apps.updateAppInfoCategories(
        str(a.appInfoId, "appInfoId"),
        pick(a, [
          "primaryCategory",
          "primarySubcategoryOne",
          "primarySubcategoryTwo",
          "secondaryCategory",
          "secondarySubcategoryOne",
          "secondarySubcategoryTwo",
        ]),
      ),
  },
  {
    name: "appstore_list_categories",
    group: "apps",
    summary: "List App Store categories and subcategories",
    write: false,
    shape: { platforms: z.array(z.enum(["IOS", "MAC_OS", "TV_OS", "VISION_OS"])).optional(), ...page },
    run: (c, a) => c.apps.listCategories({ ...pageOpts(a), platforms: a.platforms as Platform[] | undefined }),
  },
  {
    name: "appstore_list_app_info_localizations",
    group: "apps",
    summary: "List app info localizations (name, subtitle, privacy URLs) for an app info",
    write: false,
    shape: { appInfoId: id("App info"), locale: z.string().optional(), ...page },
    run: (c, a) =>
      c.apps.listAppInfoLocalizations(str(a.appInfoId, "appInfoId"), {
        ...pageOpts(a),
        locale: a.locale as string | undefined,
      }),
  },
  {
    name: "appstore_get_app_info_localization",
    group: "apps",
    summary: "Get one app info localization",
    write: false,
    shape: { localizationId: id("App info localization") },
    run: (c, a) => c.apps.getAppInfoLocalization(str(a.localizationId, "localizationId")),
  },
  {
    name: "appstore_create_app_info_localization",
    group: "apps",
    summary: "Add a locale to an app info (name, subtitle, privacy URLs)",
    write: true,
    shape: { appInfoId: id("App info"), locale, ...appInfoLocShape, name: z.string().min(1).max(30).describe("App name (max 30)") },
    run: (c, a) =>
      c.apps.createAppInfoLocalization(str(a.appInfoId, "appInfoId"), str(a.locale, "locale"), {
        ...pick<AppInfoLocalizationAttributes>(a, APP_INFO_LOC_FIELDS),
        name: str(a.name, "name"),
      }),
  },
  {
    name: "appstore_update_app_info_localization",
    group: "apps",
    summary: "Update app name, subtitle or privacy URLs for one locale",
    write: true,
    shape: { localizationId: id("App info localization"), ...appInfoLocShape },
    run: (c, a) => {
      const attrs = pick<AppInfoLocalizationAttributes>(a, APP_INFO_LOC_FIELDS);
      requireSome(attrs, "field");
      return c.apps.updateAppInfoLocalization(str(a.localizationId, "localizationId"), attrs);
    },
  },
  {
    name: "appstore_delete_app_info_localization",
    group: "apps",
    summary: "Remove a locale from an app info",
    write: true,
    shape: { localizationId: id("App info localization") },
    run: (c, a) => c.apps.deleteAppInfoLocalization(str(a.localizationId, "localizationId")),
  },
  {
    name: "appstore_get_age_rating",
    group: "apps",
    summary: "Get the age rating declaration of an app info",
    write: false,
    shape: { appInfoId: id("App info") },
    run: (c, a) => c.apps.getAgeRating(str(a.appInfoId, "appInfoId")),
  },
  {
    name: "appstore_update_age_rating",
    group: "apps",
    summary: "Update age rating answers (pass the attributes to change, e.g. violenceCartoonOrFantasy)",
    write: true,
    shape: {
      declarationId: id("Age rating declaration"),
      attributes: z
        .record(z.union([z.string(), z.boolean(), z.null()]))
        .describe("Age rating attributes as Apple names them, e.g. {\"gambling\": false, \"violenceRealistic\": \"NONE\"}"),
    },
    run: (c, a) => {
      const attrs = (a.attributes ?? {}) as AgeRatingAttributes;
      requireSome(attrs as Record<string, unknown>, "attribute");
      return c.apps.updateAgeRating(str(a.declarationId, "declarationId"), attrs);
    },
  },
  {
    name: "appstore_get_app_availability",
    group: "apps",
    summary: "Get app availability (whether new territories are added automatically)",
    write: false,
    shape: { appId },
    run: (c, a) => c.apps.getAvailability(str(a.appId, "appId")),
  },
  {
    name: "appstore_list_territory_availabilities",
    group: "apps",
    summary: "List per-territory availability for an app availability id",
    write: false,
    shape: { availabilityId: id("App availability"), ...page },
    run: (c, a) => c.apps.listTerritoryAvailabilities(str(a.availabilityId, "availabilityId"), pageOpts(a)),
  },
  {
    name: "appstore_list_territories",
    group: "apps",
    summary: "List App Store territories and their currencies",
    write: false,
    shape: { ...page },
    run: (c, a) => c.apps.listTerritories(pageOpts(a)),
  },
];
