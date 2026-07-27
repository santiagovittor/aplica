import type { LookupAddress, LookupOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP, isIPv4 } from 'node:net';

/**
 * SSRF guard for the user-supplied `openai_compatible` base URL
 * (PROJECT.md section 6).
 *
 * The server makes the request, so a user who points the base URL at
 * `http://169.254.169.254/` is asking us to reach somewhere they cannot reach
 * themselves. Three layers, because none of them covers the others:
 *
 * 1. `assertSafeBaseUrl` catches a literal private address, at save time.
 * 2. `assertResolvesSafely` catches a public hostname that resolves to a
 *    private one, and gives a clear error before any connection is made.
 * 3. `guardedLookup` is what actually holds. Checking DNS and then connecting
 *    resolves the name twice, and an attacker who runs their own DNS can answer
 *    public on the check and private on the connect. Handing this to the
 *    request removes the second resolution: the address approved here is the
 *    address the socket uses.
 *
 * The policy is a parameter rather than a module-level env read, so this stays
 * a pure function and no test needs an environment. Same reasoning as
 * `crypto.ts`.
 */

export interface HostPolicy {
  /** Self-hosters pointing at Ollama on localhost. Never true in the hosted app. */
  allowPrivate: boolean;
}

/**
 * An endpoint that has been through `assertSafeBaseUrl`. The hostname comes
 * back alongside the URL so callers never re-derive it: `new URL(u).hostname`
 * keeps the brackets on a literal IPv6 host, and `[::1]` is neither an address
 * `isIP` recognises nor a name DNS can resolve.
 */
export interface SafeEndpoint {
  /** Normalised, without a trailing slash, so a path can be appended. */
  url: string;
  /** Brackets and any trailing dot stripped, ready for a DNS lookup. */
  hostname: string;
}

/**
 * Ranges that are never a legitimate provider endpoint: unspecified, private,
 * loopback, carrier-grade NAT, link-local (where every cloud metadata service
 * lives), benchmarking, multicast and reserved.
 */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const BLOCKED_V6: ReadonlyArray<readonly [string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

const blocked = new BlockList();
for (const [address, prefix] of BLOCKED_V4) {
  blocked.addSubnet(address, prefix, 'ipv4');
  // The same range again as an IPv4-mapped IPv6 subnet. `::ffff:127.0.0.1` and
  // `::ffff:7f00:1` are the same address written two ways, and a v6 check
  // against a v4 rule does not match; adding the mapped subnet catches both
  // forms without parsing either.
  blocked.addSubnet(`::ffff:${address}`, 96 + prefix, 'ipv6');
}
for (const [address, prefix] of BLOCKED_V6) {
  blocked.addSubnet(address, prefix, 'ipv6');
}

/** Hostnames that only ever resolve inside a private network. */
const BLOCKED_HOSTS = ['localhost', 'metadata.goog'];
/** ...and the suffixes below them. `.internal` covers metadata.google.internal. */
const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.metadata.goog',
];

export function isBlockedAddress(address: string): boolean {
  const family = isIPv4(address) ? 'ipv4' : 'ipv6';
  return blocked.check(address, family);
}

/**
 * Validates the URL itself and returns it normalised, without a trailing slash
 * so callers can append a path. Throws with the reason on anything rejected.
 */
export function assertSafeBaseUrl(
  raw: string,
  policy: HostPolicy,
): SafeEndpoint {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Endpoint URL is not a valid URL.');
  }

  if (
    url.protocol !== 'https:' &&
    !(policy.allowPrivate && url.protocol === 'http:')
  ) {
    throw new Error('Endpoint URL must use https.');
  }

  if (url.username || url.password) {
    throw new Error('Endpoint URL must not carry credentials.');
  }

  // A literal IPv6 host keeps its brackets in `hostname`, and a trailing dot is
  // a distinct string that resolves the same way.
  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (!hostname) {
    throw new Error('Endpoint URL has no host.');
  }

  const endpoint = { url: trimTrailingSlash(url.toString()), hostname };

  if (policy.allowPrivate) {
    return endpoint;
  }

  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new Error(
        `Endpoint URL resolves to a private address (${hostname}).`,
      );
    }
    return endpoint;
  }

  if (
    BLOCKED_HOSTS.includes(hostname) ||
    BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error(
      `Endpoint host is not reachable from the public internet (${hostname}).`,
    );
  }

  // A single-label host resolves through whatever search domain the server has,
  // which is exactly the internal network we are keeping out.
  if (!hostname.includes('.')) {
    throw new Error(
      `Endpoint host must be a fully qualified domain (${hostname}).`,
    );
  }

  return endpoint;
}

/**
 * The half `assertSafeBaseUrl` cannot do: a public hostname is free to resolve
 * to a private address, and only DNS knows.
 */
export async function assertResolvesSafely(
  hostname: string,
  policy: HostPolicy,
): Promise<void> {
  if (policy.allowPrivate || isIP(hostname)) {
    return;
  }

  const resolved = await lookup(hostname, { all: true });
  for (const { address } of resolved) {
    if (isBlockedAddress(address)) {
      throw new Error(
        `Endpoint host resolves to a private address (${hostname}).`,
      );
    }
  }
}

/**
 * The address family and address a connection resolved to.
 *
 * This is `node:net`'s `LookupFunction` shape rather than an invention: it is
 * what `https.request({ lookup })` calls.
 */
export type GuardedLookup = (
  hostname: string,
  options: LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) => void;

/**
 * Closes the validate-then-connect window.
 *
 * `assertResolvesSafely` checks DNS and then a separate connection resolves it
 * again, so an attacker who controls their own DNS can answer public on the
 * check and private on the connect. Passing this to `https.request` removes the
 * second resolution entirely: the address this function approves is the address
 * the socket connects to, because the socket got it from here.
 */
export function guardedLookup(policy: HostPolicy): GuardedLookup {
  return (hostname, options, callback) => {
    lookup(hostname, { all: true })
      .then((resolved) => {
        if (resolved.length === 0) {
          callback(notFound(hostname), '', 0);
          return;
        }

        if (!policy.allowPrivate) {
          const blockedEntry = resolved.find(({ address }) =>
            isBlockedAddress(address),
          );
          if (blockedEntry !== undefined) {
            callback(
              refused(
                `Endpoint host resolves to a private address (${hostname}).`,
              ),
              '',
              0,
            );
            return;
          }
        }

        // Every answer passed, so any of them is safe. Honour the caller's
        // family preference when it expressed one; `family` arrives as a
        // number or as the strings IPv4 and IPv6.
        const preferred =
          options.family === 4 || options.family === 'IPv4'
            ? 4
            : options.family === 6 || options.family === 'IPv6'
              ? 6
              : undefined;
        const matching =
          preferred === undefined
            ? resolved
            : resolved.filter((entry) => entry.family === preferred);
        const wanted = matching.length > 0 ? matching : resolved;

        // `all` is not a preference, it is the answer shape node demands.
        // `autoSelectFamily` is on by default from node 20, so a socket asks
        // this way and then reads `addresses[0].address`; a string arrives as
        // `undefined` and the request dies before it leaves the machine. Every
        // address here already passed the check, so handing over all of them is
        // both correct and what lets Happy Eyeballs race them.
        if (options.all === true) {
          callback(null, wanted);
          return;
        }
        callback(null, wanted[0].address, wanted[0].family);
      })
      .catch((error: unknown) => {
        callback(error instanceof Error ? error : notFound(hostname), '', 0);
      });
  };
}

function notFound(hostname: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`ENOTFOUND ${hostname}`);
  error.code = 'ENOTFOUND';
  return error;
}

function refused(message: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = 'EACCES';
  return error;
}

/** The one read of the escape hatch. Off unless explicitly turned on. */
export function allowPrivateHosts(): boolean {
  return process.env.ALLOW_PRIVATE_PROVIDER_HOSTS === 'true';
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
