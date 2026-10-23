# Better MyEpitech

An independent Android companion for Epitech students. Connect your school account, browse accessible projects and deadlines, view the school timetable, and manually add selected dates to Google Calendar. The complete document/data and Google Drive roadmap remains in [architecture.md](architecture.md).

**Status:** implementation candidate. Automated tests and bundle checks do not prove real Android school sign-in, MFA, renewal, or Google authorization. See the separate [login](docs/validation/android-login.md) and [projects/calendar](docs/validation/projects-calendar.md) evidence records before treating this as release-ready.

## Run on a PC or phone

Use Node.js 24, npm, Java, the Android SDK and an Android emulator or USB-debugging-enabled phone. This app requires an Android development build.

```sh
npm ci
npm run android
```

For an installed development build, `npm start` starts Metro. The phone must reach the development server. `npm run android` compiles and installs the native app; a JavaScript export alone does not do that.

1. Press **Connect Epitech**, complete the normal school/Microsoft pages and MFA, then press **Continue with this school session** when the school dashboard appears.
2. The app verifies the student role and matching own-profile identity, then loads projects and a two-week timetable window.
3. Browse ongoing, upcoming, finished or all projects. Project due dates and registration cutoffs are separate entries. Open the school page to confirm submission rules.
4. In **Timetable**, navigate date windows and choose all accessible events or confirmed registrations. Personal appointment slots take precedence over the wider session.
5. Google Calendar is optional. Follow [Google Calendar setup](docs/setup/google-calendar.md), connect your own Google account, and press **Add / update in Google Calendar** on a class or deadline.
6. Test school **Check connection**, **Renew connection**, and **Disconnect from this device** separately from collection/export testing.

Google setup requires an app-owned Cloud project, Calendar API and an Android OAuth client registered for the package/signing certificate. The app does not need school-side changes or a hosted server. Google Drive is not implemented in this slice.

Passwords are entered on official pages; the app has no password form. School tokens use SecureStore. Google tokens stay transient and Google Play services handles authorization caching. Core school browsing works without Google. Disconnect is local and does not delete previously exported Google events or claim global Microsoft sign-out.

## Data coverage and limits

Projects are collected across every page of the server's accessible projects response. The UI can filter by date-based status and exposes missing/invalid dates instead of inventing deadlines. The timetable combines accessible events and the student's own registration view in bounded seven-day requests; a two-week UI window is not an import of all historical calendar data. See [endpoint evidence](docs/api/student-dates.md).

Collection failures, permission denials, unsupported date formats and safety limits produce visible coverage notices. Offsetless timestamps are not interpreted using the phone's timezone. Snapshot data stays in memory, is refreshed manually, and is cleared on school disconnect/account changes. Encrypted offline repositories remain future work.

Calendar exports target an app-created calendar with narrow permission. Repeated actions reconcile a stable provider ID. School changes require another explicit action; source cancellations never automatically delete exports. Events edited independently in Google must not be overwritten silently. See the setup guide for recovery after an uncertain calendar-creation request.

## Checks

```sh
npm run typecheck
npm test
npm run bundle:android
npx expo prebuild --platform android --no-install
```

Tests use synthetic data and fake adapters. CI repeats these checks and compiles an x86_64 emulator development build, including the local Google Identity Services module. Native compilation is separate from actually installing and signing in.

Keep personal records, tokens, full OAuth URLs, screenshots of student data, downloaded coursework and recovered school frontend bundles out of commits. A project license is still undecided; starter attribution remains in `docs/third-party/expo-template-LICENSE.txt`. Known dependency advisories are recorded in the validation documents; do not force an obsolete SDK downgrade to hide them.
