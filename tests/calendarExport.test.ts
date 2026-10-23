import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CalendarExportManager } from '../src/application/calendarExport';
import type { CalendarEntry } from '../src/domain/calendar';
import { GoogleCalendarError, type AppCalendarState, type GoogleAccount, type GoogleCalendarApi, type GoogleEvent, type GoogleEventBody } from '../src/domain/googleCalendar';

const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const school = 'student@example.invalid';
const account = { id: 'google-123', email: 'student@google.invalid' };
const entry: CalendarEntry = {
  sourceKind: 'class', sourceId: 'schedule-123', title: 'Software project', sourceUrl: 'https://my.epitech.eu/planning',
  start: { dateTime: '2026-10-25T13:00:00+01:00', timeZone: 'Europe/Paris' },
  end: { dateTime: '2026-10-25T14:00:00+01:00', timeZone: 'Europe/Paris' }, location: '601', cancelled: false,
};
function setup() {
  const selected = new Map<string, GoogleAccount>(); const calendars = new Map<string, AppCalendarState>(); const events = new Map<string, GoogleEvent>();
  const authorization = { authorize: vi.fn(async (_expected?: GoogleAccount) => ({ account, accessToken: 'synthetic-google-token' })) };
  const vault = {
    selected: vi.fn(async (key: string) => selected.get(key) ?? null),
    select: vi.fn(async (key: string, value: GoogleAccount | null) => { if (value) selected.set(key, value); else selected.delete(key); }),
    calendar: vi.fn(async (key: string) => calendars.get(key) ?? null),
    saveCalendar: vi.fn(async (key: string, value: AppCalendarState) => { calendars.set(key, value); }),
  };
  const saved = (body: GoogleEventBody) => ({ id: body.id, sourceKey: body.extendedProperties.private.betterMyEpitechSource, fingerprint: body.extendedProperties.private.betterMyEpitechContent, etag: '"synthetic-etag"', managed: { summary: body.summary, description: body.description, location: body.location, start: body.start, end: body.end, source: body.source } });
  const api = {
    createCalendar: vi.fn(async () => 'app-calendar'),
    getEvent: vi.fn(async (_token: string, _calendarId: string, id: string) => events.get(id) ?? null),
    insertEvent: vi.fn(async (_token: string, _calendarId: string, body: GoogleEventBody) => { const event = saved(body); events.set(body.id, event); return event; }),
    updateEvent: vi.fn(async (_token: string, _calendarId: string, body: GoogleEventBody, _signal: AbortSignal, _etag: string) => { const event = saved(body); events.set(body.id, event); return event; }),
  } satisfies GoogleCalendarApi;
  const manager = new CalendarExportManager({ authorization, api, vault, digest });
  return { manager, authorization, api, vault, selected, calendars, events };
}

describe('explicit account-scoped Google Calendar export', () => {
  it('connecting/restoring never creates calendars or events and does not persist access tokens', async () => {
    const f = setup(); await f.manager.connect(school); await f.manager.restore(school);
    expect(f.manager.getSnapshot().account).toEqual(account);
    expect(f.api.createCalendar).not.toHaveBeenCalled(); expect(f.api.insertEvent).not.toHaveBeenCalled();
    expect(JSON.stringify([...f.selected, ...f.calendars])).not.toContain('synthetic-google-token');
    expect(JSON.stringify(f.manager.getSnapshot())).not.toContain('synthetic-google-token');
  });
  it('adds a selected class with room, canonical source, offset and IANA zone', async () => {
    const f = setup(); await f.manager.connect(school); await f.manager.exportEntry(school, entry);
    expect(f.manager.getSnapshot().lastExport?.result).toBe('created');
    const [token, calendarId, body] = f.api.insertEvent.mock.calls[0]!;
    expect(token).toBe('synthetic-google-token'); expect(calendarId).toBe('app-calendar');
    expect(body).toMatchObject({ summary: entry.title, location: '601', start: entry.start, end: entry.end, source: { url: entry.sourceUrl } });
    expect(body.id).toMatch(/^bme[0-9a-f]{64}$/);
    expect(body).not.toHaveProperty('attendees');
  });
  it('preserves exclusive all-day boundaries for a project deadline', async () => {
    const f = setup(); await f.manager.connect(school);
    await f.manager.exportEntry(school, { ...entry, sourceKind: 'deadline', start: { date: '2026-10-27' }, end: { date: '2026-10-28' } });
    expect(f.api.insertEvent.mock.calls[0]![2]).toMatchObject({ start: { date: '2026-10-27' }, end: { date: '2026-10-28' } });
  });
  it('reuses the server ID across repeats and a fresh process', async () => {
    const f = setup(); await f.manager.connect(school); await f.manager.exportEntry(school, entry);
    const newManager = new CalendarExportManager({ authorization: f.authorization, api: f.api, vault: f.vault, digest });
    await newManager.restore(school); await newManager.exportEntry(school, entry);
    expect(newManager.getSnapshot().lastExport?.result).toBe('already_added');
    expect(f.api.createCalendar).toHaveBeenCalledTimes(1); expect(f.api.insertEvent).toHaveBeenCalledTimes(1);
  });
  it('manually updates a changed source using the same event ID, including a removed room', async () => {
    const f = setup(); await f.manager.connect(school); await f.manager.exportEntry(school, entry);
    await f.manager.exportEntry(school, { ...entry, title: 'Rescheduled class', location: undefined });
    expect(f.manager.getSnapshot().lastExport?.result).toBe('updated');
    expect(f.api.updateEvent.mock.calls[0]![2].id).toBe(f.api.insertEvent.mock.calls[0]![2].id);
    expect(f.api.updateEvent.mock.calls[0]![2].location).toBe('');
  });
  it('a lost insert response retries the same deterministic ID and discovers the existing event', async () => {
    const f = setup(); await f.manager.connect(school);
    const insert = f.api.insertEvent.getMockImplementation()!;
    f.api.insertEvent.mockImplementationOnce(async (...args) => { await insert(...args); throw new GoogleCalendarError('network'); });
    await f.manager.exportEntry(school, entry); expect(f.manager.getSnapshot().status).toBe('error');
    await f.manager.exportEntry(school, entry);
    expect(f.manager.getSnapshot().lastExport?.result).toBe('already_added'); expect(f.api.insertEvent).toHaveBeenCalledTimes(1);
  });
  it('a 409 insert race reads the matching ID instead of retrying with a new ID', async () => {
    const f = setup(); await f.manager.connect(school);
    const insert = f.api.insertEvent.getMockImplementation()!;
    f.api.insertEvent.mockImplementationOnce(async (...args) => { await insert(...args); throw new GoogleCalendarError('conflict'); });
    await f.manager.exportEntry(school, entry);
    expect(f.manager.getSnapshot().lastExport?.result).toBe('already_added'); expect(f.api.insertEvent).toHaveBeenCalledTimes(1);
  });
  it('does not recreate an ambiguously created calendar after restart', async () => {
    const f = setup(); await f.manager.connect(school);
    f.api.createCalendar.mockRejectedValueOnce(new GoogleCalendarError('network'));
    await f.manager.exportEntry(school, entry);
    const fresh = new CalendarExportManager({ authorization: f.authorization, api: f.api, vault: f.vault, digest });
    await fresh.restore(school); await fresh.exportEntry(school, entry);
    expect(f.api.createCalendar).toHaveBeenCalledTimes(1); expect(f.api.insertEvent).not.toHaveBeenCalled();
    expect(fresh.getSnapshot().error).toContain('avoid duplicates');
  });
  it('allows setup retry after Google definitively rejects creation without creating a calendar', async () => {
    const f = setup(); await f.manager.connect(school);
    f.api.createCalendar.mockRejectedValueOnce(new GoogleCalendarError('permission', true));
    await f.manager.exportEntry(school, entry); await f.manager.exportEntry(school, entry);
    expect(f.api.createCalendar).toHaveBeenCalledTimes(2); expect(f.manager.getSnapshot().lastExport?.result).toBe('created');
  });
  it('does not create anything for cancelled entries, invalid dates or foreign source links', async () => {
    const f = setup(); await f.manager.connect(school);
    for (const bad of [{ ...entry, cancelled: true }, { ...entry, start: { date: '2026-13-99' }, end: { date: '2026-14-99' } }, { ...entry, sourceUrl: 'https://attacker.invalid' }, { ...entry, start: { dateTime: '2026-10-25T02:30:00', timeZone: 'Europe/Paris' } }]) {
      await f.manager.exportEntry(school, bad); expect(f.manager.getSnapshot().status).toBe('error');
    }
    expect(f.api.createCalendar).not.toHaveBeenCalled();
  });
  it('isolates school and Google accounts and never sends school access credentials to Google', async () => {
    const f = setup(); await f.manager.connect(school);
    await f.manager.exportEntry('different@example.invalid', entry); expect(f.api.createCalendar).not.toHaveBeenCalled();
    await f.manager.connect(school);
    f.authorization.authorize.mockResolvedValueOnce({ account: { id: 'other', email: 'other@google.invalid' }, accessToken: 'different-google-token' });
    await f.manager.exportEntry(school, entry); expect(f.api.createCalendar).not.toHaveBeenCalled();
    expect(f.manager.getSnapshot().error).toContain('account changed');
  });
  it('disconnect does not unlink a later sign-in through a late authorization result', async () => {
    const f = setup(); let finish!: (result: { account: GoogleAccount; accessToken: string }) => void;
    f.authorization.authorize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const connecting = f.manager.connect(school); await f.manager.disconnect();
    finish({ account, accessToken: 'late-token' }); await connecting;
    expect(f.manager.getSnapshot().status).toBe('disconnected'); expect(f.selected.size).toBe(0);
  });
  it('logout while authorizing an export prevents any calendar write', async () => {
    const f = setup(); await f.manager.connect(school); let finish!: (result: { account: GoogleAccount; accessToken: string }) => void;
    f.authorization.authorize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const exporting = f.manager.exportEntry(school, entry);
    await vi.waitFor(() => expect(f.authorization.authorize).toHaveBeenCalledTimes(2));
    f.manager.suspend(); finish({ account, accessToken: 'late-token' }); await exporting;
    expect(f.api.createCalendar).not.toHaveBeenCalled(); expect(f.manager.getSnapshot().status).toBe('disconnected');
  });
  it('a failed protected write prevents remote calendar creation', async () => {
    const f = setup(); await f.manager.connect(school); f.vault.saveCalendar.mockRejectedValueOnce(new Error('disk'));
    await f.manager.exportEntry(school, entry);
    expect(f.api.createCalendar).not.toHaveBeenCalled(); expect(f.manager.getSnapshot().error).toContain('securely');
  });
  it('never overwrites an unrecognized or user-deleted existing event', async () => {
    const f = setup(); await f.manager.connect(school); await f.manager.exportEntry(school, entry);
    const saved = [...f.events.values()][0]!; f.events.set(saved.id, { ...saved, status: 'cancelled' });
    await f.manager.exportEntry(school, entry); expect(f.api.updateEvent).not.toHaveBeenCalled();
    expect(f.manager.getSnapshot().error).toContain('safely matched');
  });
  it('detects external Google edits even when the app private marker is unchanged', async () => {
    const f = setup(); await f.manager.connect(school); await f.manager.exportEntry(school, entry);
    const saved = [...f.events.values()][0]!; f.events.set(saved.id, { ...saved, managed: { ...saved.managed!, summary: 'My personal Google edit' } });
    await f.manager.exportEntry(school, { ...entry, title: 'School update' });
    expect(f.api.updateEvent).not.toHaveBeenCalled(); expect(f.api.insertEvent).toHaveBeenCalledTimes(1);
    expect(f.manager.getSnapshot().error).toContain('safely matched');
  });
  it('passes the last-read ETag and treats an edit between read and write as conflict', async () => {
    const f = setup(); await f.manager.connect(school); await f.manager.exportEntry(school, entry);
    f.api.updateEvent.mockRejectedValueOnce(new GoogleCalendarError('conflict', true));
    await f.manager.exportEntry(school, { ...entry, title: 'School update' });
    expect(f.api.updateEvent.mock.calls[0]![4]).toBe('"synthetic-etag"');
    expect(f.api.insertEvent).toHaveBeenCalledTimes(1); expect(f.manager.getSnapshot().error).toContain('safely matched');
  });
  it('retains only generated planning navigation parameters and discards sensitive queries', async () => {
    const f = setup(); await f.manager.connect(school);
    await f.manager.exportEntry(school, { ...entry, sourceUrl: 'https://my.epitech.eu/planning?eventId=8&start=2026-10-23&end=2026-10-29&token=secret' });
    expect(f.api.insertEvent.mock.calls[0]![2].source.url).toBe('https://my.epitech.eu/planning?eventId=8&start=2026-10-23&end=2026-10-29');
    expect(JSON.stringify(f.api.insertEvent.mock.calls)).not.toContain('secret');
  });
  it('sanitizes links with getter-only URL properties as exposed by React Native', async () => {
    const BaseURL = globalThis.URL;
    class NativeStyleURL extends BaseURL {
      override get hash() { return super.hash; }
      override get search() { return super.search; }
    }
    vi.stubGlobal('URL', NativeStyleURL);
    try {
      const f = setup(); await f.manager.connect(school);
      await f.manager.exportEntry(school, { ...entry, sourceUrl: 'https://my.epitech.eu/planning?eventId=8&start=2026-10-23&token=secret#sensitive-fragment' });
      expect(f.manager.getSnapshot().lastExport?.result).toBe('created');
      expect(f.api.insertEvent.mock.calls[0]![2].source.url).toBe('https://my.epitech.eu/planning?eventId=8&start=2026-10-23');
      expect(JSON.stringify(f.api.insertEvent.mock.calls)).not.toContain('secret');
      expect(JSON.stringify(f.api.insertEvent.mock.calls)).not.toContain('sensitive-fragment');
    } finally { vi.unstubAllGlobals(); }
  });
});
