import { isRecord, parseCredentials, type Credentials } from '../../domain/auth';
import { EPITECH_ORIGIN } from './api';

const SIGN_IN_ORIGINS = new Set([
  EPITECH_ORIGIN,
  'https://login.microsoftonline.com',
  'https://login.microsoft.com',
  'https://login.windows.net',
  'https://device.login.microsoftonline.com',
]);

export function isPortalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.origin === EPITECH_ORIGIN && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isAllowedSignInUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return !url.username && !url.password && SIGN_IN_ORIGINS.has(url.origin);
  } catch {
    return false;
  }
}

export interface BridgeRequest {
  readonly nonce: string;
  readonly expiresAt: number;
}

export type BridgeResult =
  | { kind: 'credentials'; credentials: Credentials }
  | { kind: 'not_ready' }
  | { kind: 'invalid_session' };

/** Called once, only after an explicit native button press on the school origin. */
export function createSessionTransferScript(nonce: string): string {
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(nonce)) throw new Error('Invalid bridge request');
  return `(() => {
    if (window.top !== window || window.location.origin !== ${JSON.stringify(EPITECH_ORIGIN)}) return true;
    const nonce = ${JSON.stringify(nonce)};
    const send = (kind, credentials) => window.ReactNativeWebView.postMessage(JSON.stringify({
      version: 1, origin: window.location.origin, nonce, kind, credentials
    }));
    try {
      const raw = window.localStorage.getItem('@account');
      if (!raw) { send('not_ready'); return true; }
      const account = JSON.parse(raw);
      if (!account || typeof account.token !== 'string' || typeof account.refresh_token !== 'string') {
        send('invalid_session'); return true;
      }
      const credentials = { accessToken: account.token, refreshToken: account.refresh_token };
      // This private login window is about to close. Do not retain the portal's
      // Epitech or MSAL storage alongside the native protected session.
      window.localStorage.clear();
      window.sessionStorage.clear();
      send('credentials', credentials);
    } catch { send('invalid_session'); }
    return true;
  })(); true;`;
}

export function parseBridgeMessage(
  data: string,
  sourceUrl: string,
  currentUrl: string,
  pending: BridgeRequest | null,
  now: number,
): BridgeResult | null {
  if (!pending || now >= pending.expiresAt || !isPortalUrl(sourceUrl) || !isPortalUrl(currentUrl) || data.length > 40_000) return null;
  try {
    const value: unknown = JSON.parse(data);
    if (!isRecord(value) || value.version !== 1 || value.origin !== EPITECH_ORIGIN || value.nonce !== pending.nonce) return null;
    if (value.kind === 'not_ready' || value.kind === 'invalid_session') return { kind: value.kind };
    if (value.kind !== 'credentials') return null;
    return { kind: 'credentials', credentials: parseCredentials(value.credentials) };
  } catch {
    return null;
  }
}

/** Native-side, one-shot authorization for a session transfer. */
export class PortalTransferGate {
  private pending: BridgeRequest | null = null;

  begin(currentUrl: string, nonce: string, now: number): string {
    if (!isPortalUrl(currentUrl)) throw new Error('School page required');
    const script = createSessionTransferScript(nonce);
    this.pending = { nonce, expiresAt: now + 10_000 };
    return script;
  }

  cancel(): void {
    this.pending = null;
  }

  receive(data: string, sourceUrl: string, currentUrl: string, now: number): BridgeResult | null {
    const result = parseBridgeMessage(data, sourceUrl, currentUrl, this.pending, now);
    if (result) this.pending = null;
    return result;
  }
}
