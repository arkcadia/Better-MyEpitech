import type { CalendarMoment } from "../../../src/domain/calendar";
export function formatMoment(moment: CalendarMoment): string {
  if ("date" in moment)
    return `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${moment.date}T00:00:00Z`))} · All day`;
  const zone = moment.timeZone ?? "UTC";
  return `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(new Date(moment.dateTime))} (${zone})`;
}
export const entryTime = (moment: CalendarMoment) =>
  "date" in moment ? moment.date : moment.dateTime;
export function safeSchoolLink(value: string): string | null {
  try {
    const url = new URL(value);
    return url.origin === "https://my.epitech.eu" &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
