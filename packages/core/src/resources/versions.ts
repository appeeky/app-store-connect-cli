import type { AppStoreConnectClient } from "../client.js";
import { ValidationError } from "../errors.js";
import { compact, enc, listQuery, relOne, type ListOptions } from "../jsonapi.js";
import type { AttributesOf, Platform, Schemas } from "../types.js";

export type VersionCreateAttributes = AttributesOf<"AppStoreVersionCreateRequest">;
export type VersionUpdateAttributes = AttributesOf<"AppStoreVersionUpdateRequest">;
export type VersionLocalizationAttributes = AttributesOf<"AppStoreVersionLocalizationUpdateRequest">;
export type ReviewDetailAttributes = AttributesOf<"AppStoreReviewDetailUpdateRequest">;
export type PhasedReleaseState = Schemas["PhasedReleaseState"];

export class VersionsApi {
  constructor(private readonly client: AppStoreConnectClient) {}

  list(
    appId: string,
    options: ListOptions & {
      platform?: Platform | Platform[];
      versionString?: string | string[];
      appStoreState?: string | string[];
      appVersionState?: string | string[];
    } = {},
  ) {
    return this.client.list(
      `/v1/apps/${enc(appId)}/appStoreVersions`,
      listQuery(options, {
        platform: options.platform,
        versionString: options.versionString,
        appStoreState: options.appStoreState,
        appVersionState: options.appVersionState,
      }),
      options,
    );
  }

  get(versionId: string, options: { include?: string[] } = {}) {
    return this.client.get<Schemas["AppStoreVersionResponse"]>(
      `/v1/appStoreVersions/${enc(versionId)}`,
      listQuery({ include: options.include ?? ["build", "appStoreVersionPhasedRelease"] }),
    );
  }

  create(appId: string, attributes: VersionCreateAttributes, options: { buildId?: string } = {}) {
    const body: Schemas["AppStoreVersionCreateRequest"] = {
      data: {
        type: "appStoreVersions",
        attributes: compact(attributes) as VersionCreateAttributes,
        relationships: {
          app: relOne("apps", appId),
          ...(options.buildId ? { build: relOne("builds", options.buildId) } : {}),
        },
      },
    };
    return this.client.post("/v1/appStoreVersions", body, "appStoreVersions.create");
  }

  update(versionId: string, attributes: VersionUpdateAttributes) {
    const body: Schemas["AppStoreVersionUpdateRequest"] = {
      data: { type: "appStoreVersions", id: versionId, attributes: compact(attributes) },
    };
    return this.client.patch(`/v1/appStoreVersions/${enc(versionId)}`, body, "appStoreVersions.update");
  }

  delete(versionId: string) {
    return this.client.delete(`/v1/appStoreVersions/${enc(versionId)}`, undefined, "appStoreVersions.delete");
  }

  // ── Localizations ────────────────────────────────────────────
  listLocalizations(versionId: string, options: ListOptions & { locale?: string | string[] } = {}) {
    return this.client.list(
      `/v1/appStoreVersions/${enc(versionId)}/appStoreVersionLocalizations`,
      listQuery(options, { locale: options.locale }),
      options,
    );
  }

  getLocalization(localizationId: string) {
    return this.client.get(`/v1/appStoreVersionLocalizations/${enc(localizationId)}`);
  }

  createLocalization(versionId: string, locale: string, attributes: VersionLocalizationAttributes = {}) {
    const body: Schemas["AppStoreVersionLocalizationCreateRequest"] = {
      data: {
        type: "appStoreVersionLocalizations",
        attributes: { locale, ...compact(attributes) },
        relationships: { appStoreVersion: relOne("appStoreVersions", versionId) },
      },
    };
    return this.client.post("/v1/appStoreVersionLocalizations", body, "appStoreVersionLocalizations.create");
  }

  updateLocalization(localizationId: string, attributes: VersionLocalizationAttributes) {
    const body: Schemas["AppStoreVersionLocalizationUpdateRequest"] = {
      data: { type: "appStoreVersionLocalizations", id: localizationId, attributes: compact(attributes) },
    };
    return this.client.patch(
      `/v1/appStoreVersionLocalizations/${enc(localizationId)}`,
      body,
      "appStoreVersionLocalizations.update",
    );
  }

  deleteLocalization(localizationId: string) {
    return this.client.delete(
      `/v1/appStoreVersionLocalizations/${enc(localizationId)}`,
      undefined,
      "appStoreVersionLocalizations.delete",
    );
  }

  // ── Build ────────────────────────────────────────────────────
  getBuild(versionId: string) {
    return this.client.get(`/v1/appStoreVersions/${enc(versionId)}/build`);
  }

  attachBuild(versionId: string, buildId: string) {
    const body: Schemas["AppStoreVersionBuildLinkageRequest"] = { data: { type: "builds", id: buildId } };
    return this.client.patch(
      `/v1/appStoreVersions/${enc(versionId)}/relationships/build`,
      body,
      "appStoreVersions.build.attach",
    );
  }

  detachBuild(versionId: string) {
    return this.client.patch(
      `/v1/appStoreVersions/${enc(versionId)}/relationships/build`,
      { data: null },
      "appStoreVersions.build.detach",
    );
  }

  // ── App Review details ───────────────────────────────────────
  getReviewDetail(versionId: string) {
    return this.client.get(`/v1/appStoreVersions/${enc(versionId)}/appStoreReviewDetail`);
  }

  createReviewDetail(versionId: string, attributes: ReviewDetailAttributes) {
    const body: Schemas["AppStoreReviewDetailCreateRequest"] = {
      data: {
        type: "appStoreReviewDetails",
        attributes: compact(attributes),
        relationships: { appStoreVersion: relOne("appStoreVersions", versionId) },
      },
    };
    return this.client.post("/v1/appStoreReviewDetails", body, "appStoreReviewDetails.create");
  }

  updateReviewDetail(reviewDetailId: string, attributes: ReviewDetailAttributes) {
    const body: Schemas["AppStoreReviewDetailUpdateRequest"] = {
      data: { type: "appStoreReviewDetails", id: reviewDetailId, attributes: compact(attributes) },
    };
    return this.client.patch(`/v1/appStoreReviewDetails/${enc(reviewDetailId)}`, body, "appStoreReviewDetails.update");
  }

  // ── Phased release ───────────────────────────────────────────
  getPhasedRelease(versionId: string) {
    return this.client.get(`/v1/appStoreVersions/${enc(versionId)}/appStoreVersionPhasedRelease`);
  }

  createPhasedRelease(versionId: string, state?: PhasedReleaseState) {
    const body: Schemas["AppStoreVersionPhasedReleaseCreateRequest"] = {
      data: {
        type: "appStoreVersionPhasedReleases",
        ...(state ? { attributes: { phasedReleaseState: state } } : {}),
        relationships: { appStoreVersion: relOne("appStoreVersions", versionId) },
      },
    };
    return this.client.post("/v1/appStoreVersionPhasedReleases", body, "appStoreVersionPhasedReleases.create");
  }

  /** ACTIVE resumes, PAUSED pauses, COMPLETE releases to everyone now. */
  updatePhasedRelease(phasedReleaseId: string, state: PhasedReleaseState) {
    if (!["ACTIVE", "PAUSED", "COMPLETE"].includes(state)) {
      throw new ValidationError("Phased release state must be ACTIVE, PAUSED or COMPLETE");
    }
    const body: Schemas["AppStoreVersionPhasedReleaseUpdateRequest"] = {
      data: { type: "appStoreVersionPhasedReleases", id: phasedReleaseId, attributes: { phasedReleaseState: state } },
    };
    return this.client.patch(
      `/v1/appStoreVersionPhasedReleases/${enc(phasedReleaseId)}`,
      body,
      "appStoreVersionPhasedReleases.update",
    );
  }

  deletePhasedRelease(phasedReleaseId: string) {
    return this.client.delete(
      `/v1/appStoreVersionPhasedReleases/${enc(phasedReleaseId)}`,
      undefined,
      "appStoreVersionPhasedReleases.delete",
    );
  }

  /** Release a version that is Pending Developer Release. */
  release(versionId: string) {
    const body: Schemas["AppStoreVersionReleaseRequestCreateRequest"] = {
      data: {
        type: "appStoreVersionReleaseRequests",
        relationships: { appStoreVersion: relOne("appStoreVersions", versionId) },
      },
    };
    return this.client.post("/v1/appStoreVersionReleaseRequests", body, "appStoreVersionReleaseRequests.create");
  }
}
