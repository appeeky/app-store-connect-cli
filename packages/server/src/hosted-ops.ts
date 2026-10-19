import { API_OPS, ASC_OPS, type AscOp } from "@appeeky/app-store-connect-core";

/**
 * Arguments that point at the local filesystem. On a hosted server they would
 * read or write the server's files, so ops that take them stay CLI-only
 * (screenshot/preview uploads, profile downloads).
 */
const LOCAL_FILE_ARGS = ["filePath", "outputPath"];

function isHostable(op: AscOp): boolean {
  // The accounts group edits ~/.config/appstore; the hosted account is the
  // one connected in Appeeky.
  if (op.group === "accounts") return false;
  // Generated API ops only take ids, query parameters and a JSON body.
  if (op.api) return true;
  return !LOCAL_FILE_ARGS.some((arg) => arg in op.shape);
}

/** Every hostable op without the write filter, built once. */
const HOSTABLE_CURATED = ASC_OPS.filter(isHostable);
const CURATED_BY_NAME = new Map(ASC_OPS.map((op) => [op.name, op]));
const API_BY_NAME = new Map(API_OPS.map((op) => [op.name, op]));

const visible = (op: AscOp, allowWrites: boolean) => allowWrites || !op.write || Boolean(op.isWrite);

/**
 * Curated operations the hosted server registers as MCP tools. Writes only
 * when the caller opts in. Ops whose effect depends on their arguments
 * (appstore_request) stay listed; the read-only client refuses anything but GET.
 */
export function hostedOps(allowWrites: boolean): AscOp[] {
  return HOSTABLE_CURATED.filter((op) => visible(op, allowWrites));
}

const CALLABLE = {
  readOnly: [...hostedOps(false), ...API_OPS.filter((op) => visible(op, false))],
  writable: [...hostedOps(true), ...API_OPS],
};
const CALLABLE_BY_NAME = {
  readOnly: new Map(CALLABLE.readOnly.map((op) => [op.name, op])),
  writable: new Map(CALLABLE.writable.map((op) => [op.name, op])),
};

/**
 * Everything callable on the hosted server: the hosted curated ops plus every
 * generated API op, with writes only when the caller opts in.
 */
export function hostedCallableOps(allowWrites: boolean): AscOp[] {
  return allowWrites ? CALLABLE.writable : CALLABLE.readOnly;
}

/** A callable op by name for this caller, if any. */
export function findHostedOp(name: string, allowWrites: boolean): AscOp | undefined {
  return (allowWrites ? CALLABLE_BY_NAME.writable : CALLABLE_BY_NAME.readOnly).get(name);
}

export interface HostedRefusal {
  status: number;
  code: "WRITES_DISABLED" | "CLI_ONLY" | "UNKNOWN_OPERATION";
  message: string;
}

export const writesDisabledMessage = (name: string) =>
  `${name} changes your App Store Connect account. Send X-ASC-Allow-Writes: true to run it.`;

/** Why `name` is not callable for this caller. */
export function hostedRefusal(name: string, allowWrites: boolean): HostedRefusal {
  const op = CURATED_BY_NAME.get(name) ?? API_BY_NAME.get(name);
  if (op && !isHostable(op)) {
    return {
      status: 404,
      code: "CLI_ONLY",
      message: `${name} reads or writes local files or config, so it is CLI-only. Use the appstore CLI for it.`,
    };
  }
  if (op && !allowWrites && !visible(op, false)) {
    return { status: 403, code: "WRITES_DISABLED", message: writesDisabledMessage(name) };
  }
  return { status: 404, code: "UNKNOWN_OPERATION", message: `Unknown operation: ${name}` };
}
