/**
 * URL validation for gossip peer endpoints.
 *
 * Prevents SSRF by blocking requests to private/internal networks.
 * Validates at peer registration time and before every outbound fetch.
 */

import dns from 'dns/promises';

/**
 * Check if an IP address is in a private, loopback, or reserved range.
 */
function isPrivateIp(ip: string): boolean {
  // IPv4 private/reserved ranges
  const patterns = [
    /^127\./, // Loopback
    /^10\./, // RFC 1918
    /^172\.(1[6-9]|2\d|3[01])\./, // RFC 1918
    /^192\.168\./, // RFC 1918
    /^169\.254\./, // Link-local / cloud metadata
    /^0\./, // "This" network
    /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./, // CGNAT (RFC 6598)
    /^192\.0\.0\./, // IETF protocol assignments
    /^192\.0\.2\./, // TEST-NET-1
    /^198\.51\.100\./, // TEST-NET-2
    /^203\.0\.113\./, // TEST-NET-3
    /^224\./, // Multicast
    /^240\./, // Reserved
    /^255\.255\.255\.255$/, // Broadcast
  ];

  // IPv6 private/reserved
  const ipv6Patterns = [
    /^::1$/, // Loopback
    /^fe80:/i, // Link-local
    /^fc/i, // Unique local (RFC 4193)
    /^fd/i, // Unique local (RFC 4193)
    /^::ffff:127\./i, // IPv4-mapped loopback
    /^::ffff:10\./i, // IPv4-mapped private
    /^::ffff:172\.(1[6-9]|2\d|3[01])\./i, // IPv4-mapped private
    /^::ffff:192\.168\./i, // IPv4-mapped private
    /^::ffff:169\.254\./i, // IPv4-mapped link-local
  ];

  return patterns.some((p) => p.test(ip)) || ipv6Patterns.some((p) => p.test(ip));
}

/**
 * Blocked hostnames that should never be used as peer endpoints.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  '[::1]',
  'metadata.google.internal',
  'metadata.google',
]);

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a peer endpoint URL for SSRF safety.
 *
 * Checks:
 * 1. Must be http:// or https:// (no file://, ftp://, etc.)
 * 2. Hostname must not be a blocked name (localhost, metadata, etc.)
 * 3. Resolved IPs must not be in private/reserved ranges
 *
 * Note: Tailscale IPs (100.64-127.x.x) are blocked by the CGNAT range check.
 * This is intentional — peers should be publicly reachable. For local
 * development, set ALLOW_PRIVATE_PEER_ENDPOINTS=true.
 */
export async function validatePeerEndpoint(endpoint: string): Promise<UrlValidationResult> {
  // Allow private endpoints in development
  if (process.env.ALLOW_PRIVATE_PEER_ENDPOINTS === 'true') {
    try {
      const url = new URL(endpoint);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return { valid: false, error: 'Endpoint must use http:// or https://' };
      }
      return { valid: true };
    } catch {
      return { valid: false, error: 'Invalid URL' };
    }
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { valid: false, error: 'Invalid URL' };
  }

  // 1. Protocol check
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { valid: false, error: 'Endpoint must use http:// or https://' };
  }

  // 2. Hostname blocklist
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, error: 'Endpoint hostname is blocked' };
  }

  // 3. Direct IP check (if hostname is an IP literal)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith('[')) {
    const ip = hostname.replace(/^\[|\]$/g, '');
    if (isPrivateIp(ip)) {
      return { valid: false, error: 'Endpoint resolves to a private address' };
    }
    return { valid: true };
  }

  // 4. DNS resolution check
  try {
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const allAddresses = [...addresses, ...addresses6];

    if (allAddresses.length === 0) {
      // Can't resolve — allow (might be a hostname the server can reach but we can't resolve here)
      return { valid: true };
    }

    const privateAddr = allAddresses.find((addr) => isPrivateIp(addr));
    if (privateAddr) {
      return { valid: false, error: 'Endpoint resolves to a private address' };
    }
  } catch {
    // DNS failure — allow (will fail at fetch time anyway)
  }

  return { valid: true };
}
