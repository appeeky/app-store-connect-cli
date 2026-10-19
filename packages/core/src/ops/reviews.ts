import { z } from "zod";
import { appId, id, page, pageOpts, str, strOrArr, type AscOp } from "./shared.js";

const rating = z.number().int().min(1).max(5);

export const REVIEW_OPS: AscOp[] = [
  {
    name: "appstore_list_customer_reviews",
    group: "reviews",
    summary: "List App Store customer reviews (filter by rating, territory, answered or not)",
    write: false,
    shape: {
      appId,
      rating: z.union([rating, z.array(rating)]).optional().describe("Star rating(s) 1-5"),
      territory: strOrArr.optional().describe("ISO 3166-1 alpha-3 code(s), e.g. USA, DEU"),
      hasResponse: z.boolean().optional().describe("true: answered only; false: unanswered only"),
      sort: z.enum(["createdDate", "-createdDate", "rating", "-rating"]).optional(),
      ...page,
    },
    run: (c, a) =>
      c.reviews.list(str(a.appId, "appId"), {
        ...pageOpts(a),
        rating: a.rating as number | number[] | undefined,
        territory: a.territory as string | undefined,
        hasResponse: a.hasResponse as boolean | undefined,
        sort: a.sort as string | undefined,
      }),
  },
  {
    name: "appstore_get_customer_review",
    group: "reviews",
    summary: "Get one customer review with its developer response",
    write: false,
    shape: { reviewId: id("Customer review") },
    run: (c, a) => c.reviews.get(str(a.reviewId, "reviewId")),
  },
  {
    name: "appstore_get_review_response",
    group: "reviews",
    summary: "Get the developer response to a review (state PENDING_PUBLISH or PUBLISHED)",
    write: false,
    shape: { reviewId: id("Customer review") },
    run: (c, a) => c.reviews.getResponse(str(a.reviewId, "reviewId")),
  },
  {
    name: "appstore_respond_to_review",
    group: "reviews",
    summary: "Publish a developer response to a review (replaces an existing one)",
    write: true,
    shape: { reviewId: id("Customer review"), responseBody: z.string().min(1).max(5970) },
    run: (c, a) => c.reviews.respond(str(a.reviewId, "reviewId"), str(a.responseBody, "responseBody")),
  },
  {
    name: "appstore_delete_review_response",
    group: "reviews",
    summary: "Delete a developer response",
    write: true,
    shape: { responseId: id("Customer review response") },
    run: (c, a) => c.reviews.deleteResponse(str(a.responseId, "responseId")),
  },
  {
    name: "appstore_reviews_summary",
    group: "reviews",
    summary: "Summarize recent reviews: rating distribution, average, territories, unanswered, latest low ratings",
    write: false,
    shape: {
      appId,
      maxReviews: z.number().int().min(1).max(5000).optional().describe("Reviews to read (default 500)"),
      territory: strOrArr.optional(),
    },
    run: (c, a) =>
      c.reviews.summary(str(a.appId, "appId"), {
        maxReviews: a.maxReviews as number | undefined,
        territory: a.territory as string | undefined,
      }),
  },
];
