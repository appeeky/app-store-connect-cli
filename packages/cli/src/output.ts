import type { GlobalOpts } from "./cli.js";

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value ?? { ok: true }, null, 2));
}

export function printTable(rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) {
    console.log("(empty)");
    return;
  }
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (v: unknown) => {
    if (v === undefined || v === null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return s.replace(/\s+/g, " ");
  };
  const widths = keys.map((key) => Math.min(60, Math.max(key.length, ...rows.map((row) => cell(row[key]).length))));
  const line = (values: string[]) =>
    values
      .map((v, i) => {
        const w = widths[i] ?? 0;
        return (v.length > w ? `${v.slice(0, w - 1)}…` : v).padEnd(w);
      })
      .join("  ")
      .trimEnd();
  console.log(line(keys));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(keys.map((k) => cell(row[k]))));
}

interface ResourceLike {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
}

/**
 * Rows for a JSON:API list (or single resource): id plus the chosen
 * attributes. Returns undefined when the value is not a resource document.
 */
export function resourceRows(value: unknown, columns: string[]): Array<Record<string, unknown>> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = (value as { data?: unknown }).data;
  const items: ResourceLike[] | undefined = Array.isArray(data)
    ? (data as ResourceLike[])
    : data && typeof data === "object"
      ? [data as ResourceLike]
      : undefined;
  if (!items) return undefined;
  return items.map((r) => {
    const row: Record<string, unknown> = { id: r.id };
    for (const col of columns) row[col] = r.attributes?.[col];
    return row;
  });
}

export function requireConfirm(opts: GlobalOpts, operation: string): void {
  if (!opts.confirm) {
    throw new Error(`Refusing to run write operation "${operation}" without --confirm`);
  }
}
