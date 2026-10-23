# Web validation evidence

Date: 23 October 2026. Status: **experimental foundation; authenticated release blocked**.

## Implemented candidate

- Separate React web UI and npm workspace, with independent dev/production builds.
- Shared school session verification/renewal and paginated/date-window collectors; memory-only web credentials and account-scoped snapshots.
- Disabled-by-default app-owned Microsoft SPA popup adapter with a dedicated MSAL 5 redirect bridge. No school credentials, school client registration or tokens are bundled.
- Explicit sample-data workspace for UI evaluation; projects/search/registered-project filter, timetable ranges, source timezone/all-day labels and cancellations. Mocked evidence never establishes provider feasibility.
- Google web linking/export and Drive remain unimplemented. Document collection/ZIP candidates are recorded separately in [document validation](documents.md). Android features and build entry points remain available.

## Evidence recorded

- `npm run typecheck`, `npm run typecheck:web`, `npm test`: passed; 188 synthetic tests including callback restrictions, malformed/rejected exchanges, cancellation during popup/exchange, duplicate click protection and memory vault lifetime.
- `npm run build:web`: passed; emits both main page and redirect bridge.
- `npm run bundle:android`: passed (Hermes export). This is not a new native runtime/device test.
- Browser UI: preview entry/exit, project search/no matches, registered-project checkbox, next timetable window, source timezone/cancellation labels and disabled sign-in without configuration inspected in the in-app Chromium browser. Narrow 390px viewport inspected; navigation clipping corrected. Browser automation is observational evidence, not a committed end-to-end test suite.
- Actual browser probe from `http://localhost:5173`: one read-only `/api/auth/verify` request using a deliberately invalid synthetic bearer returned a readable 401, `type: cors`. No valid credential or private response was used. This proves response access for that anonymous rejection only, not token acceptance, authenticated data or file hosts.
- Public HTTP preflight for `POST /api/auth/token` from `http://localhost:5173`: 204 with `Access-Control-Allow-Origin: *`; server reflects requested allowed headers. No credentials sent. This header check alone is not authenticated browser CORS proof.

## Email/password alternative

The later user-authorized email/password candidate is available separately from the disabled-by-default Microsoft adapter. It posts directly to the school’s observed external-account endpoint and shares student/session verification. Its synthetic and browser UI evidence, ordinary Microsoft compatibility limits and pending real-account checks are in [email/password validation](../setup/email-password.md). It does not satisfy the Microsoft interoperability checklist below.

## Live checklist — pending

- [ ] Create app-owned Microsoft registration and exact SPA redirect; tenant consent permits the student.
- [ ] Microsoft popup/bridge, ordinary MFA and cancellation work in supported real browsers.
- [ ] School accepts this independent client’s ID token; verified student role and matching own-profile identity succeed.
- [ ] Authenticated project pagination and timetable/registration unions match the actual school UI.
- [ ] Browser can read bearer-authenticated responses, refresh and file-host bytes without disabling security.
- [ ] Expiry/renewal, sign-out, account switching, reload and back/forward-cache restoration preserve isolation.
- [ ] Configured web Google OAuth/manual exports and durable duplicate prevention implemented and validated.
- [ ] Production security headers/HTTPS and browser matrix validated before deployment.

No real school login, authenticated school response, Google authorization, live export or document download was performed for this web slice. No client ID, tenant consent or token audience support has been invented. A readable 401 with a synthetic token is transport evidence only.

Known dependency advisories inherited from the Expo toolchain remain recorded in the Android validation documents; installing web dependencies does not resolve them.
