import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { createSessionTransferScript, isAllowedSignInUrl, isPortalUrl, parseBridgeMessage, PortalTransferGate } from '../src/providers/epitech/portalBridge';
import { credentials } from './helpers';

const nonce = 'synthetic-challenge-123456789';
const portal = 'https://my.epitech.eu/dashboard';
const pending = { nonce, expiresAt: 20_000 };
const message = (extra: Record<string, unknown> = {}) => JSON.stringify({ version: 1, origin: 'https://my.epitech.eu', nonce, kind: 'credentials', credentials, ...extra });

describe('portal navigation boundary', () => {
  it.each(['http://my.epitech.eu', 'https://my.epitech.eu.evil.invalid', 'https://evil.invalid/my.epitech.eu', 'https://user@my.epitech.eu', 'https://my.epitech.eu:444', 'javascript:alert(1)', 'file:///private', 'intent://login', 'not a URL'])('rejects %s', url => {
    expect(isPortalUrl(url)).toBe(false);
    expect(isAllowedSignInUrl(url)).toBe(false);
  });

  it('permits only exact school and known Microsoft HTTPS origins', () => {
    expect(isPortalUrl(portal)).toBe(true);
    expect(isAllowedSignInUrl('https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize')).toBe(true);
    expect(isPortalUrl('https://login.microsoftonline.com')).toBe(false);
    expect(isAllowedSignInUrl('https://login.microsoftonline.com.evil.invalid')).toBe(false);
  });
});

describe('native session transfer gate', () => {
  it('requires a current explicit request and exact native source/current origin', () => {
    expect(parseBridgeMessage(message(), portal, portal, pending, 10_000)).toEqual({ kind: 'credentials', credentials });
    expect(parseBridgeMessage(message(), portal, portal, null, 10_000)).toBeNull();
    expect(parseBridgeMessage(message(), 'https://login.microsoftonline.com', portal, pending, 10_000)).toBeNull();
    expect(parseBridgeMessage(message(), portal, 'https://login.microsoftonline.com', pending, 10_000)).toBeNull();
    expect(parseBridgeMessage(message(), portal, portal, pending, 20_000)).toBeNull();
    expect(parseBridgeMessage(message({ nonce: 'wrong' }), portal, portal, pending, 10_000)).toBeNull();
    expect(parseBridgeMessage(message({ origin: 'https://evil.invalid' }), portal, portal, pending, 10_000)).toBeNull();
  });

  it('rejects malformed and oversized data without throwing token-bearing errors', () => {
    for (const data of ['{', 'x'.repeat(40_001), message({ credentials: { accessToken: 'x' } }), message({ credentials: { accessToken: 'x y', refreshToken: 'z' } })]) {
      expect(parseBridgeMessage(data, portal, portal, pending, 10_000)).toBeNull();
    }
  });

  it('consumes a challenge once and cancels it on navigation/cancellation', () => {
    const gate = new PortalTransferGate();
    gate.begin(portal, nonce, 10_000);
    expect(gate.receive(message(), portal, portal, 10_001)).toEqual({ kind: 'credentials', credentials });
    expect(gate.receive(message(), portal, portal, 10_002)).toBeNull();
    gate.begin(portal, nonce, 11_000);
    gate.cancel();
    expect(gate.receive(message(), portal, portal, 11_001)).toBeNull();
  });

  it('does not arm on a Microsoft page or accept script content in a nonce', () => {
    const gate = new PortalTransferGate();
    expect(() => gate.begin('https://login.microsoftonline.com', nonce, 0)).toThrow();
    expect(() => createSessionTransferScript("x');alert('x")).toThrow();
  });
});

function browser(origin: string, account: string | null = JSON.stringify({ token: credentials.accessToken, refresh_token: credentials.refreshToken })) {
  const storage = new Map<string, string>();
  if (account !== null) storage.set('@account', account);
  storage.set('msal-private-cache', 'DO-NOT-TRANSFER-MICROSOFT-CREDENTIALS');
  const postMessage = vi.fn();
  const getItem = vi.fn((key: string) => storage.get(key) ?? null);
  const clear = vi.fn(() => storage.clear());
  const sessionClear = vi.fn();
  const window = {
    location: { origin }, top: null as unknown,
    localStorage: { getItem, clear }, sessionStorage: { clear: sessionClear },
    ReactNativeWebView: { postMessage },
  };
  window.top = window;
  return { window, postMessage, getItem, clear, sessionClear };
}

describe('executed transfer script', () => {
  it('reads only the school session, clears the private portal storage and emits only that pair', () => {
    const page = browser('https://my.epitech.eu');
    runInNewContext(createSessionTransferScript(nonce), { window: page.window });
    expect(page.getItem).toHaveBeenCalledExactlyOnceWith('@account');
    expect(page.clear).toHaveBeenCalledOnce();
    expect(page.sessionClear).toHaveBeenCalledOnce();
    const data = page.postMessage.mock.calls[0]?.[0] as string;
    expect(JSON.parse(data)).toEqual({ version: 1, origin: 'https://my.epitech.eu', nonce, kind: 'credentials', credentials });
    expect(data).not.toContain('DO-NOT-TRANSFER');
  });

  it('does not touch Microsoft credential pages, even if navigation raced the tap', () => {
    const page = browser('https://login.microsoftonline.com');
    runInNewContext(createSessionTransferScript(nonce), { window: page.window });
    expect(page.getItem).not.toHaveBeenCalled();
    expect(page.clear).not.toHaveBeenCalled();
    expect(page.postMessage).not.toHaveBeenCalled();
  });

  it('does not read a framed document', () => {
    const page = browser('https://my.epitech.eu');
    page.window.top = {};
    runInNewContext(createSessionTransferScript(nonce), { window: page.window });
    expect(page.getItem).not.toHaveBeenCalled();
    expect(page.postMessage).not.toHaveBeenCalled();
  });

  it('reports that the student must finish signing in', () => {
    const page = browser('https://my.epitech.eu', null);
    runInNewContext(createSessionTransferScript(nonce), { window: page.window });
    expect(JSON.parse(page.postMessage.mock.calls[0]?.[0] as string).kind).toBe('not_ready');
    expect(page.clear).not.toHaveBeenCalled();
  });

  it('reports malformed school storage without copying it into a message', () => {
    const page = browser('https://my.epitech.eu', '{broken secret');
    runInNewContext(createSessionTransferScript(nonce), { window: page.window });
    const data = page.postMessage.mock.calls[0]?.[0] as string;
    expect(JSON.parse(data).kind).toBe('invalid_session');
    expect(data).not.toContain('broken secret');
  });
});
