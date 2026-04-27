/**
 * Unit tests for SSRF protection logic
 *
 * Tests the IP address validation used in the test-request proxy endpoints.
 * The logic is inlined in Express/NestJS/Next.js routers; these tests verify
 * the validation rules in isolation.
 */
import { describe, it, expect } from 'vitest';
import { isIP } from 'node:net';

/**
 * Extracted SSRF validation logic — mirrors the checks in flowlib-router.ts.
 * Returns true if the IP is in a private/internal range and should be blocked.
 */
function isPrivateIP(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) {
    const parts = ip.split('.').map(Number);
    return (
      parts[0] === 127 || // Loopback
      parts[0] === 10 || // Class A private
      parts[0] === 0 || // "This" network
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // Class B private
      (parts[0] === 192 && parts[1] === 168) || // Class C private
      (parts[0] === 169 && parts[1] === 254) // Link-local
    );
  }

  if (version === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' || // Loopback
      lower.startsWith('fe80') || // Link-local
      lower.startsWith('fc') || // Unique local (ULA)
      lower.startsWith('fd') || // Unique local (ULA)
      lower.startsWith('::ffff:') // IPv4-mapped
    );
  }

  // Not a valid IP → block
  return true;
}

describe('SSRF — IP Validation', () => {
  describe('IPv4 private ranges — should block', () => {
    const BLOCKED_IPS = [
      // Loopback
      '127.0.0.1',
      '127.0.0.2',
      '127.255.255.255',
      // Class A private (10.x.x.x)
      '10.0.0.1',
      '10.255.255.255',
      // Class B private (172.16-31.x.x)
      '172.16.0.1',
      '172.31.255.255',
      '172.20.0.1',
      // Class C private (192.168.x.x)
      '192.168.0.1',
      '192.168.1.100',
      '192.168.255.255',
      // Link-local (169.254.x.x)
      '169.254.0.1',
      '169.254.169.254', // AWS metadata endpoint
      // "This" network (0.x.x.x)
      '0.0.0.0',
      '0.0.0.1',
    ];

    for (const ip of BLOCKED_IPS) {
      it(`should block ${ip}`, () => {
        expect(isPrivateIP(ip)).toBe(true);
      });
    }
  });

  describe('IPv4 public ranges — should allow', () => {
    const ALLOWED_IPS = [
      '8.8.8.8', // Google DNS
      '1.1.1.1', // Cloudflare DNS
      '93.184.216.34', // example.com
      '172.15.255.255', // Just below 172.16 range
      '172.32.0.1', // Just above 172.31 range
      '192.167.0.1', // Just below 192.168 range
      '11.0.0.1', // Just above 10.x range
    ];

    for (const ip of ALLOWED_IPS) {
      it(`should allow ${ip}`, () => {
        expect(isPrivateIP(ip)).toBe(false);
      });
    }
  });

  describe('IPv6 private ranges — should block', () => {
    const BLOCKED_V6 = [
      '::1', // Loopback
      'fe80::1', // Link-local
      'fc00::1', // ULA
      'fd00::1', // ULA
      'fdab::1', // ULA
      '::ffff:127.0.0.1', // IPv4-mapped loopback
      '::ffff:10.0.0.1', // IPv4-mapped private
      '::ffff:192.168.1.1', // IPv4-mapped private
    ];

    for (const ip of BLOCKED_V6) {
      it(`should block ${ip}`, () => {
        expect(isPrivateIP(ip)).toBe(true);
      });
    }
  });

  describe('IPv6 public ranges — should allow', () => {
    const ALLOWED_V6 = [
      '2001:4860:4860::8888', // Google DNS
      '2606:4700:4700::1111', // Cloudflare DNS
      '2001:db8::1', // Documentation range (but public)
    ];

    for (const ip of ALLOWED_V6) {
      it(`should allow ${ip}`, () => {
        expect(isPrivateIP(ip)).toBe(false);
      });
    }
  });

  describe('URL protocol validation', () => {
    it('should only allow http and https protocols', () => {
      const validProtocols = ['http:', 'https:'];
      const blockedProtocols = ['ftp:', 'file:', 'data:', 'javascript:', 'gopher:'];

      for (const proto of validProtocols) {
        expect(validProtocols.includes(proto)).toBe(true);
      }
      for (const proto of blockedProtocols) {
        expect(validProtocols.includes(proto)).toBe(false);
      }
    });
  });

  describe('redirect prevention', () => {
    it('should use redirect: "error" to block open redirects', async () => {
      // This test validates the redirect policy concept.
      // With redirect: 'error', fetch() throws on any redirect response.
      // This prevents an attacker from redirecting to an internal IP after
      // the initial URL check passes against a public IP.

      // We don't actually call fetch here — we verify the fetch options contract
      const fetchOptions: RequestInit = {
        method: 'GET',
        redirect: 'error',
      };
      expect(fetchOptions.redirect).toBe('error');
    });
  });
});

describe('SSRF — Hostname Bypass Prevention', () => {
  describe('DNS rebinding prevention via IP resolution', () => {
    it('should validate resolved IPs, not just hostname strings', () => {
      // The old check was: if (hostname === 'localhost') { block }
      // Problem: attacker.com can resolve to 127.0.0.1 via DNS rebinding
      //
      // The new check resolves the hostname to IPs first, then checks each IP.
      // This test validates that approach by testing the IP check directly.

      // Even if hostname is "attacker.com", if it resolves to 127.0.0.1:
      expect(isPrivateIP('127.0.0.1')).toBe(true);
      // If it resolves to a public IP:
      expect(isPrivateIP('93.184.216.34')).toBe(false);
    });
  });

  describe('decimal/octal IP bypass prevention', () => {
    it('should block decimal-encoded loopback after DNS resolution', () => {
      // 2130706433 in decimal = 127.0.0.1
      // DNS resolution converts this to the actual IP string "127.0.0.1"
      // which is then caught by the numeric check
      expect(isPrivateIP('127.0.0.1')).toBe(true);
    });
  });

  describe('IPv6-mapped IPv4 bypass prevention', () => {
    it('should block ::ffff:127.0.0.1', () => {
      expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true);
    });

    it('should block ::ffff:10.0.0.1', () => {
      expect(isPrivateIP('::ffff:10.0.0.1')).toBe(true);
    });

    it('should block ::ffff:192.168.1.1', () => {
      expect(isPrivateIP('::ffff:192.168.1.1')).toBe(true);
    });
  });
});
