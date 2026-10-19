/**
 * Load Apple's App Store Connect OpenAPI spec for the generators.
 *
 * Order: an explicit --spec file, then the cache written by a previous run
 * (packages/core/.spec/openapi.oas.json, git-ignored), then a fresh download
 * of Apple's public zip. `download: true` skips the cache.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";

export const SPEC_URL =
  "https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip";

export const CORE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SPEC_CACHE = join(CORE_ROOT, ".spec/openapi.oas.json");

async function downloadSpecText() {
  console.log(`Downloading ${SPEC_URL}`);
  const res = await fetch(SPEC_URL);
  if (!res.ok) throw new Error(`Spec download failed: HTTP ${res.status}`);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const name = Object.keys(files).find(
    (f) => f.endsWith(".json") && !f.startsWith("__MACOSX") && !f.includes("/._"),
  );
  if (!name) throw new Error("No JSON spec inside the downloaded archive");
  const text = strFromU8(files[name]);
  mkdirSync(dirname(SPEC_CACHE), { recursive: true });
  writeFileSync(SPEC_CACHE, text);
  return text;
}

/**
 * @param {{ spec?: string; download?: boolean; useCache?: boolean }} options
 * @returns {Promise<{ text: string; source: string }>}
 */
export async function loadSpecText(options = {}) {
  if (options.spec) return { text: readFileSync(resolve(options.spec), "utf8"), source: resolve(options.spec) };
  if (options.useCache && !options.download && existsSync(SPEC_CACHE)) {
    return { text: readFileSync(SPEC_CACHE, "utf8"), source: SPEC_CACHE };
  }
  return { text: await downloadSpecText(), source: SPEC_URL };
}
