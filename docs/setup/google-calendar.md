# Google Calendar for Android

This build contains an optional Google Calendar connector. School sign-in does not require Google. The connector is disabled until the developer configures an app-owned Google Cloud project and enables the build flag below. No real Google login, native authorization resolution, or live event creation has been validated in this workspace.

## Authorization choice

The local Expo module in `modules/better-google-auth` calls Google's Android **AuthorizationClient**. Google recommends this API for authorization to user data; it is separate from the school authentication flow. It opens Google's native account selection/consent UI. It does not use the school's Microsoft registration, the assistant's connected Google account, a web OAuth callback, or a client secret. The module uses Google Play services auth `22.0.0`, the version in the current [Android authorization guide](https://developer.android.com/identity/authorization).

The connector requests:

| Scope | Purpose |
| --- | --- |
| `https://www.googleapis.com/auth/calendar.app.created` | Create an app-owned secondary calendar and manage its events. |
| `openid` | Obtain a stable Google subject identifier from Google userinfo. |
| `https://www.googleapis.com/auth/userinfo.email` | Display the selected account and bind future authorization to that account. |

It does not request access to the student's primary calendar, other calendars, contacts, Drive, or a server refresh token. Only the selected account's subject and verified email are retained for linking. The Calendar scope allows secondary-calendar creation and event insert/update; see [Calendar authorization scopes](https://developers.google.com/workspace/calendar/api/auth), [calendars.insert](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert), and [events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).

## Developer setup

1. Create a Google Cloud project controlled by this app's maintainer and enable **Google Calendar API**. Complete Google Auth Platform branding/audience/data-access configuration. Add the three scopes above; when using a testing audience, add each tester's Google account. A school account is not required to own the project. Check Google's current verification requirements before public distribution.
2. Create an OAuth client of type **Android**. Use package name `eu.bettermyepitech.app` and the SHA-1 certificate fingerprint of the actual build. Register each signing identity you use: local debug, distributed release, and Google Play App Signing as applicable. With native files generated, `cd android` followed by `./gradlew signingReport` displays the signing fingerprints. Do not commit private keystores.
3. This on-device AuthorizationClient flow resolves the Android client from the package/signing certificate registration. It does not take a web client ID or client secret in JavaScript. Do not paste credentials into the school portal or invent an OAuth redirect URI. The Android registration ID can be recorded privately for maintainers; there is no ID placeholder to replace in source. Google's [authorization setup guide](https://developer.android.com/identity/authorization) covers Cloud setup and account selection.
4. In an uncommitted `.env.local`, add `EXPO_PUBLIC_GOOGLE_CALENDAR_ENABLED=true`. This is a public build flag, not a secret. Restart Metro after changing it. A flag alone does not configure Google Cloud.
5. Install dependencies, generate the native Android project, and rebuild the development app: `npm ci`, `npx expo prebuild --platform android`, then `npm run android`. Rebuilding is necessary because a local native module was added. Use a physical Android phone or an emulator image with current **Google Play services** and a Google account. Expo Go and a browser preview cannot run this module. See [Expo local modules](https://docs.expo.dev/workflow/customizing/) and [Expo Google authentication configuration](https://docs.expo.dev/guides/google-authentication/).

There is no backend and no offline Google access grant. Each explicit export asks the native SDK for a current short-lived access token and verifies the account using Google's HTTPS userinfo endpoint. Google Play services manages its authorization cache. The app does not persist Google access, ID, or refresh tokens. Linked account metadata and the app calendar ID are kept in Expo SecureStore, scoped to both the school login and Google subject.

## Student behavior

After school sign-in, connect the intended Google account. Linking alone does not create a calendar or event. On a class or a project deadline, press **Add to Google Calendar** after reviewing its date/time and room. The first export creates a secondary calendar named **Better MyEpitech**. It appears beside the student's existing Google calendars. Ensure this calendar is enabled in the Google Calendar UI to see its events.

A class exports its title, exact start/end instants and available IANA time zone, room, description and school source link. A deadline exports the supplied date/time; an all-day deadline uses a date with an exclusive next-day end. The app does not silently guess a missing deadline or convert an unknown school wall time into a precise instant. Cancelled school entries cannot be exported. Events include no attendees and invite nobody.

Exports are manual. There is no background synchronization, subscription, automatic deletion, or automatic cancellation propagation. Repeating the action checks the existing event. If the school changed the selected entry, the same explicit action updates that event only when its managed Google fields still match the last export. External edits produce a conflict instead of being overwritten. A Google ETag condition prevents an update from racing another editor; see [conditional modification](https://developers.google.com/workspace/calendar/api/guides/version-resources).

Disconnect removes this app's local link and drops transient access. It preserves the protected calendar mapping, so reconnecting the same school/Google account pair can find existing exports. Disconnect does not remove previously exported events or revoke Google's stored consent. Google consent can be revoked from the student's Google Account connections settings. Removing or reinstalling the app may remove local mappings; see the recovery limits below.

## Duplicate prevention and recovery limits

Event IDs are SHA-256 based on the source kind/ID, school account and Google subject. Retries, repeated taps and a fresh app process reuse that ID in the same app calendar. An insert timeout is followed by a lookup on the next explicit export; an insert conflict is resolved by reading that same ID. A mismatch or a user-deleted event stops safely. There is no fallback that creates another copy with a random ID.

Google's calendar-creation method has no client-supplied calendar ID. Before creating the secondary calendar, the app saves a protected pending marker. If the response is lost or the app dies before storing the resulting ID, the next attempt stops with **Calendar creation may have completed**. A definitive HTTP rejection clears the marker; ambiguous failures do not. This deliberately avoids creating a second calendar on every retry.

To recover a pending creation without a known ID:

1. Open Google Calendar in a browser using the Google account shown in the app. Check Settings for a **Better MyEpitech** calendar. If present, inspect it and save any information you want to keep, then permanently delete that secondary calendar using Google's own UI. Do not delete your primary calendar.
2. Before clearing app data, record any other school/Google account pairs you have linked. Clearing data also removes their protected mappings. To avoid later duplicates for those pairs, retain their Google calendars without re-exporting, or remove their old Better MyEpitech calendars first after reviewing them.
3. In Android Settings, open this app's storage settings and clear app storage. Reopen the app, sign in to school again, connect Google again, then explicitly export an item. This resets the pending marker and creates a fresh app calendar.

The minimal scope does not authorize `calendarList.list`, so the app cannot silently scan all calendars to recover an ID. Automatic cross-device/reinstall calendar recovery is outside this candidate. The limitation is explicit rather than requesting broader calendar-read permissions. Google documents the different [calendar-list scopes](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list).

## Validation checklist

All live checks below remain pending until a maintainer has configured the OAuth project and can run Android:

- Compile/install the native module; confirm package/SHA-1 registration and current Play services.
- Cancel account selection; decline Calendar permission; test partial grants and retry.
- Link a personal Google account; confirm its email is displayed and no calendar appears just from linking.
- Explicitly export one class with a room and one project deadline; check time zone, daylight-saving boundaries, all-day exclusive end and source links in Google Calendar.
- Repeat an export, restart the app, and repeat again: one calendar and one event per selected source.
- Change the school fixture's date/room and explicitly update; modify the Google event separately and confirm the next update reports a conflict.
- Test a lost connection after an event insert, a revoked Google grant, a deleted calendar, school logout during authorization and switching both account types.
- Test uncertain calendar-creation recovery in a disposable test account. Never delete production calendars as an unattended test.

Unit tests use synthetic accounts and fake HTTP/native adapters. They exercise scope/account checks, explicit-write boundaries, date handling, durable creation fencing, deterministic IDs, conflict handling and logout races. They are not evidence of successful native OAuth or Calendar API access. No live Google Calendar events were created during this work session.
