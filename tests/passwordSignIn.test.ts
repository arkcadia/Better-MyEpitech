import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, type Credentials } from '../src/domain/auth';
import { HttpEpitechAuthApi } from '../src/providers/epitech/api';
import { SessionManager } from '../src/application/sessionManager';
import { credentials, deferred, fakeApi, MemoryVault, student } from './helpers';

// Fictional credentials only. No test attempts a login against the school.
const password = 'fictional password with spaces ';
const response = () => new Response(JSON.stringify({
  access_token: credentials.accessToken, refresh_token: credentials.refreshToken,
}));
afterEach(() => vi.useRealTimers());

describe('school email/password transport', () => {
  it('posts only to the exact school endpoint, preserving password bytes and omitting cookies, bearer and referrer', async () => {
    const transport = vi.fn(async () => response());
    const api = new HttpEpitechAuthApi(transport);
    expect(await api.signInWithPassword(` ${student.login} `, password, new AbortController().signal)).toEqual(credentials);
    expect(transport).toHaveBeenCalledExactlyOnceWith('https://my.epitech.eu/api/auth/external', expect.objectContaining({
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: student.login, password }),
    }));
  });
  it.each([400, 401, 403] as const)('preserves HTTP %s without blaming the password, exposing provider text or retrying', async status => {
    const transport = vi.fn(async () => new Response('private provider error', { status }));
    const api = new HttpEpitechAuthApi(transport);
    await expect(api.signInWithPassword(student.login, password, new AbortController().signal))
      .rejects.toMatchObject({ code: 'invalid_credentials', httpStatus: status, message: new AuthError('invalid_credentials', status).message });
    expect(transport).toHaveBeenCalledOnce();
  });
  it.each([
    ['', password], ['wrong-address', password], [student.login, ''], [student.login, 'x'.repeat(4097)],
  ])('rejects invalid input before sending it', async (email, value) => {
    const transport = vi.fn();
    await expect(new HttpEpitechAuthApi(transport).signInWithPassword(email, value, new AbortController().signal))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects incomplete tokens and never exposes a raw transport exception', async () => {
    const api = new HttpEpitechAuthApi(async () => new Response(JSON.stringify({ access_token: 'access' })));
    await expect(api.signInWithPassword(student.login, password, new AbortController().signal)).rejects.toMatchObject({ code: 'contract' });
    const failing = new HttpEpitechAuthApi(async () => { throw new Error(`private ${password}`); });
    await expect(failing.signInWithPassword(student.login, password, new AbortController().signal))
      .rejects.toMatchObject({ message: new AuthError('network').message });
  });
  it('rejects an unexpected response origin', async () => {
    const result = response();
    Object.defineProperty(result, 'url', { value: 'https://other.example.invalid/auth/external' });
    await expect(new HttpEpitechAuthApi(async () => result).signInWithPassword(student.login, password, new AbortController().signal))
      .rejects.toMatchObject({ code: 'contract' });
  });
  it('cancels a slow body and enforces the timeout even when the transport ignores abort', async () => {
    vi.useFakeTimers();
    const body = deferred<unknown>();
    const result = response();
    vi.spyOn(result, 'json').mockReturnValue(body.promise);
    const transport = vi.fn(async () => result);
    const pending = new HttpEpitechAuthApi(transport, 10).signInWithPassword(student.login, password, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(11);
    body.resolve({ access_token: 'late', refresh_token: 'late-refresh' });
    await expect(pending).rejects.toMatchObject({ code: 'timeout' });
  });
});

function setup() {
  const api = { ...fakeApi(), signInWithPassword: vi.fn(async (_email: string, _password: string, _signal: AbortSignal): Promise<Credentials> => credentials) };
  const vault = new MemoryVault();
  const session = new SessionManager(api, vault);
  return { api, vault, session };
}
describe('password sign-in uses the existing student session boundary', () => {
  it('verifies role and own-profile identity before storing tokens, and stores neither the email input nor password', async () => {
    const { api, vault, session } = setup();
    await session.connectWithPassword('alias@example.invalid', password);
    expect(api.verify).toHaveBeenCalledOnce();
    expect(api.ownProfile).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({ status: 'connected', student });
    expect(vault.value).toEqual({ version: 1, credentials, login: student.login });
    expect(JSON.stringify(vault.value)).not.toContain(password);
    expect(JSON.stringify(session.getSnapshot())).not.toContain(password);
    expect(JSON.stringify(vault.value)).not.toContain('alias@');
  });
  it('rejects staff-only accounts even after a successful password exchange', async () => {
    const { api, vault, session } = setup();
    api.verify.mockResolvedValue({ login: student.login, roles: ['external', 'staff'] });
    await session.connectWithPassword(student.login, password);
    expect(session.getSnapshot().issue?.code).toBe('not_student');
    expect(api.ownProfile).not.toHaveBeenCalled();
    expect(vault.writes).toHaveLength(0);
    expect(vault.value).toBeNull();
  });
  it('rejects mismatched verify/profile responses', async () => {
    const { api, vault, session } = setup();
    api.ownProfile.mockResolvedValue({ ...student, login: 'other@example.invalid' });
    await session.connectWithPassword(student.login, password);
    expect(session.getSnapshot().issue?.code).toBe('identity_mismatch');
    expect(vault.value).toBeNull();
  });
  it('cancels a late password response after disconnect', async () => {
    const { api, vault, session } = setup();
    const exchange = deferred<Credentials>();
    api.signInWithPassword.mockReturnValueOnce(exchange.promise);
    const pending = session.connectWithPassword(student.login, password);
    await vi.waitFor(() => expect(api.signInWithPassword).toHaveBeenCalledOnce());
    await session.disconnect();
    exchange.resolve(credentials);
    await pending;
    expect(api.verify).not.toHaveBeenCalled();
    expect(vault.writes).toHaveLength(0);
    expect(session.getSnapshot()).toMatchObject({ status: 'disconnected', student: null });
  });
  it('keeps a newer portal session when an older password request finishes late', async () => {
    const { api, vault, session } = setup();
    const exchange = deferred<Credentials>();
    api.signInWithPassword.mockReturnValueOnce(exchange.promise);
    const pending = session.connectWithPassword(student.login, password);
    await vi.waitFor(() => expect(api.signInWithPassword).toHaveBeenCalledOnce());
    await session.connectFromPortal(credentials);
    exchange.resolve({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    await pending;
    expect(api.verify).toHaveBeenCalledOnce();
    expect(vault.writes).toHaveLength(1);
    expect(vault.value?.credentials).toEqual(credentials);
    expect(session.getSnapshot()).toMatchObject({ status: 'connected', student });
  });
  it('ignores duplicate submits and can retry a rejected attempt', async () => {
    const { api, session } = setup();
    const exchange = deferred<Credentials>();
    api.signInWithPassword.mockReturnValueOnce(exchange.promise);
    const pending = session.connectWithPassword(student.login, password);
    await session.connectWithPassword(student.login, password);
    await vi.waitFor(() => expect(api.signInWithPassword).toHaveBeenCalledOnce());
    exchange.reject(new AuthError('invalid_credentials'));
    await pending;
    expect(session.getSnapshot().issue?.code).toBe('invalid_credentials');
    await session.connectWithPassword(student.login, password);
    expect(session.getSnapshot().status).toBe('connected');
  });
  it('stops before transmitting a password if secure removal of the old session fails', async () => {
    const { api, vault, session } = setup();
    vault.clear.mockRejectedValue(new Error('storage unavailable'));
    await session.connectWithPassword(student.login, password);
    expect(api.signInWithPassword).not.toHaveBeenCalled();
    expect(session.getSnapshot().issue?.code).toBe('storage');
  });
});
