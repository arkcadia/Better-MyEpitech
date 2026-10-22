# Better MyEpitech

An independent Android companion for Epitech students. The first implementation is a **login-only feasibility app**. Full document/data collection and optional Google Calendar/Drive exports remain in [architecture.md](architecture.md).

**Status:** implemented candidate; real Android school sign-in and session renewal are not yet validated. Automated tests do not establish that Microsoft's or Epitech's current policies permit this WebView flow for every student.

## Run the Android login test

Requirements: Node.js 24 LTS, npm, Java and the Android SDK configured for the current Expo/React Native versions, and an Android emulator or a USB-debugging-enabled Android device. Use the development build, not Expo Go.

```sh
npm ci
npm run android
```

For an already installed development build, `npm start` starts Metro. A physical phone must be able to reach the development server. No EAS account, hosted application server, Google account or Microsoft app registration is required for this candidate.

1. Press **Connect Epitech**.
2. Complete normal sign-in on the official school/Microsoft pages, including MFA if required.
3. When the school dashboard appears, press **Continue with this school session** in the app's native footer.
4. The app closes its private sign-in window and verifies the session and the student's own profile directly with Epitech.
5. Use **Check connection**, **Renew connection**, and **Disconnect from this device** to exercise the lifecycle.

Passwords are entered in the official pages. The application has no custom password form. Session values stay on the device, are stored using Expo SecureStore, and are never displayed or logged. Disconnect is local; it does not claim to revoke the school session remotely or sign out of Microsoft globally.

The selected approach and its limitations are in [the login decision record](docs/decisions/0001-android-portal-login.md). Follow [the real-device checklist](docs/validation/android-login.md) before claiming milestone M0 is complete.

## Checks

```sh
npm run typecheck
npm test
npm run bundle:android
```

Tests use synthetic fixtures and fake network/storage adapters. The Android export checks the JavaScript bundle, not installation or a successful native sign-in. CI repeats these checks for pull requests.

## Scope of this branch

- Official-portal sign-in candidate with an explicit session-connection action.
- Exact-origin navigation policy and one-use, expiring native transfer challenge.
- Student-role verification and matching `/auth/verify` / `/students/profile` identities.
- Protected session persistence, restore, serialized renewal and one retry after an expired access token.
- Local disconnect, cancellation and protection against late account/network/storage results.
- Minimal Android UI for connection status and lifecycle checks.

No school-side management actions, document collection, Google connections or general dashboard features are implemented yet. Those follow a validated Android login according to the architecture.

## Repository hygiene

Do not commit credentials, private response bodies, screenshots of student records, downloaded coursework or the school's recovered frontend bundles. The repository's visibility is unchanged. A project license has not been selected yet; the Expo starter attribution is retained separately in `docs/third-party/expo-template-LICENSE.txt`.

Known development-dependency advisories and release limitations are recorded with the validation results. Do not use `npm audit fix --force` to downgrade the SDK or hide an advisory.
