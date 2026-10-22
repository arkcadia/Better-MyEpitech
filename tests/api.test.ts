import { describe, expect, it, vi } from 'vitest';

import { AuthError } from '../src/domain/auth';
import { EPITECH_API, HttpEpitechAuthApi, type Fetcher } from '../src/providers/epitech/api';
import { credentials, student } from './helpers';

const signal = () => new AbortController().signal;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('Epitech authentication transport', () => {
  it('uses only the fixed HTTPS own-session endpoint and omits browser cookies', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(json({ login: student.login, roles: ['student'] }));
    const api = new HttpEpitechAuthApi(fetcher);
    await expect(api.verify(credentials.accessToken, signal())).resolves.toEqual({ login: student.login, roles: ['student'] });
    expect(fetcher).toHaveBeenCalledWith(`${EPITECH_API}/auth/verify`, expect.objectContaining({
      method: 'GET', redirect: 'error', credentials: 'omit',
      headers: { Accept: 'application/json', Authorization: `Bearer ${credentials.accessToken}` },
    }));
  });

  it('requests only the current student profile, never a caller-provided login', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(json({
      login: student.login, firstname: student.firstName, lastname: student.lastName, campus: { name: student.campus },
      privateUnrelatedField: 'not copied to the view model',
    }));
    const api = new HttpEpitechAuthApi(fetcher);
    await expect(api.ownProfile(credentials.accessToken, signal())).resolves.toEqual(student);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${EPITECH_API}/students/profile`);
  });

  it('sends a refresh token in JSON without an access bearer header', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(json({ access_token: 'new-access', refresh_token: 'new-refresh' }));
    const api = new HttpEpitechAuthApi(fetcher);
    await expect(api.refresh(credentials, signal())).resolves.toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    expect(fetcher).toHaveBeenCalledWith(`${EPITECH_API}/auth/refresh`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ refresh_token: credentials.refreshToken }),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    }));
  });

  it('keeps the existing refresh token if the server does not rotate it', async () => {
    const api = new HttpEpitechAuthApi(vi.fn<Fetcher>().mockResolvedValue(json({ access_token: 'new-access' })));
    await expect(api.refresh(credentials, signal())).resolves.toEqual({ accessToken: 'new-access', refreshToken: credentials.refreshToken });
  });

  it.each([401, 403, 429, 503, 400])('maps HTTP %s without exposing its response body', async status => {
    const api = new HttpEpitechAuthApi(vi.fn<Fetcher>().mockResolvedValue(json({ message: 'PRIVATE-RESPONSE-CONTENT' }, status)));
    const error = await api.verify(credentials.accessToken, signal()).catch(error => error);
    expect(error).toBeInstanceOf(AuthError);
    expect(error.code).toBe(status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 429 || status >= 500 ? 'server' : 'contract');
    expect(error.message).not.toContain('PRIVATE-RESPONSE-CONTENT');
  });

  it('rejects redirects even if a fetch implementation follows one', async () => {
    const response = json({ login: student.login, roles: ['student'] });
    Object.defineProperty(response, 'url', { value: 'https://unexpected.example.invalid/redirect' });
    const api = new HttpEpitechAuthApi(vi.fn<Fetcher>().mockResolvedValue(response));
    await expect(api.verify(credentials.accessToken, signal())).rejects.toMatchObject({ code: 'contract' });
  });

  it('rejects changed verification and refresh contracts', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce(json({ login: student.login })).mockResolvedValueOnce(json({ access_token: 'new', refresh_token: null }));
    const api = new HttpEpitechAuthApi(fetcher);
    await expect(api.verify(credentials.accessToken, signal())).rejects.toMatchObject({ code: 'contract' });
    await expect(api.refresh(credentials, signal())).rejects.toMatchObject({ code: 'contract' });
  });

  it('rejects non-JSON successful responses', async () => {
    const api = new HttpEpitechAuthApi(vi.fn<Fetcher>().mockResolvedValue(new Response('<html>Login page</html>')));
    await expect(api.verify(credentials.accessToken, signal())).rejects.toMatchObject({ code: 'contract' });
  });

  it('redacts arbitrary transport exceptions', async () => {
    const api = new HttpEpitechAuthApi(vi.fn<Fetcher>().mockRejectedValue(new Error('Bearer PRIVATE-TOKEN')));
    await expect(api.verify(credentials.accessToken, signal())).rejects.toMatchObject({ code: 'network', message: expect.not.stringContaining('PRIVATE-TOKEN') });
  });

  it('does not start a request after cancellation', async () => {
    const fetcher = vi.fn<Fetcher>();
    const api = new HttpEpitechAuthApi(fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(api.verify(credentials.accessToken, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('aborts a stalled request after the configured timeout', async () => {
    const fetcher: Fetcher = (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    const api = new HttpEpitechAuthApi(fetcher, 5);
    await expect(api.verify(credentials.accessToken, signal())).rejects.toMatchObject({ code: 'timeout' });
  });
});
