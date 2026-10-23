# Project dates and timetable adapter

Updated 23 October 2026. This documents a source-supported implementation candidate. The synthetic tests do not establish successful authenticated HTTP access from Android.

## Evidence and permitted reads

The planning workspace recovered the public frontend's `Api/resources/Projects.tsx`, `Api/resources/Events.tsx`, `Api/APIHelper.tsx`, `Components/Scheduler/Scheduler.tsx`, and project navigation helper. These were observations of release 3.65.0, not a supported integration agreement. The original [public API source map](https://my.epitech.eu/assets/contexts-Cs5McpZ8.js.map) described the client expectations; asset names may change on deployment. No copied school application implementation or student response fixture is included in this repository.

The current desktop student UI also visibly presents ongoing, upcoming and completed projects, their start/registration/end dates, and planning events with times and rooms. This corroborates the product concepts and navigation. It does not establish the raw response envelopes, student-specific completeness, Android session compatibility, cancellation payloads or date-only payloads.

| Read | Source-supported request | Expected body | Boundary |
| --- | --- | --- | --- |
| Accessible projects | `GET /units/instances/projects?page=1&limit=50` | `{data: ProjectInstance[], meta: {page, limit, total, pages, hasNext, hasPrev}}` | No student/campus identifiers. The server retains access control. `registeredOnly` is deliberately omitted so accessible unregistered projects are retained. |
| Accessible planning window | `GET /events?startDate=<ISO instant>&endDate=<ISO instant>` | `SchedulerEvent[]` | No student, instructor, campus or staff filters. This is the server's accessible view, not a claim that every event is the student's own registered class. |
| Own registered planning window | Same route plus `registered=me` | `SchedulerEvent[]` | Explicit current-account view. The website combines this with its normal accessible list. |

The unfiltered project list and timetable are subject to provider defaults and permissions that still need real HTTP validation. Do not describe the result as a proven exhaustive export of every school project/calendar. The app does not request staff details, rosters, directories, another student's identifier, calendar export tokens, registrations mutations or school calendar mutations.

## Contract mapping

Projects require a positive numeric `id` and nonempty `name`; display uses `fullName` when supplied. The adapter retains `isUserRegistered` as optional `registered`, start date, project end date and registration cutoff. It does not copy student members, staff descriptions, repository credentials or unrelated raw fields. Status is derived at collection time: upcoming before start, ongoing until end, finished at/after a timed end (or after a date-only end day), unknown when bounds are unsupported. All returned categories remain available to the app.

`endDate` becomes a **Project due** marker and `endRegistrationDate` a separate **Registration closes** marker. A project end is not claimed to be every submission rule or every intermediate milestone. Check the source page for those rules. A timed deadline uses a one-minute calendar marker beginning at the exact published instant. A date-only deadline is an all-day marker whose Google end date is the following day, exclusive. No submission or registration is performed.

Project links are constructed from source-supported `unitInstance.schoolYear`, `unitTemplate.code` or `unitCode`, `unitInstance.code`, and project ID. Missing navigation fields fall back to the real `/projects` page. Event links use `/planning` with `eventId`, `start`, and `end`. Arbitrary API-provided external URLs are not trusted or copied into source links.

Events require a positive numeric `id`, title and valid start/end. `fullTitle` is preferred when available. Only room/campus labels, unit/activity labels and a personal-slot note enter the normalized model. When the API supplies `mySlotStartDate` / `mySlotEndDate`, that pair replaces the wider event window. A partial or invalid personal slot is skipped with a warning rather than silently substituted with a potentially wrong time. Own registered results and personal slots take precedence when duplicate event IDs occur across responses/windows. `registered: true` means the row appeared in the server's `registered=me` response. Absence means registration was not confirmed; it does not mean the event is unregistered.

Every exportable entry preserves a stable source identifier (`epitech:event:<id>`, `epitech:project:<id>:due` or `:registration`), school link and source kind. These support account-scoped Google duplicate prevention without relying on mutable titles.

## Ranges, pagination and time zones

- Project pages are read sequentially until `hasNext` is false. Page indices, array shape, counts and progress are validated. Repeated IDs, changing totals, missing records, malformed pagination or the 100-page safety limit mark collection incomplete. No next-page URL supplied by the server is followed.
- Timetable ranges are inclusive at the beginning and exclusive at the end, up to 366 days per user request. Both event views are queried in adjacent windows of at most seven days, mirroring the school's weekly-query concept without inventing unsupported pagination. Results are deduplicated by source ID and filtered by interval overlap. A safety limit of 10,000 rows per response is explicit and reports partial coverage.
- An empty source response is valid. Failed source/window requests retain independently retrieved data and produce a visible partial-coverage warning. Ordinary endpoint permission failures are partial; expired/changed identity, cancellation or secure-storage failure abort collection through the session boundary. Cancellation is checked before and after every await so late data is never returned for a disconnected collection.
- Valid `Z` or explicit-offset timestamps are converted to canonical UTC instants. Valid IANA timezone metadata from direct/unit/campus fields is preserved on timed calendar moments; inconsistent room zones are not guessed. A Tokyo campus is not assumed to use Paris time. The adapter rejects offsetless datetimes with a warning even if a zone label is present, because ambiguous/nonexistent daylight-saving wall times need a verified provider contract.
- Exact `YYYY-MM-DD` values are preserved as all-day dates with exclusive end semantics. Invalid dates (including normalized February 30), mixed date/timestamp bounds, reversed intervals and invalid times are skipped or retained without an exportable date, with a warning. The observed source interfaces did not establish a separate all-day flag; date-only support is defensive and tested with synthetic inputs.

## Cancellations and freshness

The recovered scheduler types do not establish cancellation/tombstone fields. Explicit `cancelled` / `canceled` boolean or matching status markers are retained defensively and make the entry unsuitable for a new calendar export. Missing events on a later refresh are **not** inferred as cancellation. A provider may simply delete an event or hide it behind a changed range/filter. Live Google events are not silently deleted or modified by collection; export is always the app user's explicit action.

Snapshots include the requested range, collection time, completion flag and safe warnings. `complete: true` means this adapter finished its supported requests without a detected omission; it does not prove provider-side exhaustiveness, future stability, successful login, or automatic ongoing synchronization. Data is account-bound by the session manager and cleared by the app's disconnect/account-change lifecycle. It is not sent to an application backend.

## Validation record

`tests/studentData.test.ts` uses only synthetic records. It verifies project pagination, safety limits, registration scope, project status/cutoff/end distinctions, stable source links and IDs, personal slots, deduplication, partial endpoint failures including 403, cancellation, range boundaries, date-only semantics, offset-aware instants, IANA metadata, malformed dates, and rejected unbounded ranges.

Still pending against a real Android student session: raw body/envelope confirmation, pagination counts and defaults, accessible-versus-registered scope, all relevant project milestones, personal-slot behavior, server range boundary semantics, campus zones, and whether any cancellation/all-day payload is actually emitted. No live school session token or personal project/calendar content is included in this evidence.
