import type { AppStoreConnectClient } from "../client.js";
import { compact, enc, listQuery, relOne, type ListOptions } from "../jsonapi.js";
import type { AttributesOf, Schemas } from "../types.js";

export type SubscriptionCreateAttributes = AttributesOf<"SubscriptionCreateRequest">;
export type SubscriptionUpdateAttributes = AttributesOf<"SubscriptionUpdateRequest">;

export class SubscriptionsApi {
  constructor(private readonly client: AppStoreConnectClient) {}

  // ── Groups ───────────────────────────────────────────────────
  listGroups(appId: string, options: ListOptions & { referenceName?: string } = {}) {
    return this.client.list(
      `/v1/apps/${enc(appId)}/subscriptionGroups`,
      listQuery(options, { referenceName: options.referenceName }),
      options,
    );
  }

  getGroup(groupId: string) {
    return this.client.get(`/v1/subscriptionGroups/${enc(groupId)}`, {
      include: ["subscriptions", "subscriptionGroupLocalizations"],
    });
  }

  createGroup(appId: string, referenceName: string) {
    const body: Schemas["SubscriptionGroupCreateRequest"] = {
      data: {
        type: "subscriptionGroups",
        attributes: { referenceName },
        relationships: { app: relOne("apps", appId) },
      },
    };
    return this.client.post("/v1/subscriptionGroups", body, "subscriptionGroups.create");
  }

  updateGroup(groupId: string, referenceName: string) {
    const body: Schemas["SubscriptionGroupUpdateRequest"] = {
      data: { type: "subscriptionGroups", id: groupId, attributes: { referenceName } },
    };
    return this.client.patch(`/v1/subscriptionGroups/${enc(groupId)}`, body, "subscriptionGroups.update");
  }

  deleteGroup(groupId: string) {
    return this.client.delete(`/v1/subscriptionGroups/${enc(groupId)}`, undefined, "subscriptionGroups.delete");
  }

  listGroupLocalizations(groupId: string, options: ListOptions = {}) {
    return this.client.list(
      `/v1/subscriptionGroups/${enc(groupId)}/subscriptionGroupLocalizations`,
      listQuery(options),
      options,
    );
  }

  createGroupLocalization(groupId: string, input: { locale: string; name: string; customAppName?: string }) {
    const body: Schemas["SubscriptionGroupLocalizationCreateRequest"] = {
      data: {
        type: "subscriptionGroupLocalizations",
        attributes: compact(input) as { locale: string; name: string; customAppName?: string },
        relationships: { subscriptionGroup: relOne("subscriptionGroups", groupId) },
      },
    };
    return this.client.post("/v1/subscriptionGroupLocalizations", body, "subscriptionGroupLocalizations.create");
  }

  updateGroupLocalization(localizationId: string, attributes: { name?: string; customAppName?: string }) {
    const body: Schemas["SubscriptionGroupLocalizationUpdateRequest"] = {
      data: { type: "subscriptionGroupLocalizations", id: localizationId, attributes: compact(attributes) },
    };
    return this.client.patch(
      `/v1/subscriptionGroupLocalizations/${enc(localizationId)}`,
      body,
      "subscriptionGroupLocalizations.update",
    );
  }

  // ── Subscriptions ────────────────────────────────────────────
  list(groupId: string, options: ListOptions & { productId?: string | string[]; state?: string | string[] } = {}) {
    return this.client.list(
      `/v1/subscriptionGroups/${enc(groupId)}/subscriptions`,
      listQuery(options, { productId: options.productId, state: options.state }),
      options,
    );
  }

  get(subscriptionId: string) {
    return this.client.get(`/v1/subscriptions/${enc(subscriptionId)}`, {
      include: ["subscriptionLocalizations", "group"],
    });
  }

  create(groupId: string, attributes: SubscriptionCreateAttributes) {
    const body: Schemas["SubscriptionCreateRequest"] = {
      data: {
        type: "subscriptions",
        attributes: compact(attributes) as SubscriptionCreateAttributes,
        relationships: { group: relOne("subscriptionGroups", groupId) },
      },
    };
    return this.client.post("/v1/subscriptions", body, "subscriptions.create");
  }

  update(subscriptionId: string, attributes: SubscriptionUpdateAttributes) {
    const body: Schemas["SubscriptionUpdateRequest"] = {
      data: { type: "subscriptions", id: subscriptionId, attributes: compact(attributes) },
    };
    return this.client.patch(`/v1/subscriptions/${enc(subscriptionId)}`, body, "subscriptions.update");
  }

  delete(subscriptionId: string) {
    return this.client.delete(`/v1/subscriptions/${enc(subscriptionId)}`, undefined, "subscriptions.delete");
  }

  listLocalizations(subscriptionId: string, options: ListOptions = {}) {
    return this.client.list(
      `/v1/subscriptions/${enc(subscriptionId)}/subscriptionLocalizations`,
      listQuery(options),
      options,
    );
  }

  createLocalization(subscriptionId: string, input: { locale: string; name: string; description?: string }) {
    const body: Schemas["SubscriptionLocalizationCreateRequest"] = {
      data: {
        type: "subscriptionLocalizations",
        attributes: compact(input) as { locale: string; name: string; description?: string },
        relationships: { subscription: relOne("subscriptions", subscriptionId) },
      },
    };
    return this.client.post("/v1/subscriptionLocalizations", body, "subscriptionLocalizations.create");
  }

  updateLocalization(localizationId: string, attributes: { name?: string; description?: string }) {
    const body: Schemas["SubscriptionLocalizationUpdateRequest"] = {
      data: { type: "subscriptionLocalizations", id: localizationId, attributes: compact(attributes) },
    };
    return this.client.patch(
      `/v1/subscriptionLocalizations/${enc(localizationId)}`,
      body,
      "subscriptionLocalizations.update",
    );
  }

  deleteLocalization(localizationId: string) {
    return this.client.delete(
      `/v1/subscriptionLocalizations/${enc(localizationId)}`,
      undefined,
      "subscriptionLocalizations.delete",
    );
  }

  /** Current and scheduled prices, with price point and territory included. */
  listPrices(subscriptionId: string, options: ListOptions & { territory?: string | string[] } = {}) {
    return this.client.list(
      `/v1/subscriptions/${enc(subscriptionId)}/prices`,
      listQuery({ include: ["subscriptionPricePoint", "territory"], ...options }, { territory: options.territory }),
      options,
    );
  }

  listPricePoints(subscriptionId: string, options: ListOptions & { territory?: string | string[] } = {}) {
    return this.client.list(
      `/v1/subscriptions/${enc(subscriptionId)}/pricePoints`,
      listQuery({ include: ["territory"], ...options }, { territory: options.territory }),
      options,
    );
  }
}
