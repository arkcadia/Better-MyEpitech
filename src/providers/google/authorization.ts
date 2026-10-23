import { requireOptionalNativeModule } from 'expo-modules-core';
import { GOOGLE_CALENDAR_SCOPE, GoogleCalendarError, type GoogleAccount, type GoogleAuthorization } from '../../domain/googleCalendar';

type NativeAuthorization = { authorize(email: string | null): Promise<{ accessToken: string; scopes: string[] }> };
export class AndroidGoogleAuthorization implements GoogleAuthorization {
  constructor(private readonly enabled: boolean, private readonly transport: typeof fetch = fetch) {}
  async authorize(expectedAccount?: GoogleAccount, signal?: AbortSignal) {
    if (signal?.aborted) throw new GoogleCalendarError('cancelled');
    if (!this.enabled) throw new GoogleCalendarError('setup');
    const native = requireOptionalNativeModule<NativeAuthorization>('BetterGoogleAuth');
    if (!native) throw new GoogleCalendarError('setup');
    let authorization: Awaited<ReturnType<NativeAuthorization['authorize']>>;
    try { authorization = await native.authorize(expectedAccount?.email ?? null); }
    catch (error) {
      const code = (error as { code?: string })?.code;
      throw new GoogleCalendarError(code === 'ERR_GOOGLE_CANCELLED' ? 'cancelled' : code === 'ERR_GOOGLE_BUSY' ? 'busy' : code === 'ERR_GOOGLE_SETUP' ? 'setup' : 'authorization');
    }
    if (signal?.aborted) throw new GoogleCalendarError('cancelled');
    if (typeof authorization.accessToken !== 'string' || !authorization.accessToken || authorization.accessToken.length > 16384 || /\s/.test(authorization.accessToken)) throw new GoogleCalendarError('contract');
    if (!Array.isArray(authorization.scopes) || !authorization.scopes.includes(GOOGLE_CALENDAR_SCOPE)) throw new GoogleCalendarError('permission');
    const controller = new AbortController(); const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 20_000);
    try {
      const response = await this.transport('https://www.googleapis.com/oauth2/v3/userinfo', {
        signal: controller.signal, redirect: 'error', credentials: 'omit',
        headers: { Authorization: `Bearer ${authorization.accessToken}`, Accept: 'application/json' },
      });
      if (signal?.aborted) throw new GoogleCalendarError('cancelled');
      if (response.url && response.url !== 'https://www.googleapis.com/oauth2/v3/userinfo') throw new GoogleCalendarError('contract');
      if (!response.ok) throw new GoogleCalendarError('authorization');
      const user = await response.json() as Record<string, unknown>;
      if (signal?.aborted) throw new GoogleCalendarError('cancelled');
      if (!user || typeof user.sub !== 'string' || !user.sub || user.sub.length > 255 || typeof user.email !== 'string' || !user.email || user.email.length > 320 || user.email_verified !== true) throw new GoogleCalendarError('contract');
      const account = { id: user.sub, email: user.email };
      if (expectedAccount && (expectedAccount.id !== account.id || expectedAccount.email !== account.email)) throw new GoogleCalendarError('account');
      return { account, accessToken: authorization.accessToken };
    } catch (error) { throw error instanceof GoogleCalendarError ? error : new GoogleCalendarError(signal?.aborted ? 'cancelled' : 'network'); }
    finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }
}
