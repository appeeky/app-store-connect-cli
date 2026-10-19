import { gunzipSync } from "node:zlib";

/** Gunzip when the bytes start with the gzip magic number; pass through otherwise. */
export function maybeGunzip(bytes: Buffer): Buffer {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return gunzipSync(bytes);
  return bytes;
}
