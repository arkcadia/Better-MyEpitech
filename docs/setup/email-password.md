# Alternative email/password sign-in

The user explicitly requested this alternative on 23 October 2026. It is available in web **Connections → Use email and password** and on the Android sign-in screen. No app-owned Entra registration is needed for this specific flow.

This is a **source-derived candidate for accounts supported by MyEpitech’s external sign-in**, not proof that ordinary student Microsoft passwords work. The recovered school `externalLogin(email, password)` client posts JSON to `/api/auth/external` and consumes `access_token` / `refresh_token`. If your school account uses Microsoft-only authentication, use Microsoft/the normal school portal, including MFA. No Microsoft password grant, credential proxy, account creation or password-reset feature is included.

The client sends the password directly to the exact HTTPS school endpoint with no cookies, bearer, referrer, redirect following or HTTP cache. It never puts the password in a URL, storage, logs or session snapshots. Inputs clear on submit/cancel/page hide or native background. This limits retention; it is not a promise that a JavaScript string can be securely zeroized. Browser password-manager behavior is controlled by the student/browser, independently of app storage.

After exchange, the existing session manager must verify a student role and matching own-profile login before exposing or saving a connection. A successful password exchange for staff/external-only accounts does not grant app access. Aliases are allowed: the verified school login, rather than the typed address, scopes the account and its data. Web tokens remain in memory; Android saves only the verified school session in SecureStore. Renewal uses the school refresh token, never a retained password.

Rejected requests show a sanitized error, the school's HTTP status (400/401/403) and a Microsoft alternative; the app does not automatically repeat the password request. This response alone does not prove that the password is incorrect or establish the exact account-policy restriction. No raw provider message, credential or response body is displayed. If the official website redirects the account to Microsoft, use that sign-in method; this external-account endpoint has not been proven compatible with it. Cancellation/sign-out invalidates late completions, and duplicate submissions do not send parallel attempts.

## Validation evidence

All 241 synthetic tests passed, including exact destination/request fields, unchanged password whitespace, malformed input/tokens, sanitized rejection, redirected response rejection, timeout during response-body reading, student-only verification, profile mismatch, no password in stored state, duplicate attempts, retry, storage failure and cancellation/method switching with late responses. Root/web TypeScript checks, production web build and Android Hermes export also passed. These checks are separate from runtime evidence.

Browser UI inspection checks the alternative remains available with Microsoft registration disabled, masked password input, labels and cancellation clearing fictional inputs. No real password or school login was submitted during this inspection.

Pending live checks:

- [ ] A consenting student account is actually accepted by `/auth/external`; distinguish external-only accounts from ordinary Microsoft accounts.
- [ ] The browser can read successful and failed school responses with normal CORS enabled.
- [ ] An accepted token pair verifies student role and own profile, then reads actual student data.
- [ ] Wrong password, school lockout/rate-limit behavior and Microsoft-only rejection are clear; never test repeated guesses.
- [ ] Real Android and web cancellation, reload/restore, refresh, sign-out and account switching preserve isolation.

No real login success, general Microsoft compatibility or release readiness is established by these tests. Test your credentials locally in the app; do not put passwords, tokens or private responses in chat or GitHub issues.
