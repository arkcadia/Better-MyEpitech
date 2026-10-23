import { AuthError, isRecord } from '../../domain/auth';
import type { CalendarEntry, CalendarMoment } from '../../domain/calendar';
import { StudentDataError, type EpitechStudentDataApi, type StudentDataSnapshot, type StudentProject, type StudentTimetableEvent } from '../../domain/studentData';

type AuthenticatedRead = (path: string, signal: AbortSignal) => Promise<unknown>;
type ParsedMoment = { value: string; calendar: CalendarMoment; instant: number; dateOnly: boolean };
type Collection = { warnings: Set<string>; complete: boolean };

const PORTAL = 'https://my.epitech.eu';
const DAY = 86_400_000;
const PAGE_LIMIT = 50;
const MAX_PAGES = 100;
const MAX_EVENTS_PER_RESPONSE = 10_000;

function warn(collection: Collection, message: string) {
  collection.complete = false;
  collection.warnings.add(message);
}

function nonEmpty(value: unknown, max = 500): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function id(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function whole(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Offsetless times are intentionally rejected: a student's device zone is not the campus zone. */
function moment(value: unknown, timeZone?: string): ParsedMoment | null {
  if (typeof value !== 'string') return null;
  if (validDate(value)) {
    return { value, calendar: { date: value }, instant: Date.parse(`${value}T00:00:00Z`), dateOnly: true };
  }
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts || !validDate(parts[1]!) || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4] ?? 0) > 59) return null;
  const zone = parts[5]!;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return null;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  const canonical = new Date(instant).toISOString();
  return { value: canonical, calendar: { dateTime: canonical, ...(timeZone ? { timeZone } : {}) }, instant, dateOnly: false };
}

function ianaZone(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 100 || !/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(value)) return undefined;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return value;
  } catch {
    return undefined;
  }
}

function sourceTimezone(value: Record<string, unknown>): string | undefined {
  const unit = isRecord(value.unitInstance) ? value.unitInstance : {};
  for (const candidate of [value.timezone, value.campusTimezone, unit.timezone, unit.campusTimezone]) {
    const zone = ianaZone(candidate);
    if (zone) return zone;
  }
  const campus = isRecord(value.campus) ? value.campus : {};
  const unitCampus = isRecord(unit.campus) ? unit.campus : {};
  const rooms = Array.isArray(value.rooms) ? value.rooms : [];
  const zones = new Set([campus.timezone, unitCampus.timezone, ...rooms.flatMap((room) => isRecord(room) && isRecord(room.campus) ? [room.campus.timezone] : [])]
    .map(ianaZone).filter((zone): zone is string => Boolean(zone)));
  return zones.size === 1 ? [...zones][0] : undefined;
}

function dayAfter(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
}

function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new AuthError('cancelled');
}

function rethrowSessionError(error: unknown, signal: AbortSignal) {
  checkCancelled(signal);
  if (error instanceof AuthError && ['unauthorized', 'not_student', 'identity_mismatch', 'cancelled', 'storage'].includes(error.code)) throw error;
}

function deadline(projectId: number, title: string, sourceUrl: string, date: ParsedMoment, kind: 'due' | 'registration'): CalendarEntry {
  return {
    sourceId: `epitech:project:${projectId}:${kind}`,
    sourceKind: 'deadline',
    title: `${kind === 'due' ? 'Project due' : 'Registration closes'}: ${title}`,
    sourceUrl,
    start: date.calendar,
    // A timed deadline is a one-minute marker starting at the exact deadline, not a class duration.
    end: date.dateOnly ? { date: dayAfter(date.value) } : { dateTime: new Date(date.instant + 60_000).toISOString(), ...('dateTime' in date.calendar && date.calendar.timeZone ? { timeZone: date.calendar.timeZone } : {}) },
    description: kind === 'due' ? 'Project end date published by Epitech. Check the school page for submission rules.' : 'Project registration deadline published by Epitech.',
    cancelled: false,
  };
}

function projectUrl(project: Record<string, unknown>, projectId: number): string {
  const unit = project.unitInstance;
  if (!isRecord(unit)) return `${PORTAL}/projects`;
  const template = isRecord(unit.unitTemplate) ? unit.unitTemplate : {};
  const code = nonEmpty(template.code, 100) ? template.code : unit.unitCode;
  if (!whole(unit.schoolYear) || unit.schoolYear < 1900 || unit.schoolYear > 9999 || !nonEmpty(code, 100) || !nonEmpty(unit.code, 100)) return `${PORTAL}/projects`;
  return `${PORTAL}/units/${unit.schoolYear}/${encodeURIComponent(code)}/${encodeURIComponent(unit.code)}/projects/${projectId}`;
}

function parseProject(value: unknown, now: number, collection: Collection): StudentProject | null {
  if (!isRecord(value) || !id(value.id) || !nonEmpty(value.name)) {
    warn(collection, 'Some projects had an unsupported identity or title and were skipped.');
    return null;
  }
  const title = nonEmpty(value.fullName) ? value.fullName.trim() : value.name.trim();
  const timeZone = sourceTimezone(value);
  const start = moment(value.startDate, timeZone);
  let due = moment(value.endDate, timeZone);
  const registration = moment(value.endRegistrationDate, timeZone);
  if (!start || !due || !registration) warn(collection, 'Some project dates were missing, invalid, or lacked a time zone. They are shown without an exportable date.');
  if (start && due && due.instant < start.instant) {
    warn(collection, 'Some project end dates preceded their start dates and were not exported.');
    due = null;
  }
  const sourceUrl = projectUrl(value, value.id);
  const dueBoundary = due ? due.instant + (due.dateOnly ? DAY : 0) : null;
  const status = start && dueBoundary !== null
    ? now < start.instant ? 'upcoming' : now >= dueBoundary ? 'finished' : 'ongoing'
    : 'unknown';
  return {
    id: String(value.id), title, status, sourceUrl,
    ...(typeof value.isUserRegistered === 'boolean' ? { registered: value.isUserRegistered } : {}),
    ...(start ? { startAt: start.value } : {}),
    ...(due ? { dueAt: due.value } : {}),
    ...(registration ? { registrationClosesAt: registration.value } : {}),
    deadlines: [
      ...(due ? [deadline(value.id, title, sourceUrl, due, 'due')] : []),
      ...(registration ? [deadline(value.id, title, sourceUrl, registration, 'registration')] : []),
    ],
  };
}

function parseEvent(value: unknown, collection: Collection): StudentTimetableEvent | null {
  if (!isRecord(value) || !id(value.id) || !nonEmpty(value.title)) {
    warn(collection, 'Some timetable events had an unsupported identity or title and were skipped.');
    return null;
  }
  // The server provides the student's selected slot separately from the wider event session.
  const hasSlot = value.mySlotStartDate != null || value.mySlotEndDate != null;
  const timeZone = sourceTimezone(value);
  const start = moment(hasSlot ? value.mySlotStartDate : value.startDate, timeZone);
  const end = moment(hasSlot ? value.mySlotEndDate : value.endDate, timeZone);
  if (!start || !end || start.dateOnly !== end.dateOnly || end.instant <= start.instant) {
    warn(collection, 'Some timetable dates were invalid, lacked a time zone, or had incomplete personal slots and were skipped.');
    return null;
  }
  const rooms = Array.isArray(value.rooms) ? value.rooms.flatMap((room) => {
    if (!isRecord(room) || !nonEmpty(room.name, 200)) return [];
    const campus = isRecord(room.campus) && nonEmpty(room.campus.name, 200) ? room.campus.name.trim() : null;
    return [campus ? `${room.name.trim()} (${campus})` : room.name.trim()];
  }) : [];
  const title = nonEmpty(value.fullTitle) ? value.fullTitle.trim() : value.title.trim();
  const sourceDate = start.value.slice(0, 10);
  const sourceUrl = `${PORTAL}/planning?eventId=${value.id}&start=${sourceDate}&end=${dayAfter(sourceDate)}`;
  const details = [
    nonEmpty(value.unitName) ? value.unitName.trim() : null,
    nonEmpty(value.activityName) ? value.activityName.trim() : null,
    value.isCalendarEvent === true && nonEmpty(value.calendarName) ? value.calendarName.trim() : null,
    hasSlot ? 'Time shown is your selected personal slot.' : null,
  ].filter((detail): detail is string => Boolean(detail));
  return {
    sourceId: `epitech:event:${value.id}`, sourceKind: 'class', title, sourceUrl,
    start: start.calendar, end: end.calendar,
    ...(rooms.length ? { location: [...new Set(rooms)].join(', ') } : {}),
    ...(details.length ? { description: [...new Set(details)].join('\n') } : {}),
    ...(hasSlot ? { personalSlot: true } : {}),
    // These markers are defensive support, not a claim that the observed API emits cancellations.
    cancelled: value.cancelled === true || value.canceled === true || value.status === 'cancelled' || value.status === 'canceled',
  };
}

function entryInstant(entry: CalendarEntry, end = false): number {
  const value = end ? entry.end : entry.start;
  return 'date' in value ? Date.parse(`${value.date}T00:00:00Z`) : Date.parse(value.dateTime);
}

export class HttpEpitechStudentDataApi implements EpitechStudentDataApi {
  constructor(private readonly authenticatedRead: AuthenticatedRead, private readonly now: () => number = Date.now) {}

  async collect(from: string, to: string, signal: AbortSignal): Promise<StudentDataSnapshot> {
    const start = moment(from);
    const end = moment(to);
    if (!start || !end || end.instant <= start.instant || end.instant - start.instant > 366 * DAY) throw new StudentDataError('range');
    checkCancelled(signal);
    const collection: Collection = { warnings: new Set(), complete: true };
    const [projects, events] = await Promise.all([
      this.collectProjects(collection, signal),
      this.collectEvents(start.instant, end.instant, collection, signal),
    ]);
    checkCancelled(signal);
    return {
      projects, events, complete: collection.complete, warnings: [...collection.warnings],
      range: { from: new Date(start.instant).toISOString(), to: new Date(end.instant).toISOString() },
      collectedAt: new Date(this.now()).toISOString(),
    };
  }

  private async collectProjects(collection: Collection, signal: AbortSignal): Promise<StudentProject[]> {
    const projects = new Map<string, StudentProject>();
    let expectedTotal: number | null = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      checkCancelled(signal);
      try {
        const raw = await this.authenticatedRead(`/units/instances/projects?page=${page}&limit=${PAGE_LIMIT}`, signal);
        checkCancelled(signal);
        if (!isRecord(raw) || !Array.isArray(raw.data) || !isRecord(raw.meta)) throw new StudentDataError('contract');
        const meta = raw.meta;
        if (meta.page !== page || !whole(meta.limit) || meta.limit === 0 || !whole(meta.total) || !whole(meta.pages) || typeof meta.hasNext !== 'boolean'
          || (meta.hasNext && (meta.pages <= page || raw.data.length === 0)) || raw.data.length > meta.limit) throw new StudentDataError('contract');
        if (expectedTotal !== null && expectedTotal !== meta.total) warn(collection, 'The project list changed while collecting. Refresh to check its coverage.');
        expectedTotal = meta.total;
        for (const row of raw.data) {
          const project = parseProject(row, this.now(), collection);
          if (!project) continue;
          if (projects.has(project.id)) warn(collection, 'Projects overlapped between pages. Refresh to check the complete list.');
          projects.set(project.id, project);
        }
        if (!meta.hasNext) {
          if (projects.size !== meta.total) warn(collection, 'Project pagination did not match its reported total. Some records may be missing.');
          break;
        }
        if (page === MAX_PAGES) warn(collection, 'Project collection reached its safety limit. The list is incomplete.');
      } catch (error) {
        rethrowSessionError(error, signal);
        warn(collection, 'The project list could not be fully retrieved. Try refreshing it.');
        break;
      }
    }
    return [...projects.values()].sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || a.id.localeCompare(b.id));
  }

  private async collectEvents(from: number, to: number, collection: Collection, signal: AbortSignal): Promise<StudentTimetableEvent[]> {
    const events = new Map<string, StudentTimetableEvent>();
    for (let cursor = from; cursor < to; cursor += 7 * DAY) {
      const query = new URLSearchParams({ startDate: new Date(cursor).toISOString(), endDate: new Date(Math.min(cursor + 7 * DAY, to)).toISOString() });
      for (const suffix of ['', '&registered=me']) {
        checkCancelled(signal);
        try {
          const raw = await this.authenticatedRead(`/events?${query.toString()}${suffix}`, signal);
          checkCancelled(signal);
          if (!Array.isArray(raw)) throw new StudentDataError('contract');
          if (raw.length > MAX_EVENTS_PER_RESPONSE) warn(collection, 'A timetable response reached the safety limit. Some events are missing.');
          for (const row of raw.slice(0, MAX_EVENTS_PER_RESPONSE)) {
            const event = parseEvent(row, collection);
            if (!event || entryInstant(event, true) <= from || entryInstant(event) >= to) continue;
            if (suffix) event.registered = true;
            const previous = events.get(event.sourceId);
            // Registered responses carry the student's slot and should win over the wider session.
            const priority = (entry: StudentTimetableEvent) => (entry.personalSlot ? 2 : 0) + (entry.registered ? 1 : 0);
            const preferred = previous && priority(previous) > priority(event)
              ? previous : event;
            events.set(event.sourceId, { ...preferred, ...(previous?.registered || event.registered ? { registered: true } : {}), cancelled: Boolean(previous?.cancelled || event.cancelled) });
          }
        } catch (error) {
          rethrowSessionError(error, signal);
          warn(collection, 'Some timetable date windows could not be retrieved. The displayed calendar is incomplete.');
        }
      }
    }
    return [...events.values()].sort((a, b) => entryInstant(a) - entryInstant(b) || a.sourceId.localeCompare(b.sourceId));
  }
}
