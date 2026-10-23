import type { CalendarEntry } from './calendar';

export interface StudentProject {
  id: string;
  title: string;
  status: 'ongoing' | 'upcoming' | 'finished' | 'unknown';
  sourceUrl: string;
  registered?: boolean;
  startAt?: string;
  dueAt?: string;
  registrationClosesAt?: string;
  deadlines: CalendarEntry[];
}

export interface StudentDataSnapshot {
  projects: StudentProject[];
  events: StudentTimetableEvent[];
  warnings: string[];
  range: { from: string; to: string };
  /** False means a failed request, invalid record or safety cap prevented a full collection. */
  complete: boolean;
  collectedAt: string;
}

export interface StudentTimetableEvent extends CalendarEntry {
  /** True only when returned by the server's registered=me view; absent means unconfirmed. */
  registered?: boolean;
  personalSlot?: boolean;
}

export interface EpitechStudentDataApi {
  /** The timetable range is inclusive at from and exclusive at to; projects are not date-filtered. */
  collect(from: string, to: string, signal: AbortSignal): Promise<StudentDataSnapshot>;
}

export class StudentDataError extends Error {
  constructor(readonly code: 'range' | 'contract') {
    super(code === 'range'
      ? 'Choose a valid timetable range of no more than one year.'
      : 'Some school dates could not be read. The school response may have changed.');
    this.name = 'StudentDataError';
  }
}
