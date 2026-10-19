import type { AppStoreConnectClient } from "../client.js";
import { compact, enc, listQuery, relOne, type ListOptions } from "../jsonapi.js";
import type { AttributesOf, Schemas } from "../types.js";

export type InAppPurchaseCreateAttributes = AttributesOf<"InAppPurchaseV2CreateRequest">;
export type InAppPurchaseUpdateAttributes = AttributesOf<"InAppPurchaseV2UpdateRequest">;
export type InAppPurchaseType = InAppPurchaseCreateAttributes["inAppPurchaseType"];

export class InAppPurchasesApi {
  constructor(private readonly client: AppStoreConnectClient) {}

  list(
    appId: string,
    options: ListOptions & { productId?: string | string[]; type?: string | string[]; state?: string | string[] } = {},
  ) {
    return this.client.list(
      `/v1/apps/${enc(appId)}/inAppPurchasesV2`,
      listQuery(options, { productId: options.productId, inAppPurchaseType: options.type, state: options.state }),
      options,
    );
  }

  get(iapId: string) {
    return this.client.get(`/v2/inAppPurchases/${enc(iapId)}`, {
      include: ["inAppPurchaseLocalizations", "iapPriceSchedule"],
    });
  }

  create(appId: string, attributes: InAppPurchaseCreateAttributes) {
    const body: Schemas["InAppPurchaseV2CreateRequest"] = {
      data: {
        type: "inAppPurchases",
        attributes: compact(attributes) as InAppPurchaseCreateAttributes,
        relationships: { app: relOne("apps", appId) },
      },
    };
    return this.client.post("/v2/inAppPurchases", body, "inAppPurchases.create");
  }

  update(iapId: string, attributes: InAppPurchaseUpdateAttributes) {
    const body: Schemas["InAppPurchaseV2UpdateRequest"] = {
      data: { type: "inAppPurchases", id: iapId, attributes: compact(attributes) },
    };
    return this.client.patch(`/v2/inAppPurchases/${enc(iapId)}`, body, "inAppPurchases.update");
  }

  delete(iapId: string) {
    return this.client.delete(`/v2/inAppPurchases/${enc(iapId)}`, undefined, "inAppPurchases.delete");
  }

  listLocalizations(iapId: string, options: ListOptions = {}) {
    return this.client.list(`/v2/inAppPurchases/${enc(iapId)}/inAppPurchaseLocalizations`, listQuery(options), options);
  }

  createLocalization(iapId: string, input: { locale: string; name: string; description?: string }) {
    const body: Schemas["InAppPurchaseLocalizationCreateRequest"] = {
      data: {
        type: "inAppPurchaseLocalizations",
        attributes: compact(input) as { locale: string; name: string; description?: string },
        relationships: { inAppPurchaseV2: relOne("inAppPurchases", iapId) },
      },
    };
    return this.client.post("/v1/inAppPurchaseLocalizations", body, "inAppPurchaseLocalizations.create");
  }

  updateLocalization(localizationId: string, attributes: { name?: string; description?: string }) {
    const body: Schemas["InAppPurchaseLocalizationUpdateRequest"] = {
      data: { type: "inAppPurchaseLocalizations", id: localizationId, attributes: compact(attributes) },
    };
    return this.client.patch(
      `/v1/inAppPurchaseLocalizations/${enc(localizationId)}`,
      body,
      "inAppPurchaseLocalizations.update",
    );
  }

  deleteLocalization(localizationId: string) {
    return this.client.delete(
      `/v1/inAppPurchaseLocalizations/${enc(localizationId)}`,
      undefined,
      "inAppPurchaseLocalizations.delete",
    );
  }

  listPricePoints(iapId: string, options: ListOptions & { territory?: string | string[] } = {}) {
    return this.client.list(
      `/v2/inAppPurchases/${enc(iapId)}/pricePoints`,
      listQuery({ include: ["territory"], ...options }, { territory: options.territory }),
      options,
    );
  }

  getPriceSchedule(iapId: string) {
    return this.client.get(`/v2/inAppPurchases/${enc(iapId)}/iapPriceSchedule`, {
      include: ["baseTerritory", "manualPrices", "automaticPrices"],
    });
  }
}
