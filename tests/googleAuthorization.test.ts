import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GOOGLE_CALENDAR_SCOPE } from '../src/domain/googleCalendar';
const native = vi.hoisted(() => ({ authorize: vi.fn(), require: vi.fn() }));
vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: native.require }));
import { AndroidGoogleAuthorization } from '../src/providers/google/authorization';

beforeEach(() => {
  native.authorize.mockReset().mockResolvedValue({ accessToken: 'synthetic-token', scopes: [GOOGLE_CALENDAR_SCOPE] });
  native.require.mockReset().mockReturnValue({ authorize: native.authorize });
});
const user = { sub: 'google-123', email: 'student@google.invalid', email_verified: true };
describe('native Google authorization adapter', () => {
  it('requires a deliberate configured build and native module', async () => {
    await expect(new AndroidGoogleAuthorization(false).authorize()).rejects.toMatchObject({ code: 'setup' });
    native.require.mockReturnValue(null);
    await expect(new AndroidGoogleAuthorization(true).authorize()).rejects.toMatchObject({ code: 'setup' });
    expect(native.authorize).not.toHaveBeenCalled();
  });
  it('uses the Google token only at Google userinfo and checks stable subject + verified email', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(user)));
    const result = await new AndroidGoogleAuthorization(true, transport).authorize();
    expect(result).toEqual({ account: { id: user.sub, email: user.email }, accessToken: 'synthetic-token' });
    expect(native.authorize).toHaveBeenCalledWith(null);
    expect(transport.mock.calls[0]).toMatchObject(['https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer synthetic-token' }, redirect: 'error' }]);
  });
  it('binds renewed authorization to the selected Google account', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ...user, sub: 'other' })));
    await expect(new AndroidGoogleAuthorization(true, transport).authorize({ id: user.sub, email: user.email })).rejects.toMatchObject({ code: 'account' });
    expect(native.authorize).toHaveBeenCalledWith(user.email);
  });
  it('rejects partial grants without querying identity', async () => {
    native.authorize.mockResolvedValue({ accessToken: 'synthetic-token', scopes: ['openid'] }); const transport = vi.fn<typeof fetch>();
    await expect(new AndroidGoogleAuthorization(true, transport).authorize()).rejects.toMatchObject({ code: 'permission' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('handles user cancellation and suppresses native provider error details', async () => {
    native.authorize.mockRejectedValue({ code: 'ERR_GOOGLE_CANCELLED', message: 'raw sensitive provider data' });
    await expect(new AndroidGoogleAuthorization(true).authorize()).rejects.toMatchObject({ code: 'cancelled', message: 'Google Calendar action cancelled.' });
  });
  it('rejects unverified identity', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ...user, email_verified: false })));
    await expect(new AndroidGoogleAuthorization(true, transport).authorize()).rejects.toMatchObject({ code: 'contract' });
  });
  it('does not query userinfo after logout while native consent is open', async () => {
    let finish!: (value: { accessToken: string; scopes: string[] }) => void;
    native.authorize.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const transport = vi.fn<typeof fetch>(); const controller = new AbortController();
    const authorization = new AndroidGoogleAuthorization(true, transport).authorize(undefined, controller.signal);
    controller.abort(); finish({ accessToken: 'synthetic-token', scopes: [GOOGLE_CALENDAR_SCOPE] });
    await expect(authorization).rejects.toMatchObject({ code: 'cancelled' }); expect(transport).not.toHaveBeenCalled();
  });
});
