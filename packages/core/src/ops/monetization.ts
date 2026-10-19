import { z } from "zod";
import type { InAppPurchaseCreateAttributes, InAppPurchaseUpdateAttributes } from "../resources/iap.js";
import type { SubscriptionCreateAttributes, SubscriptionUpdateAttributes } from "../resources/subscriptions.js";
import { appId, id, locale, page, pageOpts, pick, requireSome, str, strOrArr, type AscOp } from "./shared.js";

const iapId = id("In-app purchase");
const groupId = id("Subscription group");
const subscriptionId = id("Subscription");
const territory = strOrArr.optional().describe("Territory code(s), e.g. USA");
const period = z.enum(["ONE_WEEK", "ONE_MONTH", "TWO_MONTHS", "THREE_MONTHS", "SIX_MONTHS", "ONE_YEAR"]);

export const IAP_OPS: AscOp[] = [
  {
    name: "appstore_list_in_app_purchases",
    group: "iap",
    summary: "List in-app purchases of an app (filter by product id, type, state)",
    write: false,
    shape: {
      appId,
      productId: strOrArr.optional(),
      type: strOrArr.optional().describe("CONSUMABLE, NON_CONSUMABLE, NON_RENEWING_SUBSCRIPTION"),
      state: strOrArr.optional(),
      ...page,
    },
    run: (c, a) =>
      c.iap.list(str(a.appId, "appId"), {
        ...pageOpts(a),
        productId: a.productId as string | undefined,
        type: a.type as string | undefined,
        state: a.state as string | undefined,
      }),
  },
  {
    name: "appstore_get_in_app_purchase",
    group: "iap",
    summary: "Get an in-app purchase with its localizations",
    write: false,
    shape: { iapId },
    run: (c, a) => c.iap.get(str(a.iapId, "iapId")),
  },
  {
    name: "appstore_create_in_app_purchase",
    group: "iap",
    summary: "Create an in-app purchase (consumable, non-consumable or non-renewing)",
    write: true,
    shape: {
      appId,
      name: z.string().min(1).describe("Reference name"),
      productId: z.string().min(1),
      inAppPurchaseType: z.enum(["CONSUMABLE", "NON_CONSUMABLE", "NON_RENEWING_SUBSCRIPTION"]),
      reviewNote: z.string().optional(),
      familySharable: z.boolean().optional(),
    },
    run: (c, a) =>
      c.iap.create(
        str(a.appId, "appId"),
        pick<InAppPurchaseCreateAttributes>(a, ["name", "productId", "inAppPurchaseType", "reviewNote", "familySharable"]),
      ),
  },
  {
    name: "appstore_update_in_app_purchase",
    group: "iap",
    summary: "Update an in-app purchase's reference name, review note or family sharing",
    write: true,
    shape: {
      iapId,
      name: z.string().optional(),
      reviewNote: z.string().optional(),
      familySharable: z.boolean().optional(),
    },
    run: (c, a) => {
      const attrs = pick<InAppPurchaseUpdateAttributes>(a, ["name", "reviewNote", "familySharable"]);
      requireSome(attrs, "field");
      return c.iap.update(str(a.iapId, "iapId"), attrs);
    },
  },
  {
    name: "appstore_delete_in_app_purchase",
    group: "iap",
    summary: "Delete an in-app purchase that was never approved",
    write: true,
    shape: { iapId },
    run: (c, a) => c.iap.delete(str(a.iapId, "iapId")),
  },
  {
    name: "appstore_list_iap_localizations",
    group: "iap",
    summary: "List display names and descriptions of an in-app purchase",
    write: false,
    shape: { iapId, ...page },
    run: (c, a) => c.iap.listLocalizations(str(a.iapId, "iapId"), pageOpts(a)),
  },
  {
    name: "appstore_create_iap_localization",
    group: "iap",
    summary: "Add a display name and description for a locale",
    write: true,
    shape: { iapId, locale, name: z.string().min(1).max(30), description: z.string().max(45).optional() },
    run: (c, a) =>
      c.iap.createLocalization(str(a.iapId, "iapId"), {
        locale: str(a.locale, "locale"),
        name: str(a.name, "name"),
        description: a.description as string | undefined,
      }),
  },
  {
    name: "appstore_update_iap_localization",
    group: "iap",
    summary: "Update an in-app purchase display name or description",
    write: true,
    shape: { localizationId: id("IAP localization"), name: z.string().max(30).optional(), description: z.string().max(45).optional() },
    run: (c, a) => {
      const attrs = pick<{ name?: string; description?: string }>(a, ["name", "description"]);
      requireSome(attrs, "field");
      return c.iap.updateLocalization(str(a.localizationId, "localizationId"), attrs);
    },
  },
  {
    name: "appstore_delete_iap_localization",
    group: "iap",
    summary: "Delete an in-app purchase localization",
    write: true,
    shape: { localizationId: id("IAP localization") },
    run: (c, a) => c.iap.deleteLocalization(str(a.localizationId, "localizationId")),
  },
  {
    name: "appstore_list_iap_price_points",
    group: "iap",
    summary: "List price points available for an in-app purchase",
    write: false,
    shape: { iapId, territory, ...page },
    run: (c, a) => c.iap.listPricePoints(str(a.iapId, "iapId"), { ...pageOpts(a), territory: a.territory as string | undefined }),
  },
  {
    name: "appstore_get_iap_price_schedule",
    group: "iap",
    summary: "Get the price schedule (base territory, manual and automatic prices) of an in-app purchase",
    write: false,
    shape: { iapId },
    run: (c, a) => c.iap.getPriceSchedule(str(a.iapId, "iapId")),
  },
];

export const SUBSCRIPTION_OPS: AscOp[] = [
  {
    name: "appstore_list_subscription_groups",
    group: "subscriptions",
    summary: "List auto-renewable subscription groups of an app",
    write: false,
    shape: { appId, ...page },
    run: (c, a) => c.subscriptions.listGroups(str(a.appId, "appId"), pageOpts(a)),
  },
  {
    name: "appstore_get_subscription_group",
    group: "subscriptions",
    summary: "Get a subscription group with its subscriptions and localizations",
    write: false,
    shape: { groupId },
    run: (c, a) => c.subscriptions.getGroup(str(a.groupId, "groupId")),
  },
  {
    name: "appstore_create_subscription_group",
    group: "subscriptions",
    summary: "Create a subscription group",
    write: true,
    shape: { appId, referenceName: z.string().min(1) },
    run: (c, a) => c.subscriptions.createGroup(str(a.appId, "appId"), str(a.referenceName, "referenceName")),
  },
  {
    name: "appstore_update_subscription_group",
    group: "subscriptions",
    summary: "Rename a subscription group (reference name)",
    write: true,
    shape: { groupId, referenceName: z.string().min(1) },
    run: (c, a) => c.subscriptions.updateGroup(str(a.groupId, "groupId"), str(a.referenceName, "referenceName")),
  },
  {
    name: "appstore_list_subscription_group_localizations",
    group: "subscriptions",
    summary: "List display names of a subscription group per locale",
    write: false,
    shape: { groupId, ...page },
    run: (c, a) => c.subscriptions.listGroupLocalizations(str(a.groupId, "groupId"), pageOpts(a)),
  },
  {
    name: "appstore_create_subscription_group_localization",
    group: "subscriptions",
    summary: "Add a group display name (and custom app name) for a locale",
    write: true,
    shape: { groupId, locale, name: z.string().min(1), customAppName: z.string().optional() },
    run: (c, a) =>
      c.subscriptions.createGroupLocalization(str(a.groupId, "groupId"), {
        locale: str(a.locale, "locale"),
        name: str(a.name, "name"),
        customAppName: a.customAppName as string | undefined,
      }),
  },
  {
    name: "appstore_list_subscriptions",
    group: "subscriptions",
    summary: "List subscriptions in a group",
    write: false,
    shape: { groupId, productId: strOrArr.optional(), state: strOrArr.optional(), ...page },
    run: (c, a) =>
      c.subscriptions.list(str(a.groupId, "groupId"), {
        ...pageOpts(a),
        productId: a.productId as string | undefined,
        state: a.state as string | undefined,
      }),
  },
  {
    name: "appstore_get_subscription",
    group: "subscriptions",
    summary: "Get a subscription with its localizations",
    write: false,
    shape: { subscriptionId },
    run: (c, a) => c.subscriptions.get(str(a.subscriptionId, "subscriptionId")),
  },
  {
    name: "appstore_create_subscription",
    group: "subscriptions",
    summary: "Create an auto-renewable subscription in a group",
    write: true,
    shape: {
      groupId,
      name: z.string().min(1).describe("Reference name"),
      productId: z.string().min(1),
      subscriptionPeriod: period.optional(),
      groupLevel: z.number().int().min(1).optional().describe("Rank in the group, 1 = highest"),
      familySharable: z.boolean().optional(),
      reviewNote: z.string().optional(),
    },
    run: (c, a) =>
      c.subscriptions.create(
        str(a.groupId, "groupId"),
        pick<SubscriptionCreateAttributes>(a, [
          "name",
          "productId",
          "subscriptionPeriod",
          "groupLevel",
          "familySharable",
          "reviewNote",
        ]),
      ),
  },
  {
    name: "appstore_update_subscription",
    group: "subscriptions",
    summary: "Update a subscription's name, period, level, family sharing or review note",
    write: true,
    shape: {
      subscriptionId,
      name: z.string().optional(),
      subscriptionPeriod: period.optional(),
      groupLevel: z.number().int().min(1).optional(),
      familySharable: z.boolean().optional(),
      reviewNote: z.string().optional(),
    },
    run: (c, a) => {
      const attrs = pick<SubscriptionUpdateAttributes>(a, [
        "name",
        "subscriptionPeriod",
        "groupLevel",
        "familySharable",
        "reviewNote",
      ]);
      requireSome(attrs, "field");
      return c.subscriptions.update(str(a.subscriptionId, "subscriptionId"), attrs);
    },
  },
  {
    name: "appstore_delete_subscription",
    group: "subscriptions",
    summary: "Delete a subscription that was never approved",
    write: true,
    shape: { subscriptionId },
    run: (c, a) => c.subscriptions.delete(str(a.subscriptionId, "subscriptionId")),
  },
  {
    name: "appstore_list_subscription_localizations",
    group: "subscriptions",
    summary: "List display names and descriptions of a subscription",
    write: false,
    shape: { subscriptionId, ...page },
    run: (c, a) => c.subscriptions.listLocalizations(str(a.subscriptionId, "subscriptionId"), pageOpts(a)),
  },
  {
    name: "appstore_create_subscription_localization",
    group: "subscriptions",
    summary: "Add a subscription display name and description for a locale",
    write: true,
    shape: { subscriptionId, locale, name: z.string().min(1).max(30), description: z.string().max(45).optional() },
    run: (c, a) =>
      c.subscriptions.createLocalization(str(a.subscriptionId, "subscriptionId"), {
        locale: str(a.locale, "locale"),
        name: str(a.name, "name"),
        description: a.description as string | undefined,
      }),
  },
  {
    name: "appstore_update_subscription_localization",
    group: "subscriptions",
    summary: "Update a subscription display name or description",
    write: true,
    shape: {
      localizationId: id("Subscription localization"),
      name: z.string().max(30).optional(),
      description: z.string().max(45).optional(),
    },
    run: (c, a) => {
      const attrs = pick<{ name?: string; description?: string }>(a, ["name", "description"]);
      requireSome(attrs, "field");
      return c.subscriptions.updateLocalization(str(a.localizationId, "localizationId"), attrs);
    },
  },
  {
    name: "appstore_delete_subscription_localization",
    group: "subscriptions",
    summary: "Delete a subscription localization",
    write: true,
    shape: { localizationId: id("Subscription localization") },
    run: (c, a) => c.subscriptions.deleteLocalization(str(a.localizationId, "localizationId")),
  },
  {
    name: "appstore_list_subscription_prices",
    group: "subscriptions",
    summary: "List current and scheduled prices of a subscription per territory",
    write: false,
    shape: { subscriptionId, territory, ...page },
    run: (c, a) =>
      c.subscriptions.listPrices(str(a.subscriptionId, "subscriptionId"), {
        ...pageOpts(a),
        territory: a.territory as string | undefined,
      }),
  },
  {
    name: "appstore_list_subscription_price_points",
    group: "subscriptions",
    summary: "List price points available for a subscription",
    write: false,
    shape: { subscriptionId, territory, ...page },
    run: (c, a) =>
      c.subscriptions.listPricePoints(str(a.subscriptionId, "subscriptionId"), {
        ...pageOpts(a),
        territory: a.territory as string | undefined,
      }),
  },
];

export const PRICING_OPS: AscOp[] = [
  {
    name: "appstore_list_app_price_points",
    group: "pricing",
    summary: "List app price points (customer price and proceeds) for a territory",
    write: false,
    shape: { appId, territory, ...page },
    run: (c, a) =>
      c.apps.listPricePoints(str(a.appId, "appId"), { ...pageOpts(a), territory: a.territory as string | undefined }),
  },
  {
    name: "appstore_get_app_price_schedule",
    group: "pricing",
    summary: "Get the app's price schedule (base territory, manual and automatic prices)",
    write: false,
    shape: { appId },
    run: (c, a) => c.apps.getPriceSchedule(str(a.appId, "appId")),
  },
];
