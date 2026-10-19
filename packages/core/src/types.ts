/**
 * Friendly aliases over the generated App Store Connect OpenAPI types.
 * Everything Apple defines is reachable through `Schemas["Name"]`.
 */
import type { components, paths, operations } from "./generated/app-store-connect.js";

export type { components, paths, operations };
export type Schemas = components["schemas"];

/** `data.attributes` of a request body schema. */
export type AttributesOf<K extends keyof Schemas> = Schemas[K] extends { data: { attributes?: infer A } }
  ? NonNullable<A>
  : never;

export type Platform = Schemas["Platform"];
export type BundleIdPlatform = Schemas["BundleIdPlatform"];
export type ScreenshotDisplayType = Schemas["ScreenshotDisplayType"];
export type PreviewType = Schemas["PreviewType"];
export type UserRole = Schemas["UserRole"];
export type UploadOperation = Schemas["UploadOperation"];

export type App = Schemas["App"];
export type AppsResponse = Schemas["AppsResponse"];
export type AppResponse = Schemas["AppResponse"];
export type AppStoreVersion = Schemas["AppStoreVersion"];
export type AppStoreVersionResponse = Schemas["AppStoreVersionResponse"];
export type AppStoreVersionsResponse = Schemas["AppStoreVersionsResponse"];
export type AppStoreVersionLocalization = Schemas["AppStoreVersionLocalization"];
export type Build = Schemas["Build"];
export type BuildsResponse = Schemas["BuildsResponse"];
export type BuildResponse = Schemas["BuildResponse"];
export type ReviewSubmission = Schemas["ReviewSubmission"];
export type ReviewSubmissionResponse = Schemas["ReviewSubmissionResponse"];
export type CustomerReview = Schemas["CustomerReview"];
export type CustomerReviewsResponse = Schemas["CustomerReviewsResponse"];
export type BetaGroup = Schemas["BetaGroup"];
export type BetaTester = Schemas["BetaTester"];
export type AppScreenshot = Schemas["AppScreenshot"];
export type AppPreview = Schemas["AppPreview"];
export type InAppPurchaseV2 = Schemas["InAppPurchaseV2"];
export type Subscription = Schemas["Subscription"];
export type SubscriptionGroup = Schemas["SubscriptionGroup"];
export type User = Schemas["User"];
export type Profile = Schemas["Profile"];
