# Coding instructions

- Read `architecture.md` before changing scope. Current implementation scope is M0: Android login, session persistence/renewal, and one own-profile read.
- Treat the portal-backed login as an unvalidated candidate until the real-device checklist is completed. Do not claim that unit tests or Android bundling prove school sign-in works.
- Do not implement the later collection or Google milestones as part of a login-only task.
- Keep provider URLs, credential handling and response validation in adapters; screens receive only verified student data and safe status/errors.
- Keep secrets, private fixtures, full OAuth URLs and signed download URLs out of code, logs, commits, issue bodies and screenshots.
- Preserve origin, challenge, cancellation, account-isolation and storage-order guarantees when modifying authentication.
- Run `npm run typecheck`, `npm test` and `npm run bundle:android` for authentication changes. Record native/runtime checks separately from mocked checks.
- Do not merge a pull request or change repository visibility as part of implementation.
