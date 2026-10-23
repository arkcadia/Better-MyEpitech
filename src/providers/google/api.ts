import { GoogleCalendarError, type GoogleCalendarApi, type GoogleEvent, type GoogleEventBody, type GoogleManagedFields } from '../../domain/googleCalendar';

const BASE = 'https://www.googleapis.com/calendar/v3';
const text = (value: unknown, max = 2048): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
export class GoogleCalendarHttpApi implements GoogleCalendarApi {
  constructor(private readonly transport: typeof fetch = fetch) {}
  private async request(token: string, path: string, signal: AbortSignal, method = 'GET', body?: unknown, etag?: string) {
    if (signal.aborted) throw new GoogleCalendarError('cancelled');
    if (!text(token, 16384) || /\s/.test(token)) throw new GoogleCalendarError('authorization');
    const controller = new AbortController();
    const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 20_000);
    try {
      const expectedUrl = `${BASE}${path}`;
      const response = await this.transport(expectedUrl, {
        method, signal: controller.signal, redirect: 'error', credentials: 'omit',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(etag ? { 'If-Match': etag } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (signal.aborted) throw new GoogleCalendarError('cancelled');
      if (response.url && response.url !== expectedUrl) throw new GoogleCalendarError('contract');
      if (response.status === 401) throw new GoogleCalendarError('authorization', true);
      if (response.status === 403) throw new GoogleCalendarError('permission', true);
      if (response.status === 409 || response.status === 412) throw new GoogleCalendarError('conflict', true);
      if (response.status === 404 && method === 'GET') return null;
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) throw new GoogleCalendarError('contract', true);
      if (!response.ok) throw new GoogleCalendarError('network');
      let value: Record<string, unknown>;
      try { value = await response.json() as Record<string, unknown>; } catch { throw new GoogleCalendarError('contract'); }
      if (signal.aborted) throw new GoogleCalendarError('cancelled');
      return value;
    } catch (error) { throw error instanceof GoogleCalendarError ? error : new GoogleCalendarError(signal.aborted ? 'cancelled' : 'network'); }
    finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
  }
  private path(calendarId: string, eventId?: string) {
    if (!text(calendarId) || calendarId === 'primary' || (eventId !== undefined && !/^bme[0-9a-f]{64}$/.test(eventId))) throw new GoogleCalendarError('contract');
    return `/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`;
  }
  private event(value: unknown, expectedId: string): GoogleEvent {
    if (!value || typeof value !== 'object') throw new GoogleCalendarError('contract');
    const event = value as Record<string, unknown>;
    if (event.id !== expectedId) throw new GoogleCalendarError('contract');
    const properties = event.extendedProperties as { private?: Record<string, unknown> } | undefined;
    const validMoment = (value: unknown): value is GoogleEventBody['start'] => {
      if (!value || typeof value !== 'object') return false;
      const point = value as Record<string, unknown>;
      return (typeof point.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(point.date)) ||
        (typeof point.dateTime === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(point.dateTime) && Number.isFinite(Date.parse(point.dateTime)));
    };
    const source = event.source as Record<string, unknown> | undefined;
    let managed: GoogleManagedFields | undefined;
    if (typeof event.summary === 'string' && typeof event.description === 'string' && validMoment(event.start) && validMoment(event.end) && typeof source?.title === 'string' && typeof source.url === 'string') {
      managed = { summary: event.summary, description: event.description, location: typeof event.location === 'string' ? event.location : '', start: event.start, end: event.end, source: { title: source.title, url: source.url } };
    }
    return {
      id: expectedId, ...(text(event.status) ? { status: event.status } : {}),
      ...(text(event.etag) ? { etag: event.etag } : {}), ...(managed ? { managed } : {}),
      ...(text(properties?.private?.betterMyEpitechSource) ? { sourceKey: properties!.private!.betterMyEpitechSource as string } : {}),
      ...(text(properties?.private?.betterMyEpitechContent) ? { fingerprint: properties!.private!.betterMyEpitechContent as string } : {}),
    };
  }
  async createCalendar(token: string, signal: AbortSignal) {
    const response = await this.request(token, '/calendars', signal, 'POST', {
      summary: 'Better MyEpitech', description: 'Classes and deadlines manually selected in Better MyEpitech.', timeZone: 'UTC',
    });
    if (!response || !text(response.id) || response.id === 'primary') throw new GoogleCalendarError('contract');
    return response.id;
  }
  async getEvent(token: string, calendarId: string, eventId: string, signal: AbortSignal) {
    const response = await this.request(token, this.path(calendarId, eventId), signal);
    return response === null ? null : this.event(response, eventId);
  }
  async insertEvent(token: string, calendarId: string, body: GoogleEventBody, signal: AbortSignal) {
    this.path(calendarId, body.id);
    return this.event(await this.request(token, this.path(calendarId), signal, 'POST', body), body.id);
  }
  async updateEvent(token: string, calendarId: string, body: GoogleEventBody, signal: AbortSignal, etag: string) {
    if (!text(etag) || /[\r\n]/.test(etag)) throw new GoogleCalendarError('contract');
    // PATCH preserves Google's reminders and other fields the student may edit.
    const { id, ...patch } = body;
    return this.event(await this.request(token, this.path(calendarId, id), signal, 'PATCH', patch, etag), id);
  }
}
