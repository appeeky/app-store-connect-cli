import type { AppStoreConnectClient } from "../client.js";
import { compact, enc, listQuery, relOne, type JsonApiDocument, type ListOptions, type Resource } from "../jsonapi.js";
import type { Platform, Schemas } from "../types.js";

export interface BuildListFilters {
  /** Build number (CFBundleVersion). */
  buildNumber?: string | string[];
  /** Marketing version (CFBundleShortVersionString). */
  marketingVersion?: string | string[];
  platform?: Platform | Platform[];
  processingState?: string | string[];
  expired?: boolean;
  betaReviewState?: string | string[];
}

export class BuildsApi {
  constructor(private readonly client: AppStoreConnectClient) {}

  /** Builds for an app, newest upload first. */
  list(appId: string, options: ListOptions & BuildListFilters = {}) {
    return this.client.list(
      "/v1/builds",
      listQuery(
        { sort: "-uploadedDate", include: ["preReleaseVersion"], ...options },
        {
          app: appId,
          version: options.buildNumber,
          "preReleaseVersion.version": options.marketingVersion,
          "preReleaseVersion.platform": options.platform,
          processingState: options.processingState,
          expired: options.expired,
          "betaAppReviewSubmission.betaReviewState": options.betaReviewState,
        },
      ),
      options,
    );
  }

  get(buildId: string, options: { include?: string[] } = {}) {
    return this.client.get<Schemas["BuildResponse"]>(
      `/v1/builds/${enc(buildId)}`,
      listQuery({ include: options.include ?? ["preReleaseVersion", "buildBetaDetail", "betaAppReviewSubmission"] }),
    );
  }

  /** Newest build for an app (optionally a given marketing version / platform). */
  async latest(appId: string, filters: BuildListFilters = {}): Promise<Resource | undefined> {
    const doc = (await this.list(appId, { ...filters, limit: 1 })) as JsonApiDocument<Resource[]>;
    return doc.data[0];
  }

  /** Processing state and the bits that tell you whether a build is usable. */
  async processingState(buildId: string) {
    const doc = await this.client.get<JsonApiDocument<Resource>>(`/v1/builds/${enc(buildId)}`);
    const a = doc.data.attributes ?? {};
    return {
      id: doc.data.id,
      version: a.version,
      processingState: a.processingState,
      expired: a.expired,
      uploadedDate: a.uploadedDate,
      expirationDate: a.expirationDate,
      usesNonExemptEncryption: a.usesNonExemptEncryption,
    };
  }

  update(buildId: string, attributes: { expired?: boolean; usesNonExemptEncryption?: boolean }) {
    const body: Schemas["BuildUpdateRequest"] = {
      data: { type: "builds", id: buildId, attributes: compact(attributes) },
    };
    return this.client.patch(`/v1/builds/${enc(buildId)}`, body, "builds.update");
  }

  expire(buildId: string) {
    return this.update(buildId, { expired: true });
  }

  // ── Beta details ─────────────────────────────────────────────
  getBetaDetail(buildId: string) {
    return this.client.get(`/v1/builds/${enc(buildId)}/buildBetaDetail`);
  }

  updateBetaDetail(buildBetaDetailId: string, attributes: { autoNotifyEnabled?: boolean }) {
    const body: Schemas["BuildBetaDetailUpdateRequest"] = {
      data: { type: "buildBetaDetails", id: buildBetaDetailId, attributes: compact(attributes) },
    };
    return this.client.patch(`/v1/buildBetaDetails/${enc(buildBetaDetailId)}`, body, "buildBetaDetails.update");
  }

  // ── Beta build localizations ("What to Test") ─────────────────
  listBetaLocalizations(buildId: string, options: ListOptions = {}) {
    return this.client.list(`/v1/builds/${enc(buildId)}/betaBuildLocalizations`, listQuery(options), options);
  }

  createBetaLocalization(buildId: string, locale: string, whatsNew?: string) {
    const body: Schemas["BetaBuildLocalizationCreateRequest"] = {
      data: {
        type: "betaBuildLocalizations",
        attributes: compact({ locale, whatsNew }) as { locale: string; whatsNew?: string },
        relationships: { build: relOne("builds", buildId) },
      },
    };
    return this.client.post("/v1/betaBuildLocalizations", body, "betaBuildLocalizations.create");
  }

  updateBetaLocalization(localizationId: string, whatsNew: string) {
    const body: Schemas["BetaBuildLocalizationUpdateRequest"] = {
      data: { type: "betaBuildLocalizations", id: localizationId, attributes: { whatsNew } },
    };
    return this.client.patch(`/v1/betaBuildLocalizations/${enc(localizationId)}`, body, "betaBuildLocalizations.update");
  }

  deleteBetaLocalization(localizationId: string) {
    return this.client.delete(
      `/v1/betaBuildLocalizations/${enc(localizationId)}`,
      undefined,
      "betaBuildLocalizations.delete",
    );
  }
}
