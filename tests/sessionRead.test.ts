import { describe, expect, it, vi } from 'vitest';

import { SessionManager } from '../src/application/sessionManager';
import { AuthError } from '../src/domain/auth';
import { HttpEpitechAuthApi, EPITECH_API } from '../src/providers/epitech/api';
import { credentials, deferred, fakeApi, MemoryVault, renewed, student } from './helpers';

const projects = '/units/instances/projects?page=1&limit=50';
const signal = () => new AbortController().signal;

async function setup() {
  const api = fakeApi();
  const vault = new MemoryVault();
  const session = new SessionManager(api, vault, () => 1_000_000);
  await session.connectFromPortal(credentials);
  return { api, vault, session };
}

describe('account-bound school reads', () => {
  it('requires a verified student before a data request', async () => {
    const api = fakeApi();
    const session = new SessionManager(api, new MemoryVault());
    await expect(session.readSchool(projects, signal())).rejects.toMatchObject({ code: 'unauthorized' });
    expect(api.readSchool).not.toHaveBeenCalled();
  });

  it('keeps bearer handling out of the result and snapshot', async () => {
    const { session, api } = await setup();
    api.readSchool.mockResolvedValue({ data: [{ id: 1 }] });
    await expect(session.readSchool(projects, signal())).resolves.toEqual({ data: [{ id: 1 }] });
    expect(api.readSchool).toHaveBeenCalledExactlyOnceWith(projects, credentials.accessToken, expect.any(AbortSignal));
    expect(session.getSnapshot()).not.toHaveProperty('credentials');
  });

  it('refreshes an access token that has become expired before reading data', async () => {
    const api = fakeApi();
    const vault = new MemoryVault();
    let now = 1_000_000;
    const accessToken = `header.${btoa(JSON.stringify({ exp: 2_000 }))}.signature`;
    const session = new SessionManager(api, vault, () => now);
    await session.connectFromPortal({ ...credentials, accessToken });
    now = 2_000_000;
    await session.readSchool(projects, signal());
    expect(api.refresh).toHaveBeenCalledOnce();
    expect(api.readSchool).toHaveBeenCalledWith(projects, renewed.accessToken, expect.any(AbortSignal));
  });

  it('shares one rotation for simultaneous 401 responses', async () => {
    const { session, api, vault } = await setup();
    const rotation = deferred<typeof renewed>();
    api.refresh.mockReturnValueOnce(rotation.promise);
    api.readSchool.mockImplementation(async (_path, token) => {
      if (token === credentials.accessToken) throw new AuthError('unauthorized');
      expect(vault.value?.credentials).toEqual(renewed);
      return { data: [] };
    });
    const first = session.readSchool(projects, signal());
    const second = session.readSchool(projects, signal());
    await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledOnce());
    rotation.resolve(renewed);
    await Promise.all([first, second]);
    expect(api.refresh).toHaveBeenCalledOnce();
    expect(api.readSchool).toHaveBeenCalledTimes(4);
  });

  it('shares a pending manual renewal and does not start data requests early', async () => {
    const { session, api } = await setup();
    const rotation = deferred<typeof renewed>();
    api.refresh.mockReturnValueOnce(rotation.promise);
    const checking = session.checkConnection(true);
    const reading = session.readSchool(projects, signal());
    expect(api.readSchool).not.toHaveBeenCalled();
    rotation.resolve(renewed);
    await Promise.all([checking, reading]);
    expect(api.refresh).toHaveBeenCalledOnce();
    expect(api.readSchool).toHaveBeenCalledWith(projects, renewed.accessToken, expect.any(AbortSignal));
  });

  it('shares one rotation even when the provider reissues the same access token', async () => {
    const { session, api, vault } = await setup();
    const sameAccess = { accessToken: credentials.accessToken, refreshToken: renewed.refreshToken };
    const rotation = deferred<typeof sameAccess>();
    api.refresh.mockReturnValueOnce(rotation.promise);
    api.readSchool.mockRejectedValueOnce(new AuthError('unauthorized'))
      .mockRejectedValueOnce(new AuthError('unauthorized'))
      .mockResolvedValue({ data: [] });
    const first = session.readSchool(projects, signal());
    const second = session.readSchool(projects, signal());
    await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledOnce());
    rotation.resolve(sameAccess);
    await Promise.all([first, second]);
    expect(api.refresh).toHaveBeenCalledOnce();
    expect(api.readSchool).toHaveBeenCalledTimes(4);
    expect(vault.value?.credentials).toEqual(sameAccess);
    expect(session.getSnapshot().refreshCount).toBe(1);
  });

  it('does not rotate twice when an old-token request fails after a manual renewal', async () => {
    const { session, api } = await setup();
    const oldRead = deferred<unknown>();
    api.readSchool.mockReturnValueOnce(oldRead.promise);
    const reading = session.readSchool(projects, signal());
    await session.checkConnection(true);
    oldRead.reject(new AuthError('unauthorized'));
    await reading;
    expect(api.refresh).toHaveBeenCalledOnce();
    expect(api.readSchool).toHaveBeenLastCalledWith(projects, renewed.accessToken, expect.any(AbortSignal));
  });

  it('does not loop if the renewed read is also unauthorized', async () => {
    const { session, api, vault } = await setup();
    api.readSchool.mockRejectedValue(new AuthError('unauthorized'));
    await expect(session.readSchool(projects, signal())).rejects.toMatchObject({ code: 'unauthorized' });
    expect(api.refresh).toHaveBeenCalledOnce();
    expect(api.readSchool).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().status).toBe('reauthentication_required');
    expect(vault.value).toBeNull();
  });

  it('refuses data after refresh verifies a different student identity', async () => {
    const { session, api, vault } = await setup();
    api.readSchool.mockRejectedValueOnce(new AuthError('unauthorized'));
    api.verify.mockResolvedValueOnce({ login: 'other@example.invalid', roles: ['student'] });
    await expect(session.readSchool(projects, signal())).rejects.toMatchObject({ code: 'identity_mismatch' });
    expect(api.readSchool).toHaveBeenCalledOnce();
    expect(vault.value).toBeNull();
    expect(session.getSnapshot().student).toBeNull();
  });

  it('does not retry data if the rotated credentials cannot be saved', async () => {
    const { session, api, vault } = await setup();
    api.readSchool.mockRejectedValueOnce(new AuthError('unauthorized'));
    vault.write.mockRejectedValueOnce(new Error('synthetic storage failure'));
    await expect(session.readSchool(projects, signal())).rejects.toMatchObject({ code: 'storage' });
    expect(api.readSchool).toHaveBeenCalledOnce();
    expect(session.getSnapshot().student).toBeNull();
  });

  it.each(['forbidden', 'contract', 'server', 'network'] as const)('keeps login when a data source reports %s', async code => {
    const { session, api, vault } = await setup();
    api.readSchool.mockRejectedValue(new AuthError(code));
    await expect(session.readSchool(projects, signal())).rejects.toMatchObject({ code });
    expect(api.refresh).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ status: 'connected', student });
    expect(vault.value).not.toBeNull();
  });

  it('rejects a late response after disconnect even if fetch ignores abort', async () => {
    const { session, api } = await setup();
    const response = deferred<unknown>();
    api.readSchool.mockReturnValueOnce(response.promise);
    const reading = session.readSchool(projects, signal());
    const assertion = expect(reading).rejects.toMatchObject({ code: 'cancelled' });
    await session.disconnect();
    response.resolve({ data: [{ id: 'private-old-record' }] });
    await assertion;
  });

  it('rejects an old account response after a new school login', async () => {
    const { session, api } = await setup();
    const response = deferred<unknown>();
    api.readSchool.mockReturnValueOnce(response.promise);
    const reading = session.readSchool(projects, signal());
    const assertion = expect(reading).rejects.toMatchObject({ code: 'cancelled' });
    api.verify.mockResolvedValueOnce({ login: 'other@example.invalid', roles: ['student'] });
    api.ownProfile.mockResolvedValueOnce({ ...student, login: 'other@example.invalid' });
    await session.connectFromPortal(renewed);
    response.resolve({ data: [{ id: 'private-old-record' }] });
    await assertion;
    expect(session.getSnapshot().student?.login).toBe('other@example.invalid');
  });

  it('cancels a queued read immediately without cancelling the shared refresh', async () => {
    const { session, api } = await setup();
    const rotation = deferred<typeof renewed>();
    api.refresh.mockReturnValueOnce(rotation.promise);
    const checking = session.checkConnection(true);
    const caller = new AbortController();
    const reading = session.readSchool(projects, caller.signal);
    caller.abort();
    await expect(reading).rejects.toMatchObject({ code: 'cancelled' });
    expect(api.readSchool).not.toHaveBeenCalled();
    rotation.resolve(renewed);
    await checking;
    expect(session.getSnapshot().status).toBe('connected');
  });

  it('rejects a late result when only the caller cancelled', async () => {
    const { session, api } = await setup();
    const response = deferred<unknown>();
    const caller = new AbortController();
    api.readSchool.mockReturnValueOnce(response.promise);
    const reading = session.readSchool(projects, caller.signal);
    caller.abort();
    response.resolve({ data: [] });
    await expect(reading).rejects.toMatchObject({ code: 'cancelled' });
    expect(session.getSnapshot().status).toBe('connected');
  });
});

describe('school data transport boundary', () => {
  it('sends only a GET bearer request to the fixed school API', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const api = new HttpEpitechAuthApi(fetcher);
    await api.readSchool(projects, credentials.accessToken, signal());
    expect(fetcher).toHaveBeenCalledWith(`${EPITECH_API}${projects}`, expect.objectContaining({
      method: 'GET', redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json', Authorization: `Bearer ${credentials.accessToken}` },
    }));
  });

  it('supports bounded accessible and personal event views with offset-aware dates', async () => {
    const fetcher = vi.fn(async () => new Response('[]', { status: 200 }));
    const api = new HttpEpitechAuthApi(fetcher);
    for (const suffix of ['', '&registered=me']) {
      const params = new URLSearchParams({ startDate: '2026-10-23T00:00:00.000Z', endDate: '2026-10-30T00:00:00.000Z' });
      await api.readSchool(`/events?${params}${suffix}`, credentials.accessToken, signal());
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    'https://attacker.invalid/events', '//attacker.invalid/events', '/events\\@attacker.invalid',
    '/events#https://attacker.invalid', '/events%3FstartDate=2026-10-23', '/events/../auth/refresh',
    '/auth/token', '/students/directory', '/units/instances/projects?page=1&page=2',
    '/units/instances/projects?limit=0', '/units/instances/projects?redirect=https://attacker.invalid',
    '/events', '/events?startDate=2026-10-23&endDate=2026-10-30',
    '/events?startDate=2026-10-23T00%3A00%3A00Z&endDate=2026-12-30T00%3A00%3A00Z',
    '/events?startDate=2026-10-23T00%3A00%3A00Z&endDate=2026-10-30T00%3A00%3A00Z&registered=other',
  ])('rejects unsafe/unscoped read %s before any fetch', async path => {
    const fetcher = vi.fn();
    const api = new HttpEpitechAuthApi(fetcher);
    await expect(Promise.resolve().then(() => api.readSchool(path, credentials.accessToken, signal()))).rejects.toMatchObject({ code: 'contract' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("account-bound binary attachment reads", () => {
  it("uses the same verified identity, shared refresh owner and retry rules as JSON reads", async () => {
    const base = fakeApi();
    const readSchoolFile = vi.fn(async (_path: string, token: string) => {
      if (token === credentials.accessToken)
        throw new AuthError("unauthorized");
      return new Response(new Uint8Array([0, 255]));
    });
    const session = new SessionManager(
      { ...base, readSchoolFile },
      new MemoryVault(),
    );
    await expect(
      session.readSchoolFile("/students/follow-ups/1/attachment", signal()),
    ).rejects.toMatchObject({ code: "unauthorized" });
    await session.connectFromPortal(credentials);
    const response = await session.readSchoolFile(
      "/students/follow-ups/1/attachment",
      signal(),
    );
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 255]);
    expect(base.refresh).toHaveBeenCalledOnce();
    expect(readSchoolFile).toHaveBeenLastCalledWith(
      "/students/follow-ups/1/attachment",
      renewed.accessToken,
      expect.any(AbortSignal),
    );
  });
  it("returns a streaming binary response only for an allowlisted own-account attachment path", async () => {
    const transport = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(new Uint8Array([1])),
    );
    const api = new HttpEpitechAuthApi(transport);
    const response = await api.readSchoolFile(
      "/students/follow-ups/2/attachment",
      credentials.accessToken,
      signal(),
    );
    expect(response.body).not.toBeNull();
    expect(transport).toHaveBeenCalledWith(
      `${EPITECH_API}/students/follow-ups/2/attachment`,
      expect.objectContaining({ redirect: "error", credentials: "omit" }),
    );
    await expect(
      api.readSchoolFile(
        "/students/other/follow-ups/2/attachment",
        credentials.accessToken,
        signal(),
      ),
    ).rejects.toMatchObject({ code: "contract" });
    expect(transport).toHaveBeenCalledOnce();
  });
});
