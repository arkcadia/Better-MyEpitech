import { describe, expect, it, vi } from 'vitest';

import { AuthError } from '../src/domain/auth';
import { StudentDataError } from '../src/domain/studentData';
import { HttpEpitechStudentDataApi } from '../src/providers/epitech/studentData';

const FROM = '2026-10-19T00:00:00Z';
const TO = '2026-10-26T00:00:00Z';
const now = () => Date.parse('2026-10-22T12:00:00Z');
const signal = () => new AbortController().signal;
const project = (overrides: Record<string, unknown> = {}) => ({
  id: 17, name: 'Synthetic project', fullName: 'Synthetic project title',
  startDate: '2026-10-20T00:00:00Z', endDate: '2026-10-25T20:00:00+02:00',
  endRegistrationDate: '2026-10-21T10:00:00Z', isUserRegistered: true,
  unitInstance: { schoolYear: 2026, unitCode: 'B-TEST', code: 'PAR-1', campusTimezone: 'Europe/Paris' },
  ...overrides,
});
const event = (overrides: Record<string, unknown> = {}) => ({
  id: 8, title: 'Synthetic class', startDate: '2026-10-22T13:00:00+02:00', endDate: '2026-10-22T15:00:00+02:00',
  rooms: [{ name: '601', campus: { name: 'Synthetic campus' } }], unitName: 'Synthetic unit', activityName: 'Workshop',
  ...overrides,
});
const page = (data: unknown[] = [], pageNumber = 1, pages = 1, total = data.length) => ({
  data, meta: { page: pageNumber, limit: 50, total, pages, hasNext: pageNumber < pages, hasPrev: pageNumber > 1 },
});
const reader = (projects: unknown = page(), events: unknown = []) => vi.fn(async (path: string): Promise<unknown> => path.startsWith('/units/') ? projects : events);

describe('student project and timetable collection', () => {
  it('collects only observed read routes and preserves project identity, status and two different deadlines', async () => {
    const read = reader(page([project({ privateStaffDescription: 'not copied', unrelatedLogin: 'not-copied@example.invalid' })]));
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(read.mock.calls[0]?.[0]).toBe('/units/instances/projects?page=1&limit=50');
    expect(read.mock.calls.every(([path]) => !path.includes('student=') && !path.includes('registeredOnly='))).toBe(true);
    expect(result.projects[0]).toMatchObject({
      id: '17', title: 'Synthetic project title', status: 'ongoing', registered: true,
      sourceUrl: 'https://my.epitech.eu/units/2026/B-TEST/PAR-1/projects/17',
      dueAt: '2026-10-25T18:00:00.000Z', registrationClosesAt: '2026-10-21T10:00:00.000Z',
    });
    const deadlines = result.projects[0]!.deadlines;
    expect(deadlines.map((entry) => entry.sourceId)).toEqual(['epitech:project:17:due', 'epitech:project:17:registration']);
    expect(deadlines[0]).toMatchObject({ start: { dateTime: '2026-10-25T18:00:00.000Z' }, end: { dateTime: '2026-10-25T18:01:00.000Z' } });
    expect(JSON.stringify(result)).not.toContain('not-copied');
    expect(result.complete).toBe(true);
    expect(result.collectedAt).toBe('2026-10-22T12:00:00.000Z');
  });

  it('follows project pagination without silently restricting to registered projects', async () => {
    const read = vi.fn(async (path: string) => {
      if (!path.startsWith('/units/')) return [];
      return path.includes('page=1&') ? page([project()], 1, 2, 2) : page([project({ id: 18, isUserRegistered: false })], 2, 2, 2);
    });
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.projects.map((row) => row.id)).toEqual(['17', '18']);
    expect(result.projects[1]?.registered).toBe(false);
    expect(read.mock.calls.some(([path]) => path === '/units/instances/projects?page=2&limit=50')).toBe(true);
    expect(result.complete).toBe(true);
  });

  it('marks duplicate or drifting project pagination as incomplete', async () => {
    const read = vi.fn(async (path: string) => {
      if (!path.startsWith('/units/')) return [];
      return path.includes('page=1&') ? page([project()], 1, 2, 2) : page([project()], 2, 2, 3);
    });
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.projects).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(result.warnings.join(' ')).toContain('changed while collecting');
    expect(result.warnings.join(' ')).toContain('overlapped between pages');
    expect(result.warnings.join(' ')).toContain('reported total');
  });

  it('stops rather than guessing pages from malformed pagination metadata', async () => {
    const read = reader({ data: [project()], meta: { page: 2, limit: 50, total: 1, pages: 2, hasNext: true } });
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.projects).toEqual([]);
    expect(result.complete).toBe(false);
    expect(read.mock.calls.filter(([path]) => path.startsWith('/units/'))).toHaveLength(1);
  });

  it('bounds pagination and reports the safety cap instead of claiming completion', async () => {
    const read = vi.fn(async (path: string) => {
      if (!path.startsWith('/units/')) return [];
      const pageNumber = Number(new URL(`https://example.invalid${path}`).searchParams.get('page'));
      return page([project({ id: pageNumber })], pageNumber, 101, 101);
    });
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.projects).toHaveLength(100);
    expect(read.mock.calls.filter(([path]) => path.startsWith('/units/'))).toHaveLength(100);
    expect(result.warnings.join(' ')).toContain('safety limit');
    expect(result.complete).toBe(false);
  });

  it('queries each seven-day window with both accessible events and own registrations', async () => {
    const read = reader();
    await new HttpEpitechStudentDataApi(read, now).collect(FROM, '2026-11-02T00:00:00Z', signal());
    const queries = read.mock.calls.filter(([path]) => path.startsWith('/events')).map(([path]) => new URL(`https://example.invalid${path}`).searchParams);
    expect(queries).toHaveLength(4);
    expect(queries.map((query) => query.get('registered'))).toEqual([null, 'me', null, 'me']);
    expect(queries[0]?.get('startDate')).toBe('2026-10-19T00:00:00.000Z');
    expect(queries[0]?.get('endDate')).toBe('2026-10-26T00:00:00.000Z');
    expect(queries[2]?.get('startDate')).toBe('2026-10-26T00:00:00.000Z');
    expect(queries[2]?.get('endDate')).toBe('2026-11-02T00:00:00.000Z');
  });

  it('deduplicates classes and uses the student personal slot without losing it to another window', async () => {
    const read = vi.fn(async (path: string) => {
      if (path.startsWith('/units/')) return page();
      if (path.includes('registered=me') && path.includes('2026-10-19')) return [event({ mySlotStartDate: '2026-10-22T13:15:00+02:00', mySlotEndDate: '2026-10-22T13:45:00+02:00' })];
      return path.includes('registered=me') ? [] : [event()];
    });
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, '2026-11-02T00:00:00Z', signal());
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      sourceId: 'epitech:event:8', sourceKind: 'class', registered: true, personalSlot: true,
      start: { dateTime: '2026-10-22T11:15:00.000Z' }, end: { dateTime: '2026-10-22T11:45:00.000Z' },
      location: '601 (Synthetic campus)',
    });
    expect(result.events[0]?.sourceUrl).toContain('/planning?eventId=8&start=2026-10-22&end=2026-10-23');
  });

  it('does not call broader accessible events the student registered timetable', async () => {
    const read = vi.fn(async (path: string) => path.startsWith('/units/') ? page() : path.includes('registered=me') ? [] : [event()]);
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.events[0]?.registered).toBeUndefined();
  });

  it('preserves offset instants across DST and non-Paris campuses', async () => {
    const read = reader(page(), [event({ startDate: '2026-10-25T01:30:00+09:00', endDate: '2026-10-25T02:30:00+09:00' })]);
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.events[0]).toMatchObject({ start: { dateTime: '2026-10-24T16:30:00.000Z' }, end: { dateTime: '2026-10-24T17:30:00.000Z' } });
  });

  it('uses date-only all-day moments with exclusive end dates', async () => {
    const read = reader(page([project({ startDate: '2026-10-20', endDate: '2026-10-25', endRegistrationDate: '2026-10-21' })]), [event({ startDate: '2026-10-22', endDate: '2026-10-23' })]);
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.events[0]).toMatchObject({ start: { date: '2026-10-22' }, end: { date: '2026-10-23' } });
    expect(result.projects[0]?.deadlines[0]).toMatchObject({ start: { date: '2026-10-25' }, end: { date: '2026-10-26' } });
  });

  it('does not invent a timezone for offsetless school timestamps', async () => {
    const read = reader(page([project({ endDate: '2026-10-25T20:00:00' })]), [event({ startDate: '2026-10-22T13:00:00' })]);
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.projects[0]?.dueAt).toBeUndefined();
    expect(result.projects[0]?.status).toBe('unknown');
    expect(result.projects[0]?.deadlines).toHaveLength(1);
    expect(result.events).toEqual([]);
    expect(result.warnings.join(' ')).toContain('time zone');
    expect(result.complete).toBe(false);
  });

  it('rejects normalized-but-invalid dates, mixed date types and incomplete slots', async () => {
    const read = reader(page(), [
      event({ id: 1, startDate: '2026-02-30T10:00:00Z' }),
      event({ id: 2, startDate: '2026-10-22T24:00:00Z' }),
      event({ id: 3, startDate: '2026-10-22' }),
      event({ id: 4, mySlotStartDate: '2026-10-22T10:00:00Z', mySlotEndDate: null }),
      event({ id: 5, endDate: '2026-10-22T10:00:00Z' }),
    ]);
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.events).toEqual([]);
    expect(result.complete).toBe(false);
  });

  it('retains explicit cancellation markers while never inferring cancellation from an absent record', async () => {
    const read = vi.fn(async (path: string) => path.startsWith('/units/') ? page() : [event({ cancelled: !path.includes('registered=me') })]);
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.events[0]?.cancelled).toBe(true);
    expect((await new HttpEpitechStudentDataApi(reader(), now).collect(FROM, TO, signal())).events).toEqual([]);
  });

  it('filters by interval overlap using an exclusive upper bound', async () => {
    const read = reader(page(), [
      event({ id: 1, startDate: '2026-10-18T23:30:00Z', endDate: '2026-10-19T00:30:00Z' }),
      event({ id: 2, startDate: '2026-10-18T23:00:00Z', endDate: FROM }),
      event({ id: 3, startDate: TO, endDate: '2026-10-26T01:00:00Z' }),
    ]);
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.events.map((row) => row.sourceId)).toEqual(['epitech:event:1']);
  });

  it('keeps the usable section and marks partial failures without exposing provider errors', async () => {
    const read = vi.fn(async (path: string) => {
      if (path.startsWith('/units/')) throw new Error('private token-shaped upstream details');
      return [event()];
    });
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.events).toHaveLength(1);
    expect(result.projects).toEqual([]);
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private token');
  });

  it('shows a partial warning when one timetable source fails', async () => {
    const read = vi.fn(async (path: string) => {
      if (path.startsWith('/units/')) return page([project()]);
      if (path.includes('registered=me')) throw new AuthError('server');
      return [event()];
    });
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.projects).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.registered).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('calendar is incomplete');
  });

  it('isolates an endpoint permission failure and keeps healthy project data', async () => {
    const read = vi.fn(async (path: string) => {
      if (path.startsWith('/units/')) return page([project()]);
      throw new AuthError('forbidden');
    });
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.projects).toHaveLength(1);
    expect(result.events).toEqual([]);
    expect(result.complete).toBe(false);
  });

  it('keeps valid IANA campus metadata alongside canonical offset instants', async () => {
    const read = reader(page([project()]), [event({ campusTimezone: 'Asia/Tokyo', startDate: '2026-10-25T01:30:00+09:00', endDate: '2026-10-25T02:30:00+09:00' })]);
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.projects[0]?.deadlines[0]?.start).toEqual({ dateTime: '2026-10-25T18:00:00.000Z', timeZone: 'Europe/Paris' });
    expect(result.projects[0]?.deadlines[0]?.end).toEqual({ dateTime: '2026-10-25T18:01:00.000Z', timeZone: 'Europe/Paris' });
    expect(result.events[0]?.start).toEqual({ dateTime: '2026-10-24T16:30:00.000Z', timeZone: 'Asia/Tokyo' });
  });

  it('ignores invalid or conflicting room zones without changing an explicit instant', async () => {
    const read = reader(page(), [event({ timezone: 'Invalid/Timezone', rooms: [{ name: 'A', campus: { timezone: 'Asia/Tokyo' } }, { name: 'B', campus: { timezone: 'Europe/Paris' } }] })]);
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.events[0]?.start).toEqual({ dateTime: '2026-10-22T11:00:00.000Z' });
  });

  it.each(['unauthorized', 'identity_mismatch', 'cancelled'] as const)('propagates %s rather than publishing an empty signed-in result', async (code) => {
    const read = vi.fn(async () => { throw new AuthError(code); });
    await expect(new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal())).rejects.toMatchObject({ code });
  });

  it('stops on cancellation before any request', async () => {
    const controller = new AbortController();
    controller.abort();
    const read = reader();
    await expect(new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(read).not.toHaveBeenCalled();
  });

  it('does not return late collection data after cancellation', async () => {
    const controller = new AbortController();
    const read = vi.fn(async (path: string) => {
      if (path.startsWith('/units/')) return page([project()]);
      controller.abort();
      return [event()];
    });
    await expect(new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
  });

  it.each([
    ['2026-02-30', TO], [TO, FROM], [FROM, FROM],
    [FROM, '2027-10-21T00:00:00Z'], ['2026-10-19T00:00:00', TO],
  ])('rejects invalid or unbounded ranges %s to %s', async (from, to) => {
    const read = reader();
    await expect(new HttpEpitechStudentDataApi(read, now).collect(from!, to!, signal())).rejects.toBeInstanceOf(StudentDataError);
    expect(read).not.toHaveBeenCalled();
  });

  it('classifies ongoing, upcoming, finished and unknown without filtering any category', async () => {
    const read = reader(page([
      project({ id: 1 }),
      project({ id: 2, startDate: '2026-11-01', endDate: '2026-11-03' }),
      project({ id: 3, startDate: '2026-10-01', endDate: '2026-10-22T12:00:00Z' }),
      project({ id: 4, startDate: null }),
    ]));
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(Object.fromEntries(result.projects.map((row) => [row.id, row.status]))).toEqual({ 1: 'ongoing', 2: 'upcoming', 3: 'finished', 4: 'unknown' });
  });

  it('does not export a project end preceding its start and safely falls back to the projects source page', async () => {
    const read = reader(page([project({ startDate: '2026-10-25', endDate: '2026-10-20', unitInstance: null })]));
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(result.projects[0]).toMatchObject({ status: 'unknown', sourceUrl: 'https://my.epitech.eu/projects' });
    expect(result.projects[0]?.deadlines.map((row) => row.sourceId)).toEqual(['epitech:project:17:registration']);
    expect(result.complete).toBe(false);
  });

  it('ignores untrusted external links and unrelated response fields', async () => {
    const read = reader(page([project({ sourceUrl: 'https://untrusted.invalid', staffDescription: 'private description' })]), [event({ externalUrl: 'https://untrusted.invalid', instructors: ['private login'] })]);
    const result = await new HttpEpitechStudentDataApi(read, now).collect(FROM, TO, signal());
    expect(JSON.stringify(result)).not.toContain('untrusted.invalid');
    expect(JSON.stringify(result)).not.toContain('private');
    expect(result.events[0]?.sourceUrl).toMatch(/^https:\/\/my\.epitech\.eu\//);
  });
});
