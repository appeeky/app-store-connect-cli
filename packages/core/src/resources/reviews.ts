import type { AppStoreConnectClient } from "../client.js";
import { enc, findIncluded, listQuery, relId, relOne, type ListOptions, type Resource } from "../jsonapi.js";
import type { Schemas } from "../types.js";

export interface CustomerReviewFilters {
  /** One or more star ratings (1-5). */
  rating?: number | number[];
  /** ISO 3166-1 alpha-3 territory codes, e.g. USA. */
  territory?: string | string[];
  /** true: only reviews with a published response; false: only unanswered. */
  hasResponse?: boolean;
  /** createdDate, -createdDate (default), rating, -rating */
  sort?: string;
}

export interface ReviewsSummary {
  appId: string;
  sampled: number;
  totalAvailable?: number;
  truncated: boolean;
  averageRating: number | null;
  byRating: Record<"1" | "2" | "3" | "4" | "5", number>;
  byTerritory: Record<string, number>;
  unanswered: number;
  newest?: string;
  oldest?: string;
  recentLowRatings: Array<{ id: string; rating: number; title?: string; body?: string; territory?: string; createdDate?: string }>;
}

export class CustomerReviewsApi {
  constructor(private readonly client: AppStoreConnectClient) {}

  list(appId: string, options: ListOptions & CustomerReviewFilters = {}) {
    const query = listQuery(
      { sort: "-createdDate", include: ["response"], ...options },
      {
        rating: Array.isArray(options.rating) ? options.rating.map(String) : options.rating?.toString(),
        territory: options.territory,
      },
    );
    if (options.hasResponse !== undefined) query["exists[publishedResponse]"] = options.hasResponse;
    return this.client.list(`/v1/apps/${enc(appId)}/customerReviews`, query, options);
  }

  get(reviewId: string) {
    return this.client.get(`/v1/customerReviews/${enc(reviewId)}`, { include: ["response"] });
  }

  getResponse(reviewId: string) {
    return this.client.get(`/v1/customerReviews/${enc(reviewId)}/response`);
  }

  /** Publish (or replace) the developer response to a review. */
  respond(reviewId: string, responseBody: string) {
    const body: Schemas["CustomerReviewResponseV1CreateRequest"] = {
      data: {
        type: "customerReviewResponses",
        attributes: { responseBody },
        relationships: { review: relOne("customerReviews", reviewId) },
      },
    };
    return this.client.post("/v1/customerReviewResponses", body, "customerReviewResponses.create");
  }

  deleteResponse(responseId: string) {
    return this.client.delete(
      `/v1/customerReviewResponses/${enc(responseId)}`,
      undefined,
      "customerReviewResponses.delete",
    );
  }

  /**
   * Read up to `maxReviews` recent reviews and summarize them: rating
   * distribution, average, territories, unanswered count and the latest
   * 1-2 star reviews.
   */
  async summary(
    appId: string,
    options: { maxReviews?: number; territory?: string | string[]; lowRatingSamples?: number } = {},
  ): Promise<ReviewsSummary> {
    const maxReviews = options.maxReviews ?? 500;
    const collected = await this.client.paginate<Resource>(
      `/v1/apps/${enc(appId)}/customerReviews`,
      listQuery({ sort: "-createdDate", include: ["response"], limit: 200 }, { territory: options.territory }),
      { maxItems: maxReviews },
    );
    const byRating: ReviewsSummary["byRating"] = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    const byTerritory: Record<string, number> = {};
    let sum = 0;
    let unanswered = 0;
    const low: ReviewsSummary["recentLowRatings"] = [];
    for (const review of collected.data) {
      const a = review.attributes ?? {};
      const rating = Number(a.rating);
      if (rating >= 1 && rating <= 5) {
        byRating[String(rating) as keyof typeof byRating] += 1;
        sum += rating;
      }
      const territory = typeof a.territory === "string" ? a.territory : "unknown";
      byTerritory[territory] = (byTerritory[territory] ?? 0) + 1;
      const responseId = relId(review, "response");
      const response = findIncluded({ included: collected.included }, "customerReviewResponses", responseId);
      if (!responseId && !response) unanswered += 1;
      if (rating <= 2 && low.length < (options.lowRatingSamples ?? 5)) {
        low.push({
          id: review.id,
          rating,
          title: a.title as string | undefined,
          body: a.body as string | undefined,
          territory,
          createdDate: a.createdDate as string | undefined,
        });
      }
    }
    const rated = Object.values(byRating).reduce((x, y) => x + y, 0);
    return {
      appId,
      sampled: collected.data.length,
      totalAvailable: collected.meta.total,
      truncated: collected.meta.truncated,
      averageRating: rated ? Math.round((sum / rated) * 100) / 100 : null,
      byRating,
      byTerritory,
      unanswered,
      newest: collected.data[0]?.attributes?.createdDate as string | undefined,
      oldest: collected.data[collected.data.length - 1]?.attributes?.createdDate as string | undefined,
      recentLowRatings: low,
    };
  }
}
