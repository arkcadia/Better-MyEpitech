# Coding instructions

- Read `architecture.md` before changing scope. Authorized scope now also includes accessible projects/deadlines, timetable collection and optional Google Calendar linking/manual export (23 October user instruction).
- Treat the portal-backed login as an unvalidated candidate until the real-device checklist is completed. Do not claim that unit tests or Android bundling prove school sign-in works.
- The current task is broader than login-only; document discovery, incremental device ZIPs and download history are now authorized. Google Drive and automatic synchronization remain future work.
- Keep provider URLs, credential handling and response validation in adapters; screens receive only verified student data and safe status/errors.
- Keep secrets, private fixtures, full OAuth URLs and signed download URLs out of code, logs, commits, issue bodies and screenshots.
- Preserve origin, challenge, cancellation, account-isolation and storage-order guarantees when modifying authentication.
- Run `npm run typecheck`, `npm test` and `npm run bundle:android` for authentication changes. Record native/runtime checks separately from mocked checks.
- Do not merge a pull request or change repository visibility as part of implementation.

- Web implementation is now authorized. Read `docs/setup/web.md` and `docs/validation/web.md`; authenticated web release remains gated on real Microsoft/Epitech interoperability. Never replace the app-owned registration with the school’s client registration.
- Run `npm run typecheck:web` and `npm run build:web` for web/shared changes. Keep the dedicated MSAL redirect bridge separate from the main app. Preview fixtures must stay clearly marked and must never trigger real exports.

- Read `docs/api/documents.md`, `docs/setup/documents.md` and `docs/validation/documents.md` for document work. Do not claim all-source coverage without portal reconciliation. Persist only account-scoped hash metadata for the explicitly authorized download history; it survives sign-out until explicitly forgotten.
- Never advance download history on an unfinished ZIP or a mere download/share prompt. Preserve exact-host signed URL checks and credential-free file-host requests.
