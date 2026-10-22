# Android login validation

Date: 22 October 2026. **M0 remains pending real-device validation.**

## Implemented checks

Automated tests cover exact-origin policy, transfer consent/challenges, replay/expiry/frame checks, credential-shape validation, role/identity checks, session restore, refresh rotation, bounded retry, transient failures, secure-storage failures, disconnect and stale-response races. All fixtures are synthetic.

Typechecking and Android JavaScript bundling are implementation checks. Neither substitutes for compiling/installing a native application, completing school sign-in, testing MFA, or proving a real refresh token works.

| Local check | Outcome |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm test` | Passed: 55 tests in 3 files. |
| `npm run bundle:android` | Passed: Android Hermes bundle generated. |
| `npx expo prebuild --platform android --no-install` | Passed: Android native configuration generated; not a native compilation. |
| Dependency audit | Not clean; see the advisory follow-up below. |

## Runtime checklist

Use a consenting Epitech student account. Record device model, Android/WebView versions, build commit and outcome. Never record tokens, complete OAuth URLs, passwords, cookies or full profile responses.

| Check | Status / required evidence |
| --- | --- |
| Native Android build/install | Pending; this development environment has no Android SDK or connected device. |
| Fresh school sign-in | Pending; complete the official portal redirect flow inside the app. |
| Normal MFA | Pending or not applicable for a specified test account; do not disable MFA. |
| Explicit session handoff | Pending; after dashboard appears, press the native Continue button. |
| Student-role and own-profile verification | Pending live API evidence; show only minimal account identity. |
| Cancel before and during handoff | Pending; no connection may appear later. |
| Cold restart | Pending; reopen the installed app and observe successful re-verification. |
| Real session renewal | Pending; use Renew connection, then verify that the own-profile read succeeds. |
| Natural expiry recovery | Pending; distinguish this from manually requesting renewal while a token is still valid. |
| Invalid/revoked session | Pending; require reconnection without exposing another account's profile. |
| Local disconnect and restart | Pending; saved native session must be removed. No claim of global Microsoft logout. |
| Private portal cleanup | Pending; reopening/cancelling/handoff must not silently reuse a previous student's session. |
| Redirect credential boundary | Pending; verify native networking rejects redirects without forwarding the bearer header. |
| Offline and school service failure | Pending; safe retry and accurate status, with no false connected state. |

## Dependency advisory follow-up

The current registry audit reports high-severity findings propagated through Expo/Metro/React Native build-tool chains from two underlying advisory families: `braces <=3.0.3` (nested-pattern denial of service) and `node-forge <=1.4.0` (signature verification). At implementation time these are also the registry's latest releases, so a compatible patched upstream version was not available.

Do not claim a clean dependency audit. Do not accept npm's proposed downgrade to obsolete Expo/React Native versions or blindly force an audit fix. Recheck upstream fixes before release, review the affected build-tool usage, and avoid exposing the development server to untrusted networks. This record is not evidence of exploitability in the shipped mobile JavaScript; runtime reachability and release readiness still need review.

- [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)

## Result reporting

When runtime validation is performed, append the commit and sanitized per-check outcomes here. Keep separate columns for automated/fake-adapter evidence and real Android/provider evidence. Do not replace pending items with a general claim that login works.
