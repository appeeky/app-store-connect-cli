import { z } from "zod";
import { appId, id, page, pageOpts, str, type AscOp } from "./shared.js";

const rowLimit = z
  .number()
  .int()
  .min(0)
  .max(100_000)
  .optional()
  .describe("Max rows to return (default 1000); totalRows always counts all");
const vendorNumber = z.string().optional().describe("Vendor number (defaults to the account's)");

export const REPORT_OPS: AscOp[] = [
  {
    name: "appstore_download_sales_report",
    group: "reports",
    summary: "Download a Sales and Trends report and return its rows as JSON",
    write: false,
    shape: {
      vendorNumber,
      reportType: z
        .string()
        .default("SALES")
        .describe("SALES, SUBSCRIPTION, SUBSCRIPTION_EVENT, SUBSCRIBER, PRE_ORDER, INSTALLS, …"),
      reportSubType: z.string().default("SUMMARY").describe("SUMMARY, DETAILED, SUMMARY_INSTALL_TYPE, …"),
      frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]).default("DAILY"),
      reportDate: z.string().optional().describe("YYYY-MM-DD, YYYY-MM or YYYY; omit for the latest"),
      version: z.string().optional().describe("Report version, e.g. 1_0 (SALES) or 1_3 (SUBSCRIPTION)"),
      limit: rowLimit,
    },
    run: (c, a) =>
      c.reports.salesReport(
        {
          vendorNumber: a.vendorNumber as string | undefined,
          reportType: (a.reportType as string | undefined) ?? "SALES",
          reportSubType: (a.reportSubType as string | undefined) ?? "SUMMARY",
          frequency: (a.frequency as "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | undefined) ?? "DAILY",
          reportDate: a.reportDate as string | undefined,
          version: a.version as string | undefined,
        },
        { limit: (a.limit as number | undefined) ?? 1000 },
      ),
  },
  {
    name: "appstore_download_finance_report",
    group: "reports",
    summary: "Download a monthly finance report (FINANCIAL or FINANCE_DETAIL) as JSON rows",
    write: false,
    shape: {
      vendorNumber,
      reportType: z.enum(["FINANCIAL", "FINANCE_DETAIL"]).default("FINANCIAL"),
      regionCode: z.string().min(2).describe("Region, e.g. US, EU, JP; ZZ for all (FINANCE_DETAIL)"),
      reportDate: z.string().regex(/^\d{4}-\d{2}$/).describe("Fiscal month, YYYY-MM"),
      limit: rowLimit,
    },
    run: (c, a) =>
      c.reports.financeReport(
        {
          vendorNumber: a.vendorNumber as string | undefined,
          reportType: (a.reportType as "FINANCIAL" | "FINANCE_DETAIL" | undefined) ?? "FINANCIAL",
          regionCode: str(a.regionCode, "regionCode"),
          reportDate: str(a.reportDate, "reportDate"),
        },
        { limit: (a.limit as number | undefined) ?? 1000 },
      ),
  },
  {
    name: "appstore_list_analytics_report_requests",
    group: "analytics",
    summary: "List analytics report requests of an app",
    write: false,
    shape: { appId, accessType: z.enum(["ONGOING", "ONE_TIME_SNAPSHOT"]).optional(), ...page },
    run: (c, a) =>
      c.reports.listAnalyticsRequests(str(a.appId, "appId"), {
        ...pageOpts(a),
        accessType: a.accessType as string | undefined,
      }),
  },
  {
    name: "appstore_create_analytics_report_request",
    group: "analytics",
    summary: "Request analytics reports for an app (ONGOING daily data or a ONE_TIME_SNAPSHOT backfill)",
    write: true,
    shape: { appId, accessType: z.enum(["ONGOING", "ONE_TIME_SNAPSHOT"]) },
    run: (c, a) =>
      c.reports.createAnalyticsRequest(str(a.appId, "appId"), a.accessType as "ONGOING" | "ONE_TIME_SNAPSHOT"),
  },
  {
    name: "appstore_delete_analytics_report_request",
    group: "analytics",
    summary: "Stop an analytics report request",
    write: true,
    shape: { requestId: id("Analytics report request") },
    run: (c, a) => c.reports.deleteAnalyticsRequest(str(a.requestId, "requestId")),
  },
  {
    name: "appstore_list_analytics_reports",
    group: "analytics",
    summary: "List reports available under a request (filter by category or name)",
    write: false,
    shape: {
      requestId: id("Analytics report request"),
      category: z
        .enum(["APP_USAGE", "APP_STORE_ENGAGEMENT", "COMMERCE", "FRAMEWORK_USAGE", "PERFORMANCE"])
        .optional(),
      name: z.string().optional().describe("Report name, e.g. App Downloads Standard"),
      ...page,
    },
    run: (c, a) =>
      c.reports.listAnalyticsReports(str(a.requestId, "requestId"), {
        ...pageOpts(a),
        category: a.category as string | undefined,
        name: a.name as string | undefined,
      }),
  },
  {
    name: "appstore_list_analytics_report_instances",
    group: "analytics",
    summary: "List generated instances of an analytics report (by granularity and date)",
    write: false,
    shape: {
      reportId: id("Analytics report"),
      granularity: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional(),
      processingDate: z.string().optional().describe("YYYY-MM-DD"),
      ...page,
    },
    run: (c, a) =>
      c.reports.listAnalyticsInstances(str(a.reportId, "reportId"), {
        ...pageOpts(a),
        granularity: a.granularity as "DAILY" | "WEEKLY" | "MONTHLY" | undefined,
        processingDate: a.processingDate as string | undefined,
      }),
  },
  {
    name: "appstore_list_analytics_report_segments",
    group: "analytics",
    summary: "List downloadable segments of an analytics report instance",
    write: false,
    shape: { instanceId: id("Analytics report instance"), ...page },
    run: (c, a) => c.reports.listAnalyticsSegments(str(a.instanceId, "instanceId"), pageOpts(a)),
  },
  {
    name: "appstore_download_analytics_segment",
    group: "analytics",
    summary: "Download one analytics report segment and return its rows as JSON",
    write: false,
    shape: { segmentId: id("Analytics report segment"), limit: rowLimit },
    run: (c, a) =>
      c.reports.analyticsSegment(str(a.segmentId, "segmentId"), { limit: (a.limit as number | undefined) ?? 1000 }),
  },
];
