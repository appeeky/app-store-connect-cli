import type { AppStoreConnectClient } from "../client.js";
import { maybeGunzip } from "../gzip.js";
import { AscError, ValidationError } from "../errors.js";
import { enc, listQuery, relOne, type JsonApiDocument, type ListOptions, type Resource } from "../jsonapi.js";
import type { Schemas } from "../types.js";

export interface SalesReportInput {
  vendorNumber?: string;
  /** SALES, SUBSCRIPTION, SUBSCRIPTION_EVENT, SUBSCRIBER, PRE_ORDER, INSTALLS… */
  reportType: string;
  /** SUMMARY, DETAILED, SUMMARY_INSTALL_TYPE, SUMMARY_TERRITORY, SUMMARY_CHANNEL */
  reportSubType: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  /** YYYY-MM-DD (daily/weekly), YYYY-MM (monthly), YYYY (yearly). Omit for the latest. */
  reportDate?: string;
  /** Report format version, e.g. 1_0, 1_3. */
  version?: string;
}

export interface FinanceReportInput {
  vendorNumber?: string;
  reportType: "FINANCIAL" | "FINANCE_DETAIL";
  /** e.g. US, EU, ZZ (all regions for FINANCE_DETAIL). */
  regionCode: string;
  /** Fiscal month, YYYY-MM. */
  reportDate: string;
}

export interface ParsedReport {
  columns: string[];
  rows: Array<Record<string, string>>;
  totalRows: number;
  truncated: boolean;
  /** Lines that did not fit the table (finance report totals and notes). */
  extraLines?: string[];
}

/** Split one CSV line, honoring double quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Parse a tab- or comma-separated report into rows keyed by column name.
 * Rows whose cell count differs from the header (finance totals, notes)
 * are returned as `extraLines`.
 */
export function parseReport(text: string, options: { limit?: number } = {}): ParsedReport {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const headerLine = lines.shift();
  if (!headerLine) return { columns: [], rows: [], totalRows: 0, truncated: false };
  const tsv = headerLine.includes("\t");
  const split = tsv ? (l: string) => l.split("\t") : splitCsvLine;
  const columns = split(headerLine).map((c) => c.trim());
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const rows: Array<Record<string, string>> = [];
  const extra: string[] = [];
  let total = 0;
  for (const line of lines) {
    const cells = split(line);
    if (cells.length !== columns.length) {
      extra.push(line);
      continue;
    }
    total += 1;
    if (rows.length < limit) {
      const row: Record<string, string> = {};
      columns.forEach((c, i) => {
        row[c] = cells[i] ?? "";
      });
      rows.push(row);
    }
  }
  return {
    columns,
    rows,
    totalRows: total,
    truncated: total > rows.length,
    ...(extra.length ? { extraLines: extra } : {}),
  };
}

export class ReportsApi {
  constructor(private readonly client: AppStoreConnectClient) {}

  private vendor(vendorNumber?: string): string {
    const v = vendorNumber ?? this.client.vendorNumber;
    if (!v) {
      throw new ValidationError(
        "A vendor number is required. Pass vendorNumber (Payments and Financial Reports → top left) or set it on the account.",
      );
    }
    return v;
  }

  /** Raw (gunzipped) sales report text. */
  async salesReportText(input: SalesReportInput): Promise<string> {
    const bytes = await this.client.download("/v1/salesReports", {
      "filter[vendorNumber]": this.vendor(input.vendorNumber),
      "filter[reportType]": input.reportType,
      "filter[reportSubType]": input.reportSubType,
      "filter[frequency]": input.frequency,
      "filter[reportDate]": input.reportDate,
      "filter[version]": input.version,
    });
    return bytes.toString("utf8");
  }

  async salesReport(input: SalesReportInput, options: { limit?: number } = {}) {
    return { ...input, vendorNumber: this.vendor(input.vendorNumber), ...parseReport(await this.salesReportText(input), options) };
  }

  /** Raw (gunzipped) finance report text. */
  async financeReportText(input: FinanceReportInput): Promise<string> {
    const bytes = await this.client.download("/v1/financeReports", {
      "filter[vendorNumber]": this.vendor(input.vendorNumber),
      "filter[reportType]": input.reportType,
      "filter[regionCode]": input.regionCode,
      "filter[reportDate]": input.reportDate,
    });
    return bytes.toString("utf8");
  }

  async financeReport(input: FinanceReportInput, options: { limit?: number } = {}) {
    return { ...input, vendorNumber: this.vendor(input.vendorNumber), ...parseReport(await this.financeReportText(input), options) };
  }

  // ── Analytics reports ────────────────────────────────────────
  listAnalyticsRequests(appId: string, options: ListOptions & { accessType?: string } = {}) {
    return this.client.list(
      `/v1/apps/${enc(appId)}/analyticsReportRequests`,
      listQuery(options, { accessType: options.accessType }),
      options,
    );
  }

  /** ONGOING keeps generating daily data; ONE_TIME_SNAPSHOT backfills history once. */
  createAnalyticsRequest(appId: string, accessType: "ONGOING" | "ONE_TIME_SNAPSHOT") {
    const body: Schemas["AnalyticsReportRequestCreateRequest"] = {
      data: {
        type: "analyticsReportRequests",
        attributes: { accessType },
        relationships: { app: relOne("apps", appId) },
      },
    };
    return this.client.post("/v1/analyticsReportRequests", body, "analyticsReportRequests.create");
  }

  deleteAnalyticsRequest(requestId: string) {
    return this.client.delete(
      `/v1/analyticsReportRequests/${enc(requestId)}`,
      undefined,
      "analyticsReportRequests.delete",
    );
  }

  listAnalyticsReports(requestId: string, options: ListOptions & { category?: string; name?: string } = {}) {
    return this.client.list(
      `/v1/analyticsReportRequests/${enc(requestId)}/reports`,
      listQuery(options, { category: options.category, name: options.name }),
      options,
    );
  }

  listAnalyticsInstances(
    reportId: string,
    options: ListOptions & { granularity?: "DAILY" | "WEEKLY" | "MONTHLY"; processingDate?: string } = {},
  ) {
    return this.client.list(
      `/v1/analyticsReports/${enc(reportId)}/instances`,
      listQuery(options, { granularity: options.granularity, processingDate: options.processingDate }),
      options,
    );
  }

  listAnalyticsSegments(instanceId: string, options: ListOptions = {}) {
    return this.client.list(`/v1/analyticsReportInstances/${enc(instanceId)}/segments`, listQuery(options), options);
  }

  /** Raw (gunzipped) text of one analytics segment. Fetched by id, never by URL. */
  async analyticsSegmentText(segmentId: string): Promise<string> {
    const doc = await this.client.get<JsonApiDocument<Resource>>(`/v1/analyticsReportSegments/${enc(segmentId)}`);
    const url = doc.data.attributes?.url;
    if (typeof url !== "string" || !url) throw new AscError(`Segment ${segmentId} has no download URL`);
    const res = await this.client.fetchExternal(url);
    return maybeGunzip(Buffer.from(await res.arrayBuffer())).toString("utf8");
  }

  async analyticsSegment(segmentId: string, options: { limit?: number } = {}) {
    return { segmentId, ...parseReport(await this.analyticsSegmentText(segmentId), options) };
  }
}
