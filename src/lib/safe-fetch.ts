import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import type { Transform } from "node:stream";

// Server-side fetch for user-supplied URLs (SSRF protection).
// Destinations are validated on the address actually connected to (custom DNS lookup),
// redirects are followed manually and re-validated, and bodies are size/time limited.

export type SafeFetchErrorCode =
  | "INVALID_URL"
  | "BLOCKED"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "TOO_MANY_REDIRECTS"
  | "BAD_RESPONSE"
  | "NETWORK";

export class SafeFetchError extends Error {
  constructor(public code: SafeFetchErrorCode) {
    super(code);
    this.name = "SafeFetchError";
  }
}

const blockedV4 = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blockedV4.addSubnet(network, prefix, "ipv4");
}

// IPv6: only global unicast (2000::/3) is allowed. This excludes loopback, unspecified,
// IPv4-mapped/compatible, NAT64, unique-local, link-local, site-local and multicast.
const globalV6 = new net.BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new net.BlockList();
for (const [network, prefix] of [
  ["2001::", 23], // IETF special-purpose (incl. Teredo, which embeds IPv4)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (embeds IPv4)
] as const) {
  blockedV6.addSubnet(network, prefix, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
  try {
    const family = net.isIP(address);
    if (family === 4) return blockedV4.check(address, "ipv4");
    if (family === 6) return !globalV6.check(address, "ipv6") || blockedV6.check(address, "ipv6");
  } catch {
    // unparsable address: fall through and block
  }
  return true;
}

function validateUrl(input: string, isBlocked: (address: string) => boolean): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafeFetchError("INVALID_URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("INVALID_URL");
  }
  // The WHATWG parser already canonicalizes decimal/hex/octal/short IPv4 forms.
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    throw new SafeFetchError("BLOCKED");
  }
  // IP literals skip the DNS lookup below, so they are checked here.
  if (net.isIP(host) && isBlocked(host)) {
    throw new SafeFetchError("BLOCKED");
  }
  return url;
}

function makeLookup(isBlocked: (address: string) => boolean): net.LookupFunction {
  return (hostname, options, callback) => {
    const family = typeof options.family === "number" ? options.family : 0;
    dns.lookup(hostname, { all: true, family }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      // Block if any resolved address is private, so a mixed record set cannot be abused.
      if (addresses.length === 0 || addresses.some((a) => isBlocked(a.address))) {
        return callback(new SafeFetchError("BLOCKED") as NodeJS.ErrnoException, "", 0);
      }
      if (options.all) {
        (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    });
  };
}

function sendRequest(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  isBlocked: (address: string) => boolean
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        headers: { "accept-encoding": "gzip, deflate, br", ...headers },
        agent: false, // no pooled sockets: every connection goes through the validated lookup
        lookup: makeLookup(isBlocked),
        signal,
      },
      resolve
    );
    req.on("error", reject);
    req.end();
  });
}

function createDecoder(encoding: string): Transform | null {
  switch (encoding) {
    case "":
    case "identity":
      return null;
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip();
    case "deflate":
      return zlib.createInflate();
    case "br":
      return zlib.createBrotliDecompress();
    default:
      throw new SafeFetchError("BAD_RESPONSE");
  }
}

async function readBody(res: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new SafeFetchError("TOO_LARGE");
  }

  const decoder = createDecoder(String(res.headers["content-encoding"] ?? "").trim().toLowerCase());
  // Count raw bytes too; the decoded output is checked below, which also stops decompression bombs.
  let rawBytes = 0;
  res.on("data", (chunk: Buffer) => {
    rawBytes += chunk.length;
    if (rawBytes > maxBytes) res.destroy(new SafeFetchError("TOO_LARGE"));
  });
  if (decoder) res.on("error", (err) => decoder.destroy(err));
  const source = decoder ? res.pipe(decoder) : res;

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of source as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > maxBytes) throw new SafeFetchError("TOO_LARGE");
      chunks.push(chunk);
    }
  } finally {
    res.destroy();
    decoder?.destroy();
  }
  return Buffer.concat(chunks);
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  /** Overall deadline, including redirects and body download. */
  timeoutMs?: number;
  /** Maximum body size in bytes, after decompression. */
  maxBytes?: number;
  maxRedirects?: number;
  /** Checked on the response headers, before the body is downloaded. */
  acceptContentType?: (contentType: string) => boolean;
  /** Only for tests. */
  isBlocked?: (address: string) => boolean;
}

export interface SafeFetchResponse {
  ok: boolean;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  url: string;
}

export async function safeFetch(input: string, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const {
    headers = {},
    timeoutMs = 10_000,
    maxBytes = 5 * 1024 * 1024,
    maxRedirects = 5,
    acceptContentType,
    isBlocked = isBlockedAddress,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let url = validateUrl(input, isBlocked);
    for (let redirects = 0; ; redirects++) {
      const res = await sendRequest(url, headers, controller.signal, isBlocked);
      const status = res.statusCode ?? 0;

      if (status >= 300 && status < 400 && res.headers.location) {
        res.destroy();
        if (redirects >= maxRedirects) throw new SafeFetchError("TOO_MANY_REDIRECTS");
        let next: string;
        try {
          next = new URL(res.headers.location, url).href;
        } catch {
          throw new SafeFetchError("INVALID_URL");
        }
        url = validateUrl(next, isBlocked);
        continue;
      }

      if (acceptContentType && !acceptContentType(String(res.headers["content-type"] ?? ""))) {
        res.destroy();
        throw new SafeFetchError("BAD_RESPONSE");
      }

      const body = await readBody(res, maxBytes);
      return { ok: status >= 200 && status < 300, status, headers: res.headers, body, url: url.href };
    }
  } catch (err) {
    if (controller.signal.aborted) throw new SafeFetchError("TIMEOUT");
    if (err instanceof SafeFetchError) throw err;
    if ((err as { cause?: unknown })?.cause instanceof SafeFetchError) throw (err as { cause: SafeFetchError }).cause;
    throw new SafeFetchError("NETWORK");
  } finally {
    clearTimeout(timer);
  }
}

/** Runs `fn` over `items` with at most `limit` calls in flight. */
export async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length > 0) await fn(queue.shift() as T);
    })
  );
}
