import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

// Extract and test verifySlackRequest logic directly
// since it's not exported from the route module
function verifySlackRequest(body: string, timestamp: string, signature: string, secret: string): boolean {
  const fiveMinutes = 5 * 60;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > fiveMinutes) return false;

  const sigBase = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', secret).update(sigBase).digest('hex');
  const computed = `v0=${hmac}`;

  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
}

function createValidSignature(body: string, timestamp: string, secret: string): string {
  const sigBase = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', secret).update(sigBase).digest('hex');
  return `v0=${hmac}`;
}

describe('verifySlackRequest', () => {
  const secret = 'test-signing-secret-12345';

  it('accepts a valid signature with current timestamp', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = 'token=abc&text=hello';
    const signature = createValidSignature(body, timestamp, secret);

    expect(verifySlackRequest(body, timestamp, signature, secret)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = 'token=abc&text=hello';
    const signature = 'v0=0000000000000000000000000000000000000000000000000000000000000000';

    expect(verifySlackRequest(body, timestamp, signature, secret)).toBe(false);
  });

  it('rejects a timestamp older than 5 minutes (replay protection)', () => {
    const sixMinutesAgo = (Math.floor(Date.now() / 1000) - 360).toString();
    const body = 'token=abc&text=hello';
    const signature = createValidSignature(body, sixMinutesAgo, secret);

    expect(verifySlackRequest(body, sixMinutesAgo, signature, secret)).toBe(false);
  });

  it('accepts a timestamp within 5 minutes', () => {
    const fourMinutesAgo = (Math.floor(Date.now() / 1000) - 240).toString();
    const body = 'token=abc&text=hello';
    const signature = createValidSignature(body, fourMinutesAgo, secret);

    expect(verifySlackRequest(body, fourMinutesAgo, signature, secret)).toBe(true);
  });

  it('rejects when body has been tampered with', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const originalBody = 'token=abc&text=hello';
    const signature = createValidSignature(originalBody, timestamp, secret);
    const tamperedBody = 'token=abc&text=hacked';

    expect(verifySlackRequest(tamperedBody, timestamp, signature, secret)).toBe(false);
  });
});
