import { documentReadPath, schoolBinaryPath } from './documentPaths';
import {
  AuthError,
  isRecord,
  isToken,
  normalizedLogin,
  validatePasswordSignIn,
  type Credentials,
  type EpitechAuthApi,
  type SchoolIdentity,
  type VerifiedStudent,
} from '../../domain/auth';

export const EPITECH_ORIGIN = 'https://my.epitech.eu';
export const EPITECH_API = `${EPITECH_ORIGIN}/api`;
export const PORTAL_URL = `${EPITECH_ORIGIN}/dashboard`;

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Only observed student reads may receive the school bearer token. */
export function schoolReadPath(path: string): string {
  if (typeof path !== 'string' || path.length > 2_048 || /[\\\s#]/.test(path)) throw new AuthError('contract');
  const documentPath = documentReadPath(path);
  if (documentPath) return documentPath;
  const [route = '', query = '', ...extra] = path.split('?');
  if (extra.length || !['/units/instances/projects', '/events'].includes(route)) throw new AuthError('contract');
  const params = new URLSearchParams(query);
  const allowed = route === '/events' ? ['startDate', 'endDate', 'registered'] : ['page', 'limit', 'registeredOnly', 'schoolYear'];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new AuthError('contract');
  }
  if (route === '/events') {
    const start = params.get('startDate');
    const end = params.get('endDate');
    const instant = (value: string | null): value is string => Boolean(value &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)));
    if (!instant(start) || !instant(end) || Date.parse(end) <= Date.parse(start) ||
        Date.parse(end) - Date.parse(start) > 32 * 86_400_000 ||
        (params.has('registered') && params.get('registered') !== 'me')) throw new AuthError('contract');
  } else {
    for (const key of ['page', 'limit', 'schoolYear']) {
      const value = params.get(key);
      if (value !== null && (!/^[1-9]\d*$/.test(value) || Number(value) > (key === 'limit' ? 1_000 : key === 'schoolYear' ? 9_999 : 100_000))) throw new AuthError('contract');
    }
    if (params.has('registeredOnly') && !['true', 'false'].includes(params.get('registeredOnly')!)) throw new AuthError('contract');
  }
  return `${route}${params.size ? `?${params.toString()}` : ''}`;
}

export class HttpEpitechAuthApi implements EpitechAuthApi {
  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMs = 20_000,
    private readonly binaryFetcher: Fetcher = fetcher,
  ) {}

  private async request(
    path: string,
    signal: AbortSignal,
    accessToken?: string,
    refreshToken?: string,
    rawResponse = false,
    passwordSignIn?: { email: string; password: string },
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
      const response = await (rawResponse ? this.binaryFetcher : this.fetcher)(`${EPITECH_API}${path}`, {
        method: refreshToken || passwordSignIn ? 'POST' : 'GET',
        headers: {
          Accept: 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(refreshToken || passwordSignIn ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(passwordSignIn
          ? { body: JSON.stringify(passwordSignIn) }
          : refreshToken ? { body: JSON.stringify({ refresh_token: refreshToken }) } : {}),
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      if (signal.aborted) throw new AuthError('cancelled');
      if (timedOut) throw new AuthError('timeout');
      if (response.url && response.url !== `${EPITECH_API}${path}`) throw new AuthError('contract');
      if (passwordSignIn && (response.status === 400 || response.status === 401 || response.status === 403)) {
        throw new AuthError('invalid_credentials', response.status);
      }
      if (response.status === 401) throw new AuthError('unauthorized');
      if (response.status === 403) throw new AuthError('forbidden');
      if (response.status === 429 || response.status >= 500) throw new AuthError('server');
      if (!response.ok) throw new AuthError('contract');
      if (rawResponse) return response;
      try {
        const value: unknown = await response.json();
        if (signal.aborted) throw new AuthError('cancelled');
        if (timedOut) throw new AuthError('timeout');
        return value;
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

  /** The school's external-account flow; Microsoft-only account support is not implied. */
  async signInWithPassword(email: string, password: string, signal: AbortSignal): Promise<Credentials> {
    validatePasswordSignIn(email, password);
    const value = await this.request('/auth/external', signal, undefined, undefined, false,
      { email: email.trim(), password });
    if (!isRecord(value) || !isToken(value.access_token) || !isToken(value.refresh_token)) {
      throw new AuthError('contract');
    }
    return { accessToken: value.access_token, refreshToken: value.refresh_token };
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

  async readSchoolFile(path: string, accessToken: string, signal: AbortSignal): Promise<Response> {
    return await this.request(schoolBinaryPath(path), signal, accessToken, undefined, true) as Response;
  }

  readSchool(path: string, accessToken: string, signal: AbortSignal): Promise<unknown> {
    return this.request(schoolReadPath(path), signal, accessToken);
  }
}
