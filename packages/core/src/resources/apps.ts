import type { AppStoreConnectClient } from "../client.js";
import { ValidationError } from "../errors.js";
import { compact, enc, listQuery, relOne, type JsonApiDocument, type ListOptions, type Resource } from "../jsonapi.js";
import type { AttributesOf, Platform, Schemas } from "../types.js";

export type AppInfoLocalizationAttributes = AttributesOf<"AppInfoLocalizationUpdateRequest">;
export type AgeRatingAttributes = AttributesOf<"AgeRatingDeclarationUpdateRequest">;

export interface AppInfoCategories {
  primaryCategory?: string | null;
  primarySubcategoryOne?: string | null;
  primarySubcategoryTwo?: string | null;
  secondaryCategory?: string | null;
  secondarySubcategoryOne?: string | null;
  secondarySubcategoryTwo?: string | null;
}

export class AppsApi {
  constructor(private readonly client: AppStoreConnectClient) {}

  list(
    options: ListOptions & { bundleId?: string | string[]; name?: string | string[]; sku?: string | string[] } = {},
  ) {
    return this.client.list(
      "/v1/apps",
      listQuery(options, { bundleId: options.bundleId, name: options.name, sku: options.sku }),
      options,
    );
  }

  get(appId: string, options: { include?: string[] } = {}) {
    return this.client.get<Schemas["AppResponse"]>(`/v1/apps/${enc(appId)}`, listQuery(options));
  }

  /** Find an app by bundle identifier. */
  async findByBundleId(bundleId: string): Promise<Resource | undefined> {
    const doc = await this.client.get<JsonApiDocument<Resource[]>>("/v1/apps", {
      "filter[bundleId]": bundleId,
      limit: 2,
    });
    return doc.data.find((a) => a.attributes?.bundleId === bundleId) ?? doc.data[0];
  }

  /** Accept an Apple app id (digits) or a bundle id and return the app id. */
  async resolveAppId(appIdOrBundleId: string): Promise<string> {
    if (/^\d+$/.test(appIdOrBundleId)) return appIdOrBundleId;
    const app = await this.findByBundleId(appIdOrBundleId);
    if (!app) throw new ValidationError(`No app with bundle id ${appIdOrBundleId} is visible to this key`);
    return app.id;
  }

  // ── App infos ────────────────────────────────────────────────
  listAppInfos(appId: string, options: ListOptions = {}) {
    return this.client.get(`/v1/apps/${enc(appId)}/appInfos`, listQuery(options));
  }

  getAppInfo(appInfoId: string, options: { include?: string[] } = {}) {
    return this.client.get<Schemas["AppInfoResponse"]>(`/v1/appInfos/${enc(appInfoId)}`, listQuery(options));
  }

  updateAppInfoCategories(appInfoId: string, categories: AppInfoCategories) {
    const relationships: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(categories)) {
      if (value === undefined) continue;
      relationships[key] = { data: value === null ? null : { type: "appCategories", id: value } };
    }
    if (Object.keys(relationships).length === 0) {
      throw new ValidationError("Pass at least one category to change");
    }
    const body = {
      data: { type: "appInfos", id: appInfoId, relationships },
    } as Schemas["AppInfoUpdateRequest"];
    return this.client.patch(`/v1/appInfos/${enc(appInfoId)}`, body, "appInfos.update");
  }

  listAppInfoLocalizations(appInfoId: string, options: ListOptions & { locale?: string } = {}) {
    return this.client.list(
      `/v1/appInfos/${enc(appInfoId)}/appInfoLocalizations`,
      listQuery(options, { locale: options.locale }),
      options,
    );
  }

  getAppInfoLocalization(id: string) {
    return this.client.get(`/v1/appInfoLocalizations/${enc(id)}`);
  }

  createAppInfoLocalization(
    appInfoId: string,
    locale: string,
    attributes: AppInfoLocalizationAttributes & { name: string },
  ) {
    const body: Schemas["AppInfoLocalizationCreateRequest"] = {
      data: {
        type: "appInfoLocalizations",
        attributes: { ...compact(attributes), locale, name: attributes.name },
        relationships: { appInfo: relOne("appInfos", appInfoId) },
      },
    };
    return this.client.post("/v1/appInfoLocalizations", body, "appInfoLocalizations.create");
  }

  updateAppInfoLocalization(id: string, attributes: AppInfoLocalizationAttributes) {
    const body: Schemas["AppInfoLocalizationUpdateRequest"] = {
      data: { type: "appInfoLocalizations", id, attributes: compact(attributes) },
    };
    return this.client.patch(`/v1/appInfoLocalizations/${enc(id)}`, body, "appInfoLocalizations.update");
  }

  deleteAppInfoLocalization(id: string) {
    return this.client.delete(`/v1/appInfoLocalizations/${enc(id)}`, undefined, "appInfoLocalizations.delete");
  }

  listCategories(options: ListOptions & { platforms?: Platform[] } = {}) {
    return this.client.list(
      "/v1/appCategories",
      listQuery({ include: ["subcategories"], ...options }, { platforms: options.platforms }),
      options,
    );
  }

  // ── Age rating ───────────────────────────────────────────────
  getAgeRating(appInfoId: string) {
    return this.client.get(`/v1/appInfos/${enc(appInfoId)}/ageRatingDeclaration`);
  }

  updateAgeRating(declarationId: string, attributes: AgeRatingAttributes) {
    const body: Schemas["AgeRatingDeclarationUpdateRequest"] = {
      data: { type: "ageRatingDeclarations", id: declarationId, attributes: compact(attributes) },
    };
    return this.client.patch(`/v1/ageRatingDeclarations/${enc(declarationId)}`, body, "ageRatingDeclarations.update");
  }

  // ── Availability & pricing ───────────────────────────────────
  getAvailability(appId: string) {
    return this.client.get(`/v1/apps/${enc(appId)}/appAvailabilityV2`);
  }

  listTerritoryAvailabilities(availabilityId: string, options: ListOptions = {}) {
    return this.client.list(
      `/v2/appAvailabilities/${enc(availabilityId)}/territoryAvailabilities`,
      listQuery({ include: ["territory"], ...options }),
      options,
    );
  }

  listTerritories(options: ListOptions = {}) {
    return this.client.list("/v1/territories", listQuery(options), options);
  }

  listPricePoints(appId: string, options: ListOptions & { territory?: string | string[] } = {}) {
    return this.client.list(
      `/v1/apps/${enc(appId)}/appPricePoints`,
      listQuery(options, { territory: options.territory }),
      options,
    );
  }

  getPriceSchedule(appId: string) {
    return this.client.get(`/v1/apps/${enc(appId)}/appPriceSchedule`, {
      include: ["baseTerritory", "manualPrices", "automaticPrices"],
    });
  }
}
