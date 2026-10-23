import type { CalendarEntry } from '../domain/calendar';
import { GoogleCalendarError, safeGoogleError, type GoogleAccount, type GoogleAuthorization, type GoogleCalendarApi, type GoogleCalendarVault, type GoogleEventBody, type GoogleEvent, type GoogleManagedFields } from '../domain/googleCalendar';

export type CalendarExportSnapshot = {
  status: 'disconnected' | 'linking' | 'connected' | 'exporting' | 'error';
  account?: GoogleAccount;
  error?: string;
  lastExport?: { sourceId: string; result: 'created' | 'updated' | 'already_added' };
};
type Dependencies = { authorization: GoogleAuthorization; api: GoogleCalendarApi; vault: GoogleCalendarVault; digest: (value: string) => Promise<string> };

function validSchool(login: string): string {
  const normalized = login.trim().toLowerCase();
  if (!normalized || normalized.length > 320 || /\s/.test(normalized)) throw new GoogleCalendarError('account');
  return normalized;
}
function validPoint(point: CalendarEntry['start']): boolean {
  if ('date' in point) {
    const parsed = new Date(`${point.date}T00:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === point.date;
  }
  // Require a numeric offset even with an IANA zone. Avoid ambiguous DST wall times.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(point.dateTime) || !Number.isFinite(Date.parse(point.dateTime))) return false;
  try { if (point.timeZone) new Intl.DateTimeFormat('en', { timeZone: point.timeZone }); return true; } catch { return false; }
}
function canonicalEntry(entry: CalendarEntry) {
  if (entry.cancelled) throw new GoogleCalendarError('cancelled_entry');
  if (!entry.sourceId || entry.sourceId.length > 1024 || !entry.title.trim() || entry.title.length > 2048 || !['class', 'deadline'].includes(entry.sourceKind)) throw new GoogleCalendarError('contract');
  if (!validPoint(entry.start) || !validPoint(entry.end) || ('date' in entry.start) !== ('date' in entry.end)) throw new GoogleCalendarError('contract');
  const begin = 'date' in entry.start ? entry.start.date : entry.start.dateTime;
  const end = 'date' in entry.end ? entry.end.date : entry.end.dateTime;
  if (Date.parse(end) <= Date.parse(begin)) throw new GoogleCalendarError('contract');
  let source: URL;
  try { source = new URL(entry.sourceUrl); } catch { throw new GoogleCalendarError('contract'); }
  if (source.origin !== 'https://my.epitech.eu' || source.username || source.password) throw new GoogleCalendarError('contract');
  // Keep only the portal's generated planning navigation parameters. Never copy
  // an arbitrary school URL's query string (which might contain signed tokens).
  const query = new URLSearchParams();
  if (source.pathname === '/planning') {
    const id = source.searchParams.get('eventId');
    if (id && /^[A-Za-z0-9_-]{1,128}$/.test(id)) query.set('eventId', id);
    for (const key of ['start', 'end']) {
      const date = source.searchParams.get(key);
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))) query.set(key, date);
    }
  }
  // React Native's URL implementation exposes hash as getter-only. Rebuild the
  // validated navigation link without assigning any URL property.
  const search = query.toString();
  const sourceUrl = `${source.origin}${source.pathname}${search ? `?${search}` : ''}`;
  const plain = (value: string) => value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  return {
    summary: plain(entry.title),
    description: `${plain(entry.description ?? '').slice(0, 6000)}\n\nSource: ${sourceUrl}\nExported manually from Better MyEpitech.`.trim(),
    location: plain(entry.location ?? '').slice(0, 1024),
    start: entry.start, end: entry.end,
    source: { title: 'My Epitech', url: sourceUrl },
  };
}

/** Canonical managed fields, including equivalent RFC3339 instants returned by Google. */
function fingerprintInput(data: GoogleManagedFields) {
  const point = (value: CalendarEntry['start']) => 'date' in value ? { date: value.date } : { dateTime: new Date(value.dateTime).toISOString() };
  return JSON.stringify({ summary: data.summary, description: data.description, location: data.location ?? '', start: point(data.start), end: point(data.end), source: { title: data.source.title, url: data.source.url } });
}

export class CalendarExportManager {
  private snapshot: CalendarExportSnapshot = { status: 'disconnected' };
  private listeners = new Set<() => void>();
  private school: string | null = null;
  private generation = 0;
  private controller: AbortController | null = null;
  private storageQueue: Promise<unknown> = Promise.resolve();
  private busy = false;
  constructor(private readonly dependencies: Dependencies) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(value: CalendarExportSnapshot) { this.snapshot = value; this.listeners.forEach(listener => listener()); }
  private current(generation: number) { if (generation !== this.generation) throw new GoogleCalendarError('cancelled'); }
  private write(action: () => Promise<void>) {
    const result = this.storageQueue.then(action).catch(() => { throw new GoogleCalendarError('storage'); });
    this.storageQueue = result.catch(() => undefined); return result;
  }
  /** Clear in-memory access immediately when the school account leaves the screen. */
  suspend = () => {
    this.generation++; this.controller?.abort(); this.controller = null; this.busy = false; this.school = null;
    this.emit({ status: 'disconnected' });
  };
  async restore(schoolLogin: string) {
    this.suspend(); const generation = this.generation; this.school = validSchool(schoolLogin);
    try {
      await this.storageQueue; const account = await this.dependencies.vault.selected(this.school); this.current(generation);
      this.emit(account ? { status: 'connected', account } : { status: 'disconnected' });
    } catch (error) { if (generation === this.generation) this.emit({ status: 'error', error: safeGoogleError(error).message }); }
  }
  async connect(schoolLogin: string) {
    if (this.busy) return;
    const school = validSchool(schoolLogin);
    this.suspend(); this.school = school; const generation = this.generation; this.busy = true;
    const controller = new AbortController(); this.controller = controller;
    this.emit({ status: 'linking' });
    try {
      const result = await this.dependencies.authorization.authorize(undefined, controller.signal); this.current(generation);
      // The access token intentionally stays only in this call's local memory.
      await this.write(async () => { this.current(generation); await this.dependencies.vault.select(school, result.account); });
      this.current(generation); this.emit({ status: 'connected', account: result.account });
    } catch (error) { if (generation === this.generation) this.emit({ status: 'error', error: safeGoogleError(error).message }); }
    finally { if (generation === this.generation) { this.busy = false; this.controller = null; } }
  }
  async disconnect() {
    const school = this.school; this.suspend(); const generation = this.generation;
    try { if (school) await this.write(() => this.dependencies.vault.select(school, null)); }
    catch (error) { if (generation === this.generation) this.emit({ status: 'error', error: safeGoogleError(error).message }); }
  }
  /** The only calendar-write entry point. Call exclusively from the student's button. */
  async exportEntry(schoolLogin: string, entry: CalendarEntry) {
    if (this.busy) return;
    const account = this.snapshot.account;
    const school = validSchool(schoolLogin);
    if (!account || school !== this.school) { this.emit({ status: 'error', error: new GoogleCalendarError('account').message }); return; }
    const generation = this.generation; const controller = new AbortController(); this.controller = controller; this.busy = true;
    this.emit({ status: 'exporting', account });
    try {
      const data = canonicalEntry(entry);
      const { digest, vault, authorization, api } = this.dependencies;
      const calendarKey = await digest(JSON.stringify(['calendar-v1', school, account.id])); this.current(generation);
      const sourceKey = await digest(JSON.stringify(['event-v1', school, account.id, entry.sourceKind, entry.sourceId]));
      const fingerprint = await digest(fingerprintInput(data)); this.current(generation);
      const authorizationResult = await authorization.authorize(account, controller.signal); this.current(generation);
      if (authorizationResult.account.id !== account.id || authorizationResult.account.email !== account.email) throw new GoogleCalendarError('account');
      const token = authorizationResult.accessToken;
      await this.storageQueue;
      let state = await vault.calendar(calendarKey); this.current(generation);
      if (state?.creationPending) throw new GoogleCalendarError('calendar_uncertain');
      if (!state?.calendarId) {
        await this.write(async () => { this.current(generation); await vault.saveCalendar(calendarKey, { creationPending: true }); });
        this.current(generation);
        let calendarId: string;
        try { calendarId = await api.createCalendar(token, controller.signal); }
        catch (error) {
          if (error instanceof GoogleCalendarError && error.definitiveRejection) await this.write(() => vault.saveCalendar(calendarKey, {}));
          throw error;
        }
        // Preserve the returned ID even when disconnect races the response. It does
        // not relink an account, and prevents another calendar on a future retry.
        await this.write(() => vault.saveCalendar(calendarKey, { calendarId }));
        this.current(generation); state = { calendarId };
      }
      const calendarId = state.calendarId!;
      if (calendarId === 'primary') throw new GoogleCalendarError('contract');
      const body: GoogleEventBody = { id: `bme${sourceKey}`, ...data, extendedProperties: { private: { betterMyEpitechSource: sourceKey, betterMyEpitechContent: fingerprint } } };
      let existing = await api.getEvent(token, calendarId, body.id, controller.signal); this.current(generation);
      let result: 'created' | 'updated' | 'already_added';
      if (!existing) {
        try { await api.insertEvent(token, calendarId, body, controller.signal); result = 'created'; }
        catch (error) {
          if (!(error instanceof GoogleCalendarError) || error.code !== 'conflict') throw error;
          this.current(generation); existing = await api.getEvent(token, calendarId, body.id, controller.signal); this.current(generation);
          if (!existing) throw new GoogleCalendarError('conflict');
          result = await this.updateExisting(existing, body, token, calendarId, controller.signal, generation);
        }
      } else result = await this.updateExisting(existing, body, token, calendarId, controller.signal, generation);
      this.current(generation); this.emit({ status: 'connected', account, lastExport: { sourceId: entry.sourceId, result } });
    } catch (error) { if (generation === this.generation) this.emit({ status: 'error', account, error: safeGoogleError(error).message }); }
    finally { if (generation === this.generation) { this.busy = false; this.controller = null; } }
  }
  private async updateExisting(existing: GoogleEvent, body: GoogleEventBody, token: string, calendarId: string, signal: AbortSignal, generation: number) {
    if (existing.sourceKey !== body.extendedProperties.private.betterMyEpitechSource || existing.status === 'cancelled') throw new GoogleCalendarError('conflict');
    if (!existing.managed || !existing.etag || await this.dependencies.digest(fingerprintInput(existing.managed)) !== existing.fingerprint) throw new GoogleCalendarError('conflict');
    this.current(generation);
    if (existing.fingerprint === body.extendedProperties.private.betterMyEpitechContent) return 'already_added' as const;
    this.current(generation);
    await this.dependencies.api.updateEvent(token, calendarId, body, signal, existing.etag); return 'updated' as const;
  }
}
