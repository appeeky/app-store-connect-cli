import { ASC_OPS, type AscOp } from "@appeeky/app-store-connect-core";

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
  return !LOCAL_FILE_ARGS.some((arg) => arg in op.shape);
}

/**
 * Operations the hosted server exposes. Writes only when the caller opts in.
 * Ops whose effect depends on their arguments (appstore_request) stay listed;
 * the read-only client refuses anything but GET.
 */
export function hostedOps(allowWrites: boolean): AscOp[] {
  return ASC_OPS.filter((op) => isHostable(op) && (allowWrites || !op.write || Boolean(op.isWrite)));
}
