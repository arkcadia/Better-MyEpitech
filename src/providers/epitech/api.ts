import {
  AuthError,
  isRecord,
  isToken,
  normalizedLogin,
  type Credentials,
  type EpitechAuthApi,
  type SchoolIdentity,
  type VerifiedStudent,
} from '../../domain/auth';

export const EPITECH_ORIGIN = 'https://my.epitech.eu';
export const EPITECH_API = `${EPITECH_ORIGIN}/api`;
export const PORTAL_URL = `${EPITECH_ORIGIN}/dashboard`;

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export class HttpEpitechAuthApi implements EpitechAuthApi {
  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMs = 20_000,
  ) {}

  private async request(
    path: '/auth/verify' | '/students/profile' | '/auth/refresh',
    signal: AbortSignal,
    accessToken?: string,
    refreshToken?: string,
  ): Promise<unknown> {
    if (signal.aborted) throw new AuthError('cancelled');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetcher(`${EPITECH_API}${path}`, {
        method: refreshToken ? 'POST' : 'GET',
        headers: {
          Accept: 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(refreshToken ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(refreshToken ? { body: JSON.stringify({ refresh_token: refreshToken }) } : {}),
        redirect: 'error',
        credentials: 'omit',
        signal: controller.signal,
      });
      if (signal.aborted) throw new AuthError('cancelled');
      if (timedOut) throw new AuthError('timeout');
      if (response.url && response.url !== `${EPITECH_API}${path}`) throw new AuthError('contract');
      if (response.status === 401) throw new AuthError('unauthorized');
      if (response.status === 403) throw new AuthError('forbidden');
      if (response.status === 429 || response.status >= 500) throw new AuthError('server');
      if (!response.ok) throw new AuthError('contract');
      try {
        return await response.json() as unknown;
      } catch {
        throw new AuthError('contract');
      }
    } catch (error) {
      if (signal.aborted) throw new AuthError('cancelled');
      if (timedOut) throw new AuthError('timeout');
      if (error instanceof AuthError) throw error;
      // Provider exception strings may contain a URL or private response data.
      throw new AuthError('network');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }

  async verify(accessToken: string, signal: AbortSignal): Promise<SchoolIdentity> {
    const value = await this.request('/auth/verify', signal, accessToken);
    if (!isRecord(value) || typeof value.login !== 'string' || !value.login.trim() ||
        !Array.isArray(value.roles) || !value.roles.every(role => typeof role === 'string')) {
      throw new AuthError('contract');
    }
    return { login: normalizedLogin(value.login), roles: value.roles as string[] };
  }

  async ownProfile(accessToken: string, signal: AbortSignal): Promise<VerifiedStudent> {
    const value = await this.request('/students/profile', signal, accessToken);
    if (!isRecord(value) || typeof value.login !== 'string' || !value.login.trim() ||
        typeof value.firstname !== 'string' || typeof value.lastname !== 'string') {
      throw new AuthError('contract');
    }
    const campus = isRecord(value.campus) && typeof value.campus.name === 'string' ? value.campus.name : null;
    return { login: normalizedLogin(value.login), firstName: value.firstname, lastName: value.lastname, campus };
  }

  async refresh(credentials: Credentials, signal: AbortSignal): Promise<Credentials> {
    const value = await this.request('/auth/refresh', signal, undefined, credentials.refreshToken);
    if (!isRecord(value) || !isToken(value.access_token) ||
        (value.refresh_token !== undefined && !isToken(value.refresh_token))) {
      throw new AuthError('contract');
    }
    return { accessToken: value.access_token, refreshToken: value.refresh_token ?? credentials.refreshToken };
  }
}
