# Projects, timetable and Google Calendar validation

Date: 23 October 2026. Implementation scope was explicitly expanded by the user while real Android login validation remains pending.

## Evidence boundaries

- The current main branch already contains the login implementation (merged through PR #2); original draft PR #1 was closed without merging. No new Android test results were supplied.
- An authenticated desktop portal session still opens the Projects and Planning pages. The Projects page visibly groups ongoing/upcoming/completed projects, includes registered and unregistered accessible records, displays start/registration/end dates and offers more rows. Planning displays ranges, times, rooms and registration state. No private row content was copied into repository fixtures.
- Endpoint shapes come from the previously observed public frontend release, authored into independent adapters. The browser tooling did not capture raw authenticated network responses. Live API shape, pagination guarantees and access coverage remain unverified.
- Local Java 21 is available, but no configured Android SDK, adb, emulator or device was found. Android login/MFA/refresh, Google consent and device private-storage behavior remain pending.

## Automated checks

The tests cover account-scoped data collection, bounded authenticated GET routes, concurrent renewal, pagination, partial failures, invalid/ambiguous dates, personal slots, all-day dates, source cancellation, retries and Google export duplicate/conflict protection. Fixtures are synthetic. Local outcomes:

| Check | Outcome |
| --- | --- |
| TypeScript | Passed. |
| Synthetic automated suite | Passed: 167 tests in 9 files. |
| Android Hermes export | Passed. |
| Expo Android prebuild | Passed. |
| Local Google module autolinking | Detected correct Android module. |
| Native APK compilation | CI check added; result tracked in the pull request. |
| Live school API / Android login / Google OAuth | Pending interactive runtime validation. |

CI status is reported in the pull request; passing these checks is not live provider evidence.

## Runtime checklist

1. Build/install the current Android development build; complete every pending [login check](android-login.md).
2. Compare visible project counts across pagination with the school website's matching filters. Verify ongoing/upcoming/completed classifications and both project due and registration dates. Investigate server defaults that may restrict unfiltered results.
3. Compare a full two-week timetable against the website. Verify registered-only entries, shared accessible events, rooms, timezone/DST and individual defense slots. Navigate adjacent windows and inspect the ending boundary.
4. Check invalid/unsupported source dates and a denied source: the app must show a coverage gap while retaining independent readable sources.
5. Follow [Google setup](../setup/google-calendar.md), use an appropriate Play-services-enabled emulator/device and test account, and exercise declined/cancelled consent without losing school browsing.
6. After a deliberate Add action, verify the actual Google account, dedicated calendar, title, instant/all-day dates, room and source link. Repeat the action and restart before retrying; there must be one exported item.
7. Change synthetic source metadata and deliberately request an update. Edit an exported event directly in Google and check that the app reports a conflict rather than silently overwriting it.
8. Exercise disconnect/account changes and pending network/native authorization results. No private row or export may appear under another school/Google account.
9. Check the documented uncertain-calendar-creation recovery on disposable test data. Never infer that an unknown write failed or automatically create another calendar.

No live Google event is created by unattended tests. Document collection, Drive export, durable offline data and background automatic synchronization remain outside this slice. Previous upstream build-tool dependency advisories remain documented in the login validation record.
