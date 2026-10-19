/**
 * Test helpers (excluded from the build): a scripted fetch and a throwaway
 * P-256 key in Apple's .p8 (PKCS#8 PEM) format.
 */
import { generateKeyPairSync } from "node:crypto";
import { AppStoreConnectClient } from "./client.js";

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  rawBody?: unknown;
}

export type Responder = (call: RecordedCall) => Response | Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A fetch that records every call and answers from `responder`. */
export function mockFetch(responder: Responder) {
  const calls: RecordedCall[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers as ConstructorParameters<typeof Headers>[0]).forEach((v, k) => {
      headers[k] = v;
    });
    let body: unknown;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: RecordedCall = {
      url: String(input),
      method: (init.method ?? "GET").toUpperCase(),
      headers,
      body,
      rawBody: init.body,
    };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export function testKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey,
  };
}

const sharedKey = testKey();

/** Client with a real signed key and a scripted fetch; no waiting between retries. */
export function testClient(responder: Responder, options: { readOnly?: boolean; issuerId?: string | null; vendorNumber?: string } = {}) {
  const mock = mockFetch(responder);
  const client = AppStoreConnectClient.fromCredentials(
    {
      keyId: "KEY123",
      issuerId: options.issuerId === null ? undefined : (options.issuerId ?? "issuer-uuid"),
      privateKey: sharedKey.privatePem,
    },
    {
      fetch: mock.fetch,
      readOnly: options.readOnly,
      vendorNumber: options.vendorNumber,
      retry: { baseDelayMs: 1, maxDelayMs: 2, sleep: async () => {} },
    },
  );
  return { client, calls: mock.calls, publicKey: sharedKey.publicKey };
}
