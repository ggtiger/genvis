import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { identifyPlatform } from '../fetcher';

/**
 * **Validates: Requirements 1.3**
 *
 * Property 8: URL Platform Identification
 *
 * For any URL string where the hostname is 'clawhub.ai' or ends with '.clawhub.ai',
 * identifyPlatform should return 'openclaw'.
 * For any URL string where the hostname does NOT contain 'clawhub.ai',
 * identifyPlatform should return 'unknown'.
 * For any invalid/empty URL, identifyPlatform should return 'unknown'.
 */
describe('Property 8: URL Platform Identification', () => {
  /**
   * Arbitrary: random path segments for URLs (e.g. /user/skill-name)
   */
  const arbPathSegment = fc
    .stringMatching(/^[a-zA-Z0-9_-]+$/)
    .filter((s) => s.length >= 1 && s.length <= 20);

  const arbPath = fc
    .array(arbPathSegment, { minLength: 0, maxLength: 4 })
    .map((segments) => (segments.length > 0 ? '/' + segments.join('/') : ''));

  /**
   * Arbitrary: random protocol (http or https)
   */
  const arbProtocol = fc.constantFrom('http', 'https');

  /**
   * Arbitrary: valid URLs with exact hostname 'clawhub.ai'
   */
  const arbClawHubRootUrl = fc
    .tuple(arbProtocol, arbPath)
    .map(([proto, path]) => `${proto}://clawhub.ai${path}`);

  /**
   * Arbitrary: random subdomain labels for clawhub.ai (e.g. api, www, cdn)
   */
  const arbSubdomainLabel = fc
    .stringMatching(/^[a-z][a-z0-9]*$/)
    .filter((s) => s.length >= 1 && s.length <= 15);

  const arbSubdomain = fc
    .array(arbSubdomainLabel, { minLength: 1, maxLength: 3 })
    .map((labels) => labels.join('.'));

  /**
   * Arbitrary: valid URLs with subdomains of clawhub.ai (e.g. api.clawhub.ai)
   */
  const arbClawHubSubdomainUrl = fc
    .tuple(arbProtocol, arbSubdomain, arbPath)
    .map(([proto, sub, path]) => `${proto}://${sub}.clawhub.ai${path}`);

  /**
   * Arbitrary: non-clawhub domain names that do NOT contain 'clawhub.ai'
   */
  const arbNonClawHubDomain = fc
    .tuple(
      fc.stringMatching(/^[a-z][a-z0-9]*$/).filter((s) => s.length >= 2 && s.length <= 15),
      fc.constantFrom('com', 'org', 'net', 'io', 'dev', 'ai', 'co')
    )
    .map(([name, tld]) => `${name}.${tld}`)
    .filter((domain) => domain !== 'clawhub.ai' && !domain.endsWith('.clawhub.ai'));

  /**
   * Arbitrary: valid URLs with non-clawhub domains
   */
  const arbNonClawHubUrl = fc
    .tuple(arbProtocol, arbNonClawHubDomain, arbPath)
    .map(([proto, domain, path]) => `${proto}://${domain}${path}`);

  /**
   * Arbitrary: invalid/non-URL strings
   */
  const arbInvalidUrl = fc.oneof(
    fc.constant(''),
    fc.stringMatching(/^[a-zA-Z0-9 _!@#$%^&*]+$/).filter((s) => {
      try {
        new URL(s);
        return false; // skip if it accidentally parses as a valid URL
      } catch {
        return true;
      }
    }),
    fc.constant('not-a-url'),
    fc.constant('ftp://missing-host'),
    fc.constant('://no-protocol'),
    fc.constant('just some random text')
  );

  // --- Test 1: clawhub.ai root hostname → 'openclaw' ---
  it('returns "openclaw" for any valid URL with hostname clawhub.ai', () => {
    fc.assert(
      fc.property(arbClawHubRootUrl, (url) => {
        expect(identifyPlatform(url)).toBe('openclaw');
      }),
      { numRuns: 100 }
    );
  });

  // --- Test 2: clawhub.ai subdomains → 'openclaw' ---
  it('returns "openclaw" for any valid URL with a subdomain of clawhub.ai', () => {
    fc.assert(
      fc.property(arbClawHubSubdomainUrl, (url) => {
        expect(identifyPlatform(url)).toBe('openclaw');
      }),
      { numRuns: 100 }
    );
  });

  // --- Test 3: non-clawhub domains → 'unknown' ---
  it('returns "unknown" for any valid URL with a non-clawhub domain', () => {
    fc.assert(
      fc.property(arbNonClawHubUrl, (url) => {
        expect(identifyPlatform(url)).toBe('unknown');
      }),
      { numRuns: 100 }
    );
  });

  // --- Test 4: invalid/empty URLs → 'unknown' ---
  it('returns "unknown" for any invalid or empty URL string', () => {
    fc.assert(
      fc.property(arbInvalidUrl, (url) => {
        expect(identifyPlatform(url)).toBe('unknown');
      }),
      { numRuns: 100 }
    );
  });
});
