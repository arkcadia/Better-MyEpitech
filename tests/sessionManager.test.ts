import { describe, expect, it, vi } from 'vitest';

import { expiresSoon, SessionManager } from '../src/application/sessionManager';
import { AuthError, type SchoolIdentity } from '../src/domain/auth';
import { credentials, deferred, fakeApi, MemoryVault, renewed, stored, student } from './helpers';

function setup() {
  const api = fakeApi();
  const vault = new MemoryVault();
  const session = new SessionManager(api, vault, () => 1_000_000);
  return { api, vault, session };
}

describe('student session', () => {
  it('verifies the role and own profile before saving a connection', async () => {
    const { session, vault, api } = setup();
    await session.connectFromPortal(credentials);
    expect(api.verify).toHaveBeenCalledWith(credentials.accessToken, expect.any(AbortSignal));
    expect(api.ownProfile).toHaveBeenCalledWith(credentials.accessToken, expect.any(AbortSignal));
    expect(session.getSnapshot()).toMatchObject({ status: 'connected', student, lastVerifiedAt: 1_000_000 });
    expect(vault.value).toEqual(stored);
    expect(session.getSnapshot()).not.toHaveProperty('credentials');
  });

  it('restores a previously saved connection and checks it again', async () => {
    const { session, vault, api } = setup();
    vault.value = stored;
    await session.restore();
    expect(api.verify).toHaveBeenCalledOnce();
    expect(session.getSnapshot().student).toEqual(student);
  });

  it('remains disconnected when no saved session exists', async () => {
    const { session, api } = setup();
    await session.restore();
    expect(session.getSnapshot().status).toBe('disconnected');
    expect(api.verify).not.toHaveBeenCalled();
  });

  it('refuses staff-only accounts even if a profile could be fetched', async () => {
    const { session, api, vault } = setup();
    api.verify.mockResolvedValue({ login: student.login, roles: ['staff'] });
    await session.connectFromPortal(credentials);
    expect(session.getSnapshot().issue?.code).toBe('not_student');
    expect(api.ownProfile).not.toHaveBeenCalled();
    expect(vault.value).toBeNull();
  });

  it('refuses different verify and profile identities', async () => {
    const { session, api, vault } = setup();
    api.ownProfile.mockResolvedValue({ ...student, login: 'someone-else@example.invalid' });
    await session.connectFromPortal(credentials);
    expect(session.getSnapshot().issue?.code).toBe('identity_mismatch');
    expect(vault.value).toBeNull();
  });

  it('refuses a changed identity while restoring stored credentials', async () => {
    const { session, api, vault } = setup();
    vault.value = stored;
    api.verify.mockResolvedValue({ login: 'other@example.invalid', roles: ['student'] });
    await session.restore();
    expect(session.getSnapshot().issue?.code).toBe('identity_mismatch');
    expect(vault.value).toBeNull();
  });

  it('retries a 401 once after refreshing and persists the rotated pair', async () => {
    const { session, api, vault } = setup();
    vault.value = stored;
    api.verify.mockRejectedValueOnce(new AuthError('unauthorized'));
    await session.restore();
    expect(api.refresh).toHaveBeenCalledExactlyOnceWith(credentials, expect.any(AbortSignal));
    expect(api.verify).toHaveBeenCalledTimes(2);
    expect(vault.value?.credentials).toEqual(renewed);
    expect(session.getSnapshot()).toMatchObject({ status: 'connected', refreshCount: 1 });
  });

  it('does not loop when the renewed token is also rejected', async () => {
    const { session, api, vault } = setup();
    vault.value = stored;
    api.verify.mockRejectedValue(new AuthError('unauthorized'));
    await session.restore();
    expect(api.refresh).toHaveBeenCalledOnce();
    expect(api.verify).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().status).toBe('reauthentication_required');
    expect(vault.value).toBeNull();
  });

  it('does not refresh a permission denial as if it were an expired token', async () => {
    const { session, api } = setup();
    api.ownProfile.mockRejectedValue(new AuthError('forbidden'));
    await session.connectFromPortal(credentials);
    expect(api.refresh).not.toHaveBeenCalled();
    expect(session.getSnapshot().issue?.code).toBe('forbidden');
  });

  it('keeps saved credentials on a temporary network failure', async () => {
    const { session, api, vault } = setup();
    vault.value = stored;
    api.verify.mockRejectedValue(new AuthError('network'));
    await session.restore();
    expect(vault.value).toEqual(stored);
    expect(session.getSnapshot().status).toBe('error');
    expect(session.getSnapshot().student).toBeNull();
  });

  it('persists a rotation even when a subsequent request fails transiently', async () => {
    const { session, api, vault } = setup();
    vault.value = stored;
    api.verify.mockRejectedValueOnce(new AuthError('unauthorized')).mockRejectedValueOnce(new AuthError('server'));
    await session.restore();
    expect(vault.value?.credentials).toEqual(renewed);
    expect(session.getSnapshot().issue?.code).toBe('server');
  });

  it('shares concurrent renewal checks instead of racing refresh tokens', async () => {
    const { session, api } = setup();
    await session.connectFromPortal(credentials);
    const a = session.checkConnection(true);
    const b = session.checkConnection(true);
    expect(a).toBe(b);
    await Promise.all([a, b]);
    expect(api.refresh).toHaveBeenCalledOnce();
  });

  it('does not connect if secure storage fails', async () => {
    const { session, vault } = setup();
    vault.write.mockRejectedValueOnce(new Error('synthetic storage failure'));
    await session.connectFromPortal(credentials);
    expect(session.getSnapshot()).toMatchObject({ status: 'error', student: null });
    expect(session.getSnapshot().issue?.code).toBe('storage');
    expect(vault.value).toBeNull();
  });

  it('clears local credentials on disconnect', async () => {
    const { session, vault } = setup();
    await session.connectFromPortal(credentials);
    await session.disconnect();
    expect(vault.value).toBeNull();
    expect(session.getSnapshot()).toMatchObject({ status: 'disconnected', student: null });
  });

  it('reports a failed secure deletion instead of claiming successful logout', async () => {
    const { session, vault } = setup();
    await session.connectFromPortal(credentials);
    vault.clear.mockRejectedValueOnce(new Error('synthetic storage failure'));
    await session.disconnect();
    expect(session.getSnapshot()).toMatchObject({ status: 'error', student: null });
    expect(session.getSnapshot().issue?.code).toBe('storage');
  });

  it('blocks a late login response after disconnect, even if fetch ignores abort', async () => {
    const { session, api, vault } = setup();
    const response = deferred<SchoolIdentity>();
    api.verify.mockReturnValueOnce(response.promise);
    const connecting = session.connectFromPortal(credentials);
    await vi.waitFor(() => expect(api.verify).toHaveBeenCalledOnce());
    await session.disconnect();
    response.resolve({ login: student.login, roles: ['student'] });
    await connecting;
    expect(session.getSnapshot().status).toBe('disconnected');
    expect(vault.value).toBeNull();
  });

  it('prevents an old account response from replacing a newer connection', async () => {
    const { session, api, vault } = setup();
    const oldResponse = deferred<SchoolIdentity>();
    api.verify.mockReturnValueOnce(oldResponse.promise);
    const oldConnection = session.connectFromPortal(credentials);
    await vi.waitFor(() => expect(api.verify).toHaveBeenCalledOnce());
    await session.connectFromPortal(renewed);
    oldResponse.resolve({ login: 'old@example.invalid', roles: ['student'] });
    await oldConnection;
    expect(session.getSnapshot()).toMatchObject({ status: 'connected', student });
    expect(vault.value?.credentials).toEqual(renewed);
  });

  it('uses expiry claims only as a refresh hint', () => {
    const payload = btoa(JSON.stringify({ exp: 1_010 }));
    expect(expiresSoon(`header.${payload}.signature`, 1_000_000)).toBe(true);
    expect(expiresSoon('opaque-token', 1_000_000)).toBe(false);
    expect(expiresSoon('invalid.?.token', 1_000_000)).toBe(false);
  });

  it('renews an expired saved access token before the first verification request', async () => {
    const { session, vault, api } = setup();
    const expired = { ...credentials, accessToken: `header.${btoa(JSON.stringify({ exp: 1 }))}.signature` };
    vault.value = { ...stored, credentials: expired };
    await session.restore();
    expect(api.refresh).toHaveBeenCalledExactlyOnceWith(expired, expect.any(AbortSignal));
    expect(api.verify).toHaveBeenCalledExactlyOnceWith(renewed.accessToken, expect.any(AbortSignal));
    expect(session.getSnapshot().status).toBe('connected');
  });

  it('cannot persist a late renewal after disconnect', async () => {
    const { session, vault, api } = setup();
    await session.connectFromPortal(credentials);
    const rotation = deferred<typeof renewed>();
    api.refresh.mockReturnValueOnce(rotation.promise);
    const checking = session.checkConnection(true);
    await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledOnce());
    await session.disconnect();
    rotation.resolve(renewed);
    await checking;
    expect(vault.value).toBeNull();
    expect(session.getSnapshot().status).toBe('disconnected');
  });

  it('orders a pending storage write before the disconnect clear', async () => {
    const { session, vault } = setup();
    const write = deferred<void>();
    vault.write.mockImplementationOnce(async saved => {
      await write.promise;
      vault.value = saved;
    });
    const connecting = session.connectFromPortal(credentials);
    await vi.waitFor(() => expect(vault.write).toHaveBeenCalledOnce());
    const disconnecting = session.disconnect();
    write.resolve();
    await Promise.all([connecting, disconnecting]);
    expect(vault.value).toBeNull();
    expect(session.getSnapshot().status).toBe('disconnected');
  });
});
