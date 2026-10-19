import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CAPABILITIES, searchCapabilities } from "./capabilities.js";
import { ReadOnlyError, ValidationError } from "./errors.js";
import { ASC_OPS, getOp, invokeOp, listOps, opIsWrite } from "./ops.js";
import { parseReport } from "./resources/reports.js";
import { json, testClient } from "./test-utils.js";

describe("ops registry", () => {
  it("has unique, prefixed names and matches capabilities", () => {
    const names = ASC_OPS.map((op) => op.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => /^appstore_[a-z0-9_]+$/.test(n))).toBe(true);
    expect(CAPABILITIES.length).toBe(ASC_OPS.length);
    expect(ASC_OPS.length).toBeGreaterThan(150);
  });

  it("gives every op a group, summary and a valid zod shape", () => {
    for (const op of ASC_OPS) {
      expect(op.group, op.name).toMatch(/^[a-z]+$/);
      expect(op.summary.length, op.name).toBeGreaterThan(10);
      expect(() => z.object(op.shape), op.name).not.toThrow();
      for (const [key, schema] of Object.entries(op.shape)) {
        expect(schema instanceof z.ZodType, `${op.name}.${key}`).toBe(true);
      }
    }
  });

  it("marks mutating ops as writes", () => {
    const verbs = /^appstore_(create|update|delete|add|remove|submit|cancel|attach|detach|expire|invite|respond|release|reorder|upload|register|unregister|set|send)_/;
    for (const op of ASC_OPS) {
      if (verbs.test(op.name) && op.group !== "meta") expect(op.write, op.name).toBe(true);
      if (/^appstore_(list|get|find)_/.test(op.name)) expect(op.write, op.name).toBe(false);
    }
  });

  it("treats appstore_request as a write unless the method is GET", () => {
    const op = getOp("appstore_request");
    expect(opIsWrite(op, { method: "GET", path: "/v1/apps" })).toBe(false);
    expect(opIsWrite(op, {})).toBe(false);
    expect(opIsWrite(op, { method: "post", path: "/v1/apps" })).toBe(true);
    expect(opIsWrite(getOp("appstore_respond_to_review"), {})).toBe(true);
  });

  it("finds ops and capabilities by query", () => {
    expect(listOps("testflight").length).toBeGreaterThan(10);
    expect(listOps("review").some((op) => op.name === "appstore_respond_to_review")).toBe(true);
    expect(searchCapabilities("").length).toBe(CAPABILITIES.length);
    expect(() => getOp("appstore_nope")).toThrow(ValidationError);
  });

  it("validates arguments before calling Apple", async () => {
    const { client, calls } = testClient(() => json({ data: [] }));
    await expect(invokeOp(client, "appstore_get_app", {})).rejects.toThrow(/Invalid arguments for appstore_get_app: appId/);
    await expect(invokeOp(client, "appstore_list_customer_reviews", { appId: "1", rating: 9 })).rejects.toThrow(ValidationError);
    expect(calls).toHaveLength(0);
  });
});

describe("read-only enforcement through ops", () => {
  const writes: Array<[string, Record<string, unknown>]> = [
    ["appstore_respond_to_review", { reviewId: "r", responseBody: "Thanks" }],
    ["appstore_create_version", { appId: "1", platform: "IOS", versionString: "1.0" }],
    ["appstore_submit_version", { appId: "1", versionId: "v" }],
    ["appstore_add_builds_to_beta_group", { groupId: "g", buildIds: ["b"] }],
    ["appstore_update_phased_release", { phasedReleaseId: "p", state: "PAUSED" }],
    ["appstore_invite_user", { email: "a@b.co", firstName: "A", lastName: "B", roles: ["DEVELOPER"] }],
    ["appstore_request", { method: "POST", path: "/v1/betaGroups", body: {} }],
  ];

  it.each(writes)("%s is refused without a network call", async (name, args) => {
    const { client, calls } = testClient(() => json({ data: [] }), { readOnly: true });
    await expect(invokeOp(client, name, args)).rejects.toBeInstanceOf(ReadOnlyError);
    expect(calls).toHaveLength(0);
  });

  it("still allows GET through appstore_request", async () => {
    const { client, calls } = testClient(() => json({ data: [] }), { readOnly: true });
    await invokeOp(client, "appstore_request", { path: "/v1/apps", query: { limit: 1 } });
    expect(calls[0]!.url).toBe("https://api.appstoreconnect.apple.com/v1/apps?limit=1");
    await expect(invokeOp(client, "appstore_request", { path: "https://example.com/v1/apps" })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("request bodies", () => {
  it("creates a version with JSON:API relationships", async () => {
    const { client, calls } = testClient(() => json({ data: { type: "appStoreVersions", id: "v1" } }, 201));
    await invokeOp(client, "appstore_create_version", {
      appId: "123",
      platform: "IOS",
      versionString: "2.0",
      releaseType: "MANUAL",
      buildId: "b9",
    });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toMatch(/\/v1\/appStoreVersions$/);
    expect(calls[0]!.body).toEqual({
      data: {
        type: "appStoreVersions",
        attributes: { platform: "IOS", versionString: "2.0", releaseType: "MANUAL" },
        relationships: { app: { data: { type: "apps", id: "123" } }, build: { data: { type: "builds", id: "b9" } } },
      },
    });
  });

  it("sends only changed localization fields", async () => {
    const { client, calls } = testClient(() => json({ data: { type: "appStoreVersionLocalizations", id: "l1" } }));
    await invokeOp(client, "appstore_update_version_localization", { localizationId: "l1", whatsNew: "Bug fixes" });
    expect(calls[0]!.body).toEqual({
      data: { type: "appStoreVersionLocalizations", id: "l1", attributes: { whatsNew: "Bug fixes" } },
    });
    await expect(invokeOp(client, "appstore_update_version_localization", { localizationId: "l1" })).rejects.toThrow(
      /at least one field/,
    );
  });

  it("responds to a review", async () => {
    const { client, calls } = testClient(() => json({ data: { type: "customerReviewResponses", id: "resp" } }, 201));
    await invokeOp(client, "appstore_respond_to_review", { reviewId: "rev1", responseBody: "Thanks for the note!" });
    expect(calls[0]!.body).toEqual({
      data: {
        type: "customerReviewResponses",
        attributes: { responseBody: "Thanks for the note!" },
        relationships: { review: { data: { type: "customerReviews", id: "rev1" } } },
      },
    });
  });

  it("adds testers to a group with a linkage body", async () => {
    const { client, calls } = testClient(() => new Response(null, { status: 204 }));
    const result = await invokeOp(client, "appstore_add_testers_to_beta_group", { groupId: "g1", testerIds: ["t1", "t2"] });
    expect(result).toBeUndefined();
    expect(calls[0]!.url).toMatch(/\/v1\/betaGroups\/g1\/relationships\/betaTesters$/);
    expect(calls[0]!.body).toEqual({
      data: [
        { type: "betaTesters", id: "t1" },
        { type: "betaTesters", id: "t2" },
      ],
    });
  });
});

describe("submitVersion", () => {
  it("reuses an open submission, adds the version and submits", async () => {
    const { client, calls } = testClient((call) => {
      if (call.method === "GET" && call.url.includes("/v1/reviewSubmissions?")) {
        return json({ data: [{ type: "reviewSubmissions", id: "sub1", attributes: { state: "READY_FOR_REVIEW" } }] });
      }
      if (call.method === "GET" && call.url.includes("/items")) return json({ data: [] });
      if (call.method === "POST") return json({ data: { type: "reviewSubmissionItems", id: "item1" } }, 201);
      return json({ data: { type: "reviewSubmissions", id: "sub1", attributes: { state: "WAITING_FOR_REVIEW" } } });
    });
    const result = (await invokeOp(client, "appstore_submit_version", { appId: "123", versionId: "v1" })) as {
      submissionId: string;
      reusedSubmission: boolean;
      itemId: string;
    };
    expect(result).toMatchObject({ submissionId: "sub1", reusedSubmission: true, itemId: "item1" });
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "POST", "PATCH"]);
    expect(calls[0]!.url).toContain("filter[app]=123");
    expect(calls[0]!.url).toContain("filter[platform]=IOS");
    expect(calls[2]!.body).toMatchObject({
      data: { relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: "v1" } } } },
    });
    expect(calls[3]!.body).toEqual({ data: { type: "reviewSubmissions", id: "sub1", attributes: { submitted: true } } });
  });

  it("creates a submission when none is open", async () => {
    const { client, calls } = testClient((call) => {
      if (call.method === "GET") return json({ data: [] });
      if (call.url.endsWith("/v1/reviewSubmissions")) return json({ data: { type: "reviewSubmissions", id: "new" } }, 201);
      if (call.method === "POST") return json({ data: { type: "reviewSubmissionItems", id: "i" } }, 201);
      return json({ data: { type: "reviewSubmissions", id: "new" } });
    });
    const result = await client.submissions.submitVersion("123", "v1", "MAC_OS");
    expect(result.reusedSubmission).toBe(false);
    expect(calls[1]!.body).toEqual({
      data: { type: "reviewSubmissions", attributes: { platform: "MAC_OS" }, relationships: { app: { data: { type: "apps", id: "123" } } } },
    });
  });
});

describe("reviews summary", () => {
  it("counts ratings, territories and unanswered reviews", async () => {
    const review = (id: string, rating: number, territory: string, answered: boolean) => ({
      type: "customerReviews",
      id,
      attributes: { rating, territory, title: `t${id}`, body: "b", createdDate: `2026-10-0${id}T00:00:00Z` },
      relationships: { response: { data: answered ? { type: "customerReviewResponses", id: `r${id}` } : null } },
    });
    const { client } = testClient(() =>
      json({
        data: [review("5", 5, "USA", true), review("4", 1, "DEU", false), review("3", 4, "USA", false), review("2", 2, "USA", true)],
        meta: { paging: { total: 4 } },
      }),
    );
    const s = await client.reviews.summary("123");
    expect(s.sampled).toBe(4);
    expect(s.averageRating).toBe(3);
    expect(s.byRating).toEqual({ "1": 1, "2": 1, "3": 0, "4": 1, "5": 1 });
    expect(s.byTerritory).toEqual({ USA: 3, DEU: 1 });
    expect(s.unanswered).toBe(2);
    expect(s.recentLowRatings.map((r) => r.id)).toEqual(["4", "2"]);
  });
});

describe("media upload", () => {
  it("reserves, uploads each part without the API token, then commits the checksum", async () => {
    const dir = mkdtempSync(join(tmpdir(), "asc-upload-"));
    const file = join(dir, "shot.png");
    const bytes = Buffer.from("0123456789abcdefghij");
    writeFileSync(file, bytes);
    try {
      const { client, calls } = testClient((call) => {
        if (call.url.startsWith("https://upload.example")) return new Response(null, { status: 200 });
        if (call.method === "POST") {
          return json(
            {
              data: {
                type: "appScreenshots",
                id: "shot1",
                attributes: {
                  uploadOperations: [
                    { method: "PUT", url: "https://upload.example/p1", offset: 0, length: 12, requestHeaders: [{ name: "Content-Type", value: "image/png" }] },
                    { method: "PUT", url: "https://upload.example/p2", offset: 12, length: 8, requestHeaders: [] },
                  ],
                },
              },
            },
            201,
          );
        }
        return json({ data: { type: "appScreenshots", id: "shot1" } });
      });
      const result = await invokeOp(client, "appstore_upload_screenshot", { setId: "set1", filePath: file });
      const md5 = createHash("md5").update(bytes).digest("hex");
      expect(result).toMatchObject({ id: "shot1", fileName: "shot.png", fileSize: 20, checksum: md5, parts: 2 });

      expect(calls[0]!.body).toEqual({
        data: {
          type: "appScreenshots",
          attributes: { fileName: "shot.png", fileSize: 20 },
          relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: "set1" } } },
        },
      });
      const parts = calls.filter((c) => c.url.startsWith("https://upload.example"));
      expect(parts).toHaveLength(2);
      for (const part of parts) expect(part.headers.authorization).toBeUndefined();
      const p1 = parts.find((p) => p.url.endsWith("/p1"))!;
      expect(Buffer.from(p1.rawBody as Uint8Array).toString()).toBe("0123456789ab");
      expect(p1.headers["content-type"]).toBe("image/png");
      const commit = calls[calls.length - 1]!;
      expect(commit.method).toBe("PATCH");
      expect(commit.body).toEqual({
        data: { type: "appScreenshots", id: "shot1", attributes: { uploaded: true, sourceFileChecksum: md5 } },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseReport", () => {
  it("parses TSV and keeps finance totals aside", () => {
    const text = "Start Date\tEnd Date\tQuantity\n10/01/2026\t10/31/2026\t4\n\nTotal_Rows\t1\nTotal_Amount\t9.99\t\t\n";
    const report = parseReport(text);
    expect(report.columns).toEqual(["Start Date", "End Date", "Quantity"]);
    expect(report.rows).toHaveLength(1);
    expect(report.extraLines).toEqual(["Total_Rows\t1", "Total_Amount\t9.99\t\t"]);
  });

  it("parses quoted CSV and limits rows", () => {
    const report = parseReport('a,b\n"x, y",1\n"say ""hi""",2\n3,4\n', { limit: 2 });
    expect(report.rows).toEqual([
      { a: "x, y", b: "1" },
      { a: 'say "hi"', b: "2" },
    ]);
    expect(report.totalRows).toBe(3);
    expect(report.truncated).toBe(true);
  });

  it("asks for a vendor number when none is known", async () => {
    const { client } = testClient(() => json({}));
    await expect(
      invokeOp(client, "appstore_download_sales_report", { reportDate: "2026-10-01" }),
    ).rejects.toThrow(/vendor number/);
  });
});
