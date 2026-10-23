# Coding instructions

- Read `architecture.md` before changing scope. Authorized scope now also includes accessible projects/deadlines, timetable collection and optional Google Calendar linking/manual export (23 October user instruction).
- Treat the portal-backed login as an unvalidated candidate until the real-device checklist is completed. Do not claim that unit tests or Android bundling prove school sign-in works.
- The current task is broader than login-only; keep documents, Google Drive and automatic synchronization as future work.
- Keep provider URLs, credential handling and response validation in adapters; screens receive only verified student data and safe status/errors.
- Keep secrets, private fixtures, full OAuth URLs and signed download URLs out of code, logs, commits, issue bodies and screenshots.
- Preserve origin, challenge, cancellation, account-isolation and storage-order guarantees when modifying authentication.
- Run `npm run typecheck`, `npm test` and `npm run bundle:android` for authentication changes. Record native/runtime checks separately from mocked checks.
- Do not merge a pull request or change repository visibility as part of implementation.
