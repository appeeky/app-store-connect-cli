import type { AppStoreConnectClient } from "../client.js";
import { ValidationError } from "../errors.js";
import { compact, enc, listQuery, relMany, relOne, type ListOptions } from "../jsonapi.js";
import type { AttributesOf, Schemas } from "../types.js";

export type BetaGroupCreateAttributes = AttributesOf<"BetaGroupCreateRequest">;
export type BetaGroupUpdateAttributes = AttributesOf<"BetaGroupUpdateRequest">;
export type BetaAppLocalizationAttributes = AttributesOf<"BetaAppLocalizationUpdateRequest">;
export type BetaAppReviewDetailAttributes = AttributesOf<"BetaAppReviewDetailUpdateRequest">;

function requireIds(ids: string[], what: string): string[] {
  if (!ids.length) throw new ValidationError(`Pass at least one ${what} id`);
  return ids;
}

export class TestFlightApi {
  constructor(private readonly client: AppStoreConnectClient) {}

  // ── Beta groups ──────────────────────────────────────────────
  listGroups(appId: string | undefined, options: ListOptions & { name?: string; isInternalGroup?: boolean } = {}) {
    return this.client.list(
      "/v1/betaGroups",
      listQuery(options, { app: appId, name: options.name, isInternalGroup: options.isInternalGroup }),
      options,
    );
  }

  getGroup(groupId: string) {
    return this.client.get(`/v1/betaGroups/${enc(groupId)}`);
  }

  createGroup(appId: string, attributes: BetaGroupCreateAttributes) {
    const body: Schemas["BetaGroupCreateRequest"] = {
      data: {
        type: "betaGroups",
        attributes: compact(attributes) as BetaGroupCreateAttributes,
        relationships: { app: relOne("apps", appId) },
      },
    };
    return this.client.post("/v1/betaGroups", body, "betaGroups.create");
  }

  updateGroup(groupId: string, attributes: BetaGroupUpdateAttributes) {
    const body: Schemas["BetaGroupUpdateRequest"] = {
      data: { type: "betaGroups", id: groupId, attributes: compact(attributes) },
    };
    return this.client.patch(`/v1/betaGroups/${enc(groupId)}`, body, "betaGroups.update");
  }

  deleteGroup(groupId: string) {
    return this.client.delete(`/v1/betaGroups/${enc(groupId)}`, undefined, "betaGroups.delete");
  }

  addBuildsToGroup(groupId: string, buildIds: string[]) {
    const body: Schemas["BetaGroupBuildsLinkagesRequest"] = relMany("builds", requireIds(buildIds, "build"));
    return this.client.post(`/v1/betaGroups/${enc(groupId)}/relationships/builds`, body, "betaGroups.builds.add");
  }

  removeBuildsFromGroup(groupId: string, buildIds: string[]) {
    const body: Schemas["BetaGroupBuildsLinkagesRequest"] = relMany("builds", requireIds(buildIds, "build"));
    return this.client.delete(`/v1/betaGroups/${enc(groupId)}/relationships/builds`, body, "betaGroups.builds.remove");
  }

  addTestersToGroup(groupId: string, testerIds: string[]) {
    const body: Schemas["BetaGroupBetaTestersLinkagesRequest"] = relMany("betaTesters", requireIds(testerIds, "tester"));
    return this.client.post(
      `/v1/betaGroups/${enc(groupId)}/relationships/betaTesters`,
      body,
      "betaGroups.betaTesters.add",
    );
  }

  removeTestersFromGroup(groupId: string, testerIds: string[]) {
    const body: Schemas["BetaGroupBetaTestersLinkagesRequest"] = relMany("betaTesters", requireIds(testerIds, "tester"));
    return this.client.delete(
      `/v1/betaGroups/${enc(groupId)}/relationships/betaTesters`,
      body,
      "betaGroups.betaTesters.remove",
    );
  }

  // ── Beta testers ─────────────────────────────────────────────
  listTesters(
    options: ListOptions & { appId?: string; groupId?: string; buildId?: string; email?: string } = {},
  ) {
    return this.client.list(
      "/v1/betaTesters",
      listQuery(options, {
        apps: options.appId,
        betaGroups: options.groupId,
        builds: options.buildId,
        email: options.email,
      }),
      options,
    );
  }

  getTester(testerId: string) {
    return this.client.get(`/v1/betaTesters/${enc(testerId)}`, { include: ["betaGroups"] });
  }

  /** Create a tester and add them to groups (they get an invitation email). */
  inviteTester(input: { email: string; firstName?: string; lastName?: string; groupIds?: string[]; buildIds?: string[] }) {
    if (!input.groupIds?.length && !input.buildIds?.length) {
      throw new ValidationError("A new tester needs at least one beta group or build");
    }
    const relationships: Record<string, unknown> = {};
    if (input.groupIds?.length) relationships.betaGroups = relMany("betaGroups", input.groupIds);
    if (input.buildIds?.length) relationships.builds = relMany("builds", input.buildIds);
    const body = {
      data: {
        type: "betaTesters",
        attributes: compact({ email: input.email, firstName: input.firstName, lastName: input.lastName }),
        relationships,
      },
    } as Schemas["BetaTesterCreateRequest"];
    return this.client.post("/v1/betaTesters", body, "betaTesters.create");
  }

  /** Re-send the TestFlight invitation for an app. */
  sendInvitation(appId: string, testerId: string) {
    const body: Schemas["BetaTesterInvitationCreateRequest"] = {
      data: {
        type: "betaTesterInvitations",
        relationships: { app: relOne("apps", appId), betaTester: relOne("betaTesters", testerId) },
      },
    };
    return this.client.post("/v1/betaTesterInvitations", body, "betaTesterInvitations.create");
  }

  deleteTester(testerId: string) {
    return this.client.delete(`/v1/betaTesters/${enc(testerId)}`, undefined, "betaTesters.delete");
  }

  // ── Beta app localizations ───────────────────────────────────
  listAppLocalizations(appId: string, options: ListOptions & { locale?: string } = {}) {
    return this.client.list(
      "/v1/betaAppLocalizations",
      listQuery(options, { app: appId, locale: options.locale }),
      options,
    );
  }

  createAppLocalization(appId: string, locale: string, attributes: BetaAppLocalizationAttributes = {}) {
    const body: Schemas["BetaAppLocalizationCreateRequest"] = {
      data: {
        type: "betaAppLocalizations",
        attributes: { locale, ...compact(attributes) },
        relationships: { app: relOne("apps", appId) },
      },
    };
    return this.client.post("/v1/betaAppLocalizations", body, "betaAppLocalizations.create");
  }

  updateAppLocalization(localizationId: string, attributes: BetaAppLocalizationAttributes) {
    const body: Schemas["BetaAppLocalizationUpdateRequest"] = {
      data: { type: "betaAppLocalizations", id: localizationId, attributes: compact(attributes) },
    };
    return this.client.patch(`/v1/betaAppLocalizations/${enc(localizationId)}`, body, "betaAppLocalizations.update");
  }

  deleteAppLocalization(localizationId: string) {
    return this.client.delete(
      `/v1/betaAppLocalizations/${enc(localizationId)}`,
      undefined,
      "betaAppLocalizations.delete",
    );
  }

  // ── Beta App Review ──────────────────────────────────────────
  submitForBetaReview(buildId: string) {
    const body: Schemas["BetaAppReviewSubmissionCreateRequest"] = {
      data: { type: "betaAppReviewSubmissions", relationships: { build: relOne("builds", buildId) } },
    };
    return this.client.post("/v1/betaAppReviewSubmissions", body, "betaAppReviewSubmissions.create");
  }

  listBetaReviewSubmissions(buildId: string, options: ListOptions = {}) {
    return this.client.list("/v1/betaAppReviewSubmissions", listQuery(options, { build: buildId }), options);
  }

  getBetaReviewDetail(appId: string) {
    return this.client.get(`/v1/apps/${enc(appId)}/betaAppReviewDetail`);
  }

  updateBetaReviewDetail(detailId: string, attributes: BetaAppReviewDetailAttributes) {
    const body: Schemas["BetaAppReviewDetailUpdateRequest"] = {
      data: { type: "betaAppReviewDetails", id: detailId, attributes: compact(attributes) },
    };
    return this.client.patch(`/v1/betaAppReviewDetails/${enc(detailId)}`, body, "betaAppReviewDetails.update");
  }
}
