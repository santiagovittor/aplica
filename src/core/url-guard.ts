import { lookup } from 'node:dns/promises';
import { BlockList, isIP, isIPv4 } from 'node:net';

/**
 * SSRF guard for the user-supplied `openai_compatible` base URL
 * (PROJECT.md section 6).
 *
 * The server makes the request, so a user who points the base URL at
 * `http://169.254.169.254/` is asking us to reach somewhere they cannot reach
 * themselves. Two checks, because neither covers the other: the URL check
 * catches a literal address, and the DNS check catches a public hostname that
 * resolves to a private one.
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
export function assertSafeBaseUrl(raw: string, policy: HostPolicy): string {
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

  if (policy.allowPrivate) {
    return trimTrailingSlash(url.toString());
  }

  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new Error(
        `Endpoint URL resolves to a private address (${hostname}).`,
      );
    }
    return trimTrailingSlash(url.toString());
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

  return trimTrailingSlash(url.toString());
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

/** The one read of the escape hatch. Off unless explicitly turned on. */
export function allowPrivateHosts(): boolean {
  return process.env.ALLOW_PRIVATE_PROVIDER_HOSTS === 'true';
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
