export type CalendarMoment = { date: string } | { dateTime: string; timeZone?: string };

export interface CalendarEntry {
  sourceId: string;
  sourceKind: 'class' | 'deadline';
  title: string;
  sourceUrl: string;
  start: CalendarMoment;
  end: CalendarMoment;
  location?: string;
  description?: string;
  cancelled: boolean;
}
