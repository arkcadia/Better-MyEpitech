import { describe, expect, it, vi } from 'vitest';
import { GoogleCalendarHttpApi } from '../src/providers/google/api';
import type { GoogleEventBody } from '../src/domain/googleCalendar';

const body: GoogleEventBody = {
  id: `bme${'a'.repeat(64)}`, summary: 'Synthetic class', description: 'Fixture only', location: '601',
  start: { dateTime: '2026-10-23T13:00:00+02:00', timeZone: 'Europe/Paris' }, end: { dateTime: '2026-10-23T14:00:00+02:00', timeZone: 'Europe/Paris' },
  source: { title: 'My Epitech', url: 'https://my.epitech.eu/planning' },
  extendedProperties: { private: { betterMyEpitechSource: 'source-key', betterMyEpitechContent: 'fingerprint' } },
};
const signal = () => new AbortController().signal;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('Google Calendar HTTP adapter', () => {
  it('creates only a secondary calendar using fixed HTTPS endpoints', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response({ id: 'app@group.calendar.google.com' }));
    const api = new GoogleCalendarHttpApi(transport);
    expect(await api.createCalendar('synthetic-token', signal())).toBe('app@group.calendar.google.com');
    const [url, options] = transport.mock.calls[0]!;
    expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', headers: { Authorization: 'Bearer synthetic-token' } });
    expect(JSON.parse(options!.body as string)).toEqual({ summary: 'Better MyEpitech', description: 'Classes and deadlines manually selected in Better MyEpitech.', timeZone: 'UTC' });
  });
  it('refuses primary calendar and unsafe IDs before sending a request', async () => {
    const transport = vi.fn<typeof fetch>(); const api = new GoogleCalendarHttpApi(transport);
    await expect(api.insertEvent('token', 'primary', body, signal())).rejects.toMatchObject({ code: 'contract' });
    await expect(api.getEvent('token', 'calendar', '../other', signal())).rejects.toMatchObject({ code: 'contract' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('preserves stable IDs and reads private source fingerprints', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response(body));
    const api = new GoogleCalendarHttpApi(transport);
    expect(await api.insertEvent('token', 'app@group.calendar.google.com', body, signal())).toMatchObject({ id: body.id, fingerprint: 'fingerprint', sourceKey: 'source-key' });
    expect(transport.mock.calls[0]![0]).toContain('/calendars/app%40group.calendar.google.com/events');
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string).id).toBe(body.id);
  });
  it('patches a manual source update without deleting unrelated Google fields', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response(body));
    await new GoogleCalendarHttpApi(transport).updateEvent('token', 'app-calendar', body, signal(), '"event-etag"');
    expect(transport.mock.calls[0]![1]?.method).toBe('PATCH');
    expect(transport.mock.calls[0]![1]?.headers).toMatchObject({ 'If-Match': '"event-etag"' });
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string)).not.toHaveProperty('id');
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string)).not.toHaveProperty('reminders');
  });
  it.each([[401, 'authorization'], [403, 'permission'], [409, 'conflict'], [412, 'conflict'], [429, 'network'], [500, 'network']] as const)('returns only safe errors for HTTP %s', async (status, code) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response({ secret: 'DO NOT EXPOSE RAW BODY' }, status));
    await expect(new GoogleCalendarHttpApi(transport).insertEvent('token', 'app-calendar', body, signal())).rejects.toMatchObject({ code });
  });
  it('treats a missing event as absent without returning arbitrary response data', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response({}, 404));
    expect(await new GoogleCalendarHttpApi(transport).getEvent('token', 'app-calendar', body.id, signal())).toBeNull();
  });
  it('rejects malformed or unexpectedly redirected responses', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response({ id: 'wrong-id' }));
    await expect(new GoogleCalendarHttpApi(transport).insertEvent('token', 'app-calendar', body, signal())).rejects.toMatchObject({ code: 'contract' });
    const redirected = response(body); Object.defineProperty(redirected, 'url', { value: 'https://attacker.invalid' }); transport.mockResolvedValue(redirected);
    await expect(new GoogleCalendarHttpApi(transport).insertEvent('token', 'app-calendar', body, signal())).rejects.toMatchObject({ code: 'contract' });
  });
  it('does not send requests after cancellation, even when a transport ignores abort', async () => {
    const transport = vi.fn<typeof fetch>(); const controller = new AbortController(); controller.abort();
    await expect(new GoogleCalendarHttpApi(transport).insertEvent('token', 'app-calendar', body, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(transport).not.toHaveBeenCalled();
    const second = new AbortController(); transport.mockImplementation(async () => { second.abort(); return response(body); });
    await expect(new GoogleCalendarHttpApi(transport).insertEvent('token', 'app-calendar', body, second.signal)).rejects.toMatchObject({ code: 'cancelled' });
  });
});
