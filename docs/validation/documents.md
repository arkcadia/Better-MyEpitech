# Document/ZIP validation evidence

23 October 2026. Status: **implementation candidate; live school coverage and device delivery remain unvalidated**.

## Independently tested

Root TypeScript checks, the web production build, Android Hermes export and 223 synthetic tests passed locally. Native SDK compilation for the document implementation passed in [Companion checks run 39940789020](https://github.com/arkcadia/Better-MyEpitech/actions/runs/39940789020), alongside the web build. Physical-device/runtime and school-provider evidence remain pending.

- Source registry fixtures: own visible administrative/personal files, historical years, nested project files, activity files, e-learning PDF/text/subtitles, follow-up attachments, partial/forbidden source handling, pagination that ignores the requested page and wrong-account/expired-session rejection.
- ZIP generation/extraction: original binary bytes, duplicate names, safe extension/category folders, sink backpressure, invalidation on mid-file failure and no finishing a partial archive.
- Incremental ledger: known saved versions are skipped, changed/new files are included, force-redownload remains possible, missing revision markers remain visibly unverified while already saved IDs are skipped by default and can be explicitly refreshed, no commit before explicit confirmation where required, cancellation/account changes cannot commit an unfinished archive, unreadable history is not silently replaced.
- Browser persistence adapter: IndexedDB transactions exercised with fake-indexeddb; concurrent-tab commits merge and a new adapter instance sees prior records. This is a synthetic storage test, not a physical-device test.
- Browser archive adapter with simulated picker/writable APIs: cancellation before transfer, disk-full failure on close, successful-close ordering before history commit, Blob output cap and object-URL cleanup. These are adapter tests, not proof that the operating system saved a file.
- Delayed old-account ZIP cleanup cannot detach a new account's archive; repeated confirmation requests produce a single history write, and a failed history write can be retried.
- Binary school reads use the same student verification/refresh owner as JSON and a fixed own-attachment allowlist. Signed-storage transfers do not receive school Authorization/cookies and reject non-allowlisted/redirected destinations.
- Browser preview inspected: extension groups, duplicate filename contexts, explicit ZIP-ready/confirmation state and fictional file selection. The in-app browser did not expose a completed download event; actual browser device delivery is not claimed from clicking a Blob link. A simulated saved confirmation in the browser preview was followed by adding a fifth fictional file: the UI showed four saved versions and exactly one file eligible for the next missing-files ZIP. This exercises the ledger separately from OS delivery evidence.

No real school file, source response, signed URL, school session or downloaded course material was committed or used as a fixture. No file host, school token acceptance or broad coverage was invented. A successful bundle and fixture tests are not evidence of an authenticated import.

## Live checklist

- [ ] Configure/verify an actual app school session on each platform.
- [ ] Reconcile every supported source and historical term with the student-visible portal; record gaps/counts safely.
- [ ] Validate unit pagination, inherited/template resources and folder expansion in current responses.
- [ ] Configure observed exact file hosts and confirm byte access, expiring-link renewal and web CORS.
- [ ] Save/extract an actual original document ZIP on desktop browsers; verify picker cancellation and denied storage.
- [ ] Rebuild/test Android FileSystem/Sharing, save a ZIP through the directory picker, cancel the picker/share sheet, restart and check ledger persistence/cleanup.
- [ ] Validate known-size/truncated transfer, low storage, slow/large file, logout during transfer, deleted local ZIP/force-redownload, and two school accounts.

Google Drive export remains a separate future feature. External platforms, streaming video and undocumented sources remain link-only or unsupported until their connectors are validated. The library must keep coverage gaps visible; it must not label this checklist as full support for all accessible documents yet.
