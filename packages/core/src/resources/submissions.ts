import type { AppStoreConnectClient } from "../client.js";
import { compact, enc, listQuery, relOne, type JsonApiDocument, type ListOptions, type Resource } from "../jsonapi.js";
import type { Platform, Schemas } from "../types.js";

/** Item kinds a review submission can carry, keyed by relationship name. */
export const SUBMISSION_ITEM_KINDS = {
  appStoreVersion: "appStoreVersions",
  appCustomProductPageVersion: "appCustomProductPageVersions",
  appStoreVersionExperiment: "appStoreVersionExperiments",
  appStoreVersionExperimentV2: "appStoreVersionExperiments",
  appEvent: "appEvents",
  appAssetLibraryImage: "appAssetLibraryImages",
  appAssetLibraryVideo: "appAssetLibraryVideos",
  backgroundAssetVersion: "backgroundAssetVersions",
  gameCenterAchievementVersion: "gameCenterAchievementVersions",
  gameCenterActivityVersion: "gameCenterActivityVersions",
  gameCenterChallengeVersion: "gameCenterChallengeVersions",
  gameCenterLeaderboardSetVersion: "gameCenterLeaderboardSetVersions",
  gameCenterLeaderboardVersion: "gameCenterLeaderboardVersions",
  inAppPurchaseVersion: "inAppPurchaseVersions",
  subscriptionVersion: "subscriptionVersions",
  subscriptionGroupVersion: "subscriptionGroupVersions",
} as const;
export type SubmissionItemKind = keyof typeof SUBMISSION_ITEM_KINDS;

/** States in which a submission can still take items and be submitted. */
const OPEN_STATES = ["READY_FOR_REVIEW"];

export class SubmissionsApi {
  constructor(private readonly client: AppStoreConnectClient) {}

  list(
    appId: string,
    options: ListOptions & { platform?: Platform | Platform[]; state?: string | string[] } = {},
  ) {
    return this.client.list(
      "/v1/reviewSubmissions",
      listQuery(options, { app: appId, platform: options.platform, state: options.state }),
      options,
    );
  }

  get(submissionId: string, options: { include?: string[] } = {}) {
    return this.client.get(
      `/v1/reviewSubmissions/${enc(submissionId)}`,
      listQuery({ include: options.include ?? ["items", "appStoreVersionForReview"] }),
    );
  }

  create(appId: string, platform: Platform) {
    const body: Schemas["ReviewSubmissionCreateRequest"] = {
      data: {
        type: "reviewSubmissions",
        attributes: { platform },
        relationships: { app: relOne("apps", appId) },
      },
    };
    return this.client.post<JsonApiDocument<Resource>>("/v1/reviewSubmissions", body, "reviewSubmissions.create");
  }

  listItems(submissionId: string, options: ListOptions = {}) {
    return this.client.list(
      `/v1/reviewSubmissions/${enc(submissionId)}/items`,
      listQuery({ include: ["appStoreVersion"], ...options }),
      options,
    );
  }

  addItem(submissionId: string, itemId: string, kind: SubmissionItemKind = "appStoreVersion") {
    const body = {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: relOne("reviewSubmissions", submissionId),
          [kind]: relOne(SUBMISSION_ITEM_KINDS[kind], itemId),
        },
      },
    } as Schemas["ReviewSubmissionItemCreateRequest"];
    return this.client.post("/v1/reviewSubmissionItems", body, "reviewSubmissionItems.create");
  }

  removeItem(itemId: string) {
    return this.client.delete(`/v1/reviewSubmissionItems/${enc(itemId)}`, undefined, "reviewSubmissionItems.delete");
  }

  submit(submissionId: string) {
    return this.update(submissionId, { submitted: true }, "reviewSubmissions.submit");
  }

  cancel(submissionId: string) {
    return this.update(submissionId, { canceled: true }, "reviewSubmissions.cancel");
  }

  private update(submissionId: string, attributes: { submitted?: boolean; canceled?: boolean }, op: string) {
    const body: Schemas["ReviewSubmissionUpdateRequest"] = {
      data: { type: "reviewSubmissions", id: submissionId, attributes: compact(attributes) },
    };
    return this.client.patch(`/v1/reviewSubmissions/${enc(submissionId)}`, body, op);
  }

  /**
   * Send one App Store version to App Review: reuse an open submission for
   * the app and platform (or create one), add the version, then submit.
   */
  async submitVersion(
    appId: string,
    versionId: string,
    platform: Platform,
  ): Promise<{ submissionId: string; reusedSubmission: boolean; itemId?: string; submission: unknown }> {
    this.client.assertWritable("reviewSubmissions.submitVersion");
    const open = (await this.client.get<JsonApiDocument<Resource[]>>("/v1/reviewSubmissions", {
      "filter[app]": appId,
      "filter[platform]": platform,
      "filter[state]": OPEN_STATES,
      limit: 5,
    })) as JsonApiDocument<Resource[]>;
    let submissionId = open.data[0]?.id;
    const reused = Boolean(submissionId);
    if (!submissionId) {
      const created = await this.create(appId, platform);
      submissionId = created.data.id;
    }

    let itemId: string | undefined;
    const items = (await this.client.get<JsonApiDocument<Resource[]>>(
      `/v1/reviewSubmissions/${enc(submissionId)}/items`,
      { include: ["appStoreVersion"], limit: 50 },
    )) as JsonApiDocument<Resource[]>;
    const existing = items.data.find(
      (item) =>
        (item.relationships?.appStoreVersion as { data?: { id?: string } } | undefined)?.data?.id === versionId,
    );
    if (existing) {
      itemId = existing.id;
    } else {
      const added = (await this.addItem(submissionId, versionId)) as JsonApiDocument<Resource>;
      itemId = added?.data?.id;
    }

    const submission = await this.submit(submissionId);
    return { submissionId, reusedSubmission: reused, itemId, submission };
  }
}
