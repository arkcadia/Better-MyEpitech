import type { CalendarEntry } from './calendar';

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
export type GoogleAccount = { id: string; email: string };
export type GoogleAuthorization = {
  authorize(expectedAccount?: GoogleAccount, signal?: AbortSignal): Promise<{ account: GoogleAccount; accessToken: string }>;
};
export type AppCalendarState = { calendarId?: string; creationPending?: boolean };
export interface GoogleCalendarVault {
  selected(schoolLogin: string): Promise<GoogleAccount | null>;
  select(schoolLogin: string, account: GoogleAccount | null): Promise<void>;
  calendar(key: string): Promise<AppCalendarState | null>;
  saveCalendar(key: string, state: AppCalendarState): Promise<void>;
}
export type GoogleEventBody = {
  id: string;
  summary: string;
  description: string;
  location?: string;
  start: CalendarEntry['start'];
  end: CalendarEntry['end'];
  source: { title: string; url: string };
  extendedProperties: { private: { betterMyEpitechSource: string; betterMyEpitechContent: string } };
};
export type GoogleManagedFields = Pick<GoogleEventBody, 'summary' | 'description' | 'location' | 'start' | 'end' | 'source'>;
export type GoogleEvent = { id: string; status?: string; fingerprint?: string; sourceKey?: string; etag?: string; managed?: GoogleManagedFields };
export interface GoogleCalendarApi {
  createCalendar(token: string, signal: AbortSignal): Promise<string>;
  getEvent(token: string, calendarId: string, eventId: string, signal: AbortSignal): Promise<GoogleEvent | null>;
  insertEvent(token: string, calendarId: string, body: GoogleEventBody, signal: AbortSignal): Promise<GoogleEvent>;
  updateEvent(token: string, calendarId: string, body: GoogleEventBody, signal: AbortSignal, etag: string): Promise<GoogleEvent>;
}
export type GoogleCalendarErrorCode = 'setup' | 'cancelled' | 'busy' | 'authorization' | 'account' | 'network' | 'permission' | 'contract' | 'storage' | 'calendar_uncertain' | 'cancelled_entry' | 'conflict';
const MESSAGES: Record<GoogleCalendarErrorCode, string> = {
  setup: 'Google Calendar setup is required for this Android build. See the setup guide.',
  cancelled: 'Google Calendar action cancelled.',
  busy: 'A Google Calendar action is already running.',
  authorization: 'Google authorization expired or was declined. Connect Google again.',
  account: 'The Google account changed. Connect the intended account again.',
  network: 'Google Calendar could not be reached. Retry the same item when connected.',
  permission: 'Google Calendar permission or API configuration is unavailable. Check setup and reconnect.',
  contract: 'Google Calendar returned information this app cannot safely use.',
  storage: 'Google connection settings could not be saved securely.',
  calendar_uncertain: 'Calendar creation may have completed. To avoid duplicates, follow the recovery steps in the Google Calendar setup guide.',
  cancelled_entry: 'This school entry is cancelled and cannot be added to Google Calendar.',
  conflict: 'An existing Google event could not be safely matched. No replacement was created.',
};
export class GoogleCalendarError extends Error {
  constructor(public readonly code: GoogleCalendarErrorCode, public readonly definitiveRejection = false) { super(MESSAGES[code]); this.name = 'GoogleCalendarError'; }
}
export const safeGoogleError = (error: unknown) => error instanceof GoogleCalendarError ? error : new GoogleCalendarError('network');
