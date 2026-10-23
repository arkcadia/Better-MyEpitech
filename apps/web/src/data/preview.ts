import type { StudentDataSnapshot } from "../../../../src/domain/studentData";

/** Synthetic examples only; no student or school response is embedded in this fixture. */
export function previewData(from: string, to: string): StudentDataSnapshot {
  const day = from.slice(0, 10);
  const at = (hour: string) => `${day}T${hour}:00.000Z`;
  const next = new Date(Date.parse(from) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    range: { from, to },
    complete: true,
    collectedAt: new Date().toISOString(),
    warnings: [],
    projects: [
      {
        id: "preview-project",
        title: "Build a tiny shell",
        status: "ongoing",
        registered: true,
        sourceUrl: "https://my.epitech.eu/dashboard",
        dueAt: next,
        deadlines: [
          {
            sourceId: "preview-deadline",
            sourceKind: "deadline",
            title: "Tiny shell · submission",
            sourceUrl: "https://my.epitech.eu/dashboard",
            start: { date: next },
            end: {
              date: new Date(Date.parse(from) + 2 * 86_400_000)
                .toISOString()
                .slice(0, 10),
            },
            cancelled: false,
          },
        ],
      },
      {
        id: "preview-project-2",
        title: "Network fundamentals",
        status: "upcoming",
        sourceUrl: "https://my.epitech.eu/dashboard",
        deadlines: [],
      },
    ],
    events: [
      {
        sourceId: "preview-class",
        sourceKind: "class",
        title: "Project workshop",
        location: "Room 601",
        start: { dateTime: at("11:00"), timeZone: "Europe/Paris" },
        end: { dateTime: at("13:00"), timeZone: "Europe/Paris" },
        sourceUrl: "https://my.epitech.eu/dashboard",
        cancelled: false,
        registered: true,
      },
      {
        sourceId: "preview-cancelled",
        sourceKind: "class",
        title: "Group check-in",
        location: "Room 402",
        start: { dateTime: at("14:00"), timeZone: "Europe/Paris" },
        end: { dateTime: at("15:00"), timeZone: "Europe/Paris" },
        sourceUrl: "https://my.epitech.eu/dashboard",
        cancelled: true,
      },
    ],
  };
}
