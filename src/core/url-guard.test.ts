import type { LookupAddress } from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  allowPrivateHosts,
  assertResolvesSafely,
  assertSafeBaseUrl,
  isBlockedAddress,
} from './url-guard';

const OPEN = { allowPrivate: true };
const CLOSED = { allowPrivate: false };

// DNS is stubbed so the suite needs no network, the same way the provider tests
// stub fetch. The cast is because node's `lookup` is overloaded and `vi.mocked`
// resolves to the single-address overload, not the `{ all: true }` one we call.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));
const { lookup } = await import('node:dns/promises');
type LookupAll = (
  hostname: string,
  options: { all: true },
) => Promise<LookupAddress[]>;
const mockedLookup = vi.mocked(lookup as unknown as LookupAll);

describe('isBlockedAddress', () => {
  const blocked = [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254', // the cloud metadata address this whole module exists for
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    // The same private addresses wearing an IPv6 costume, in both spellings.
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '::ffff:10.0.0.1',
  ];

  for (const address of blocked) {
    it(`blocks ${address}`, () => {
      expect(isBlockedAddress(address)).toBe(true);
    });
  }

  const allowed = [
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '192.169.0.1',
    '2606:4700::1111',
  ];
  for (const address of allowed) {
    it(`allows ${address}`, () => {
      expect(isBlockedAddress(address)).toBe(false);
    });
  }
});

describe('assertSafeBaseUrl rejects', () => {
  const cases: Record<string, string> = {
    'a plain-text scheme': 'http://api.example.com/v1',
    'a non-http scheme': 'file:///etc/passwd',
    'credentials in the URL': 'https://user:secret@api.example.com/v1',
    'a loopback literal': 'https://127.0.0.1/v1',
    'the metadata address': 'https://169.254.169.254/latest/meta-data',
    'a private literal': 'https://10.0.0.5:8000/v1',
    // new URL() folds every one of these to 127.0.0.1 before we see it.
    'a decimal-encoded address': 'https://2130706433/v1',
    'a hex-encoded address': 'https://0x7f000001/v1',
    'an octal-encoded address': 'https://0177.0.0.1/v1',
    'a bracketed loopback': 'https://[::1]/v1',
    'an IPv4-mapped loopback': 'https://[::ffff:127.0.0.1]/v1',
    localhost: 'https://localhost:11434/v1',
    'a localhost subdomain': 'https://api.localhost/v1',
    'an mDNS name': 'https://nas.local/v1',
    'the GCP metadata name': 'https://metadata.google.internal/v1',
    'the short GCP metadata name': 'https://metadata.goog/v1',
    'a single-label host': 'https://intranet/v1',
    'a trailing-dot localhost': 'https://localhost./v1',
    nonsense: 'not a url at all',
  };

  for (const [name, url] of Object.entries(cases)) {
    it(name, () => {
      expect(() => assertSafeBaseUrl(url, CLOSED)).toThrow();
    });
  }
});

describe('assertSafeBaseUrl accepts', () => {
  it('a public https endpoint', () => {
    expect(
      assertSafeBaseUrl('https://integrate.api.nvidia.com/v1', CLOSED),
    ).toEqual({
      url: 'https://integrate.api.nvidia.com/v1',
      hostname: 'integrate.api.nvidia.com',
    });
  });

  it('a public address literal', () => {
    expect(assertSafeBaseUrl('https://8.8.8.8/v1', CLOSED).url).toBe(
      'https://8.8.8.8/v1',
    );
  });

  it('a non-default port', () => {
    expect(
      assertSafeBaseUrl('https://vllm.example.com:8000/v1', CLOSED).url,
    ).toBe('https://vllm.example.com:8000/v1');
  });

  it('trims the trailing slash so a path can be appended', () => {
    expect(assertSafeBaseUrl('https://openrouter.ai/api/v1/', CLOSED).url).toBe(
      'https://openrouter.ai/api/v1',
    );
  });

  // The returned hostname is what reaches DNS, so it must be resolvable as-is.
  // `new URL(u).hostname` keeps the brackets, and `[2606:4700::1111]` is
  // neither an address isIP recognises nor a name that resolves.
  it('returns a public IPv6 host without its brackets', () => {
    expect(assertSafeBaseUrl('https://[2606:4700::1111]/v1', CLOSED)).toEqual({
      url: 'https://[2606:4700::1111]/v1',
      hostname: '2606:4700::1111',
    });
  });

  it('returns a host without its trailing dot', () => {
    expect(
      assertSafeBaseUrl('https://openrouter.ai./v1', CLOSED).hostname,
    ).toBe('openrouter.ai');
  });
});

describe('the allowPrivate escape hatch', () => {
  it('lets a self-hoster reach Ollama on loopback', () => {
    expect(assertSafeBaseUrl('http://localhost:11434/v1', OPEN).url).toBe(
      'http://localhost:11434/v1',
    );
  });

  it('lets a self-hoster reach a private address', () => {
    expect(assertSafeBaseUrl('http://10.0.0.5:8000/v1', OPEN).url).toBe(
      'http://10.0.0.5:8000/v1',
    );
  });

  it('still rejects a URL that is not a URL', () => {
    expect(() => assertSafeBaseUrl('not a url at all', OPEN)).toThrow();
  });

  it('still rejects credentials', () => {
    expect(() =>
      assertSafeBaseUrl('http://user:secret@10.0.0.5/v1', OPEN),
    ).toThrow(/credentials/);
  });
});

describe('assertResolvesSafely', () => {
  afterEach(() => {
    mockedLookup.mockReset();
  });

  it('rejects a public name that resolves to a private address', async () => {
    mockedLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(
      assertResolvesSafely('rebind.example.com', CLOSED),
    ).rejects.toThrow(/private address/);
  });

  it('rejects when any one of several answers is private', async () => {
    mockedLookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    await expect(
      assertResolvesSafely('mixed.example.com', CLOSED),
    ).rejects.toThrow();
  });

  it('accepts a public name that resolves publicly', async () => {
    mockedLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    await expect(
      assertResolvesSafely('api.example.com', CLOSED),
    ).resolves.toBeUndefined();
  });

  it('does not resolve when the escape hatch is on', async () => {
    await expect(
      assertResolvesSafely('localhost', OPEN),
    ).resolves.toBeUndefined();
    expect(mockedLookup).not.toHaveBeenCalled();
  });
});

describe('allowPrivateHosts', () => {
  const original = process.env.ALLOW_PRIVATE_PROVIDER_HOSTS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ALLOW_PRIVATE_PROVIDER_HOSTS;
    } else {
      process.env.ALLOW_PRIVATE_PROVIDER_HOSTS = original;
    }
  });

  it('is off when unset', () => {
    delete process.env.ALLOW_PRIVATE_PROVIDER_HOSTS;
    expect(allowPrivateHosts()).toBe(false);
  });

  it('is off for any value but the exact opt-in', () => {
    process.env.ALLOW_PRIVATE_PROVIDER_HOSTS = '1';
    expect(allowPrivateHosts()).toBe(false);
  });

  it('is on only for the exact opt-in', () => {
    process.env.ALLOW_PRIVATE_PROVIDER_HOSTS = 'true';
    expect(allowPrivateHosts()).toBe(true);
  });
});
