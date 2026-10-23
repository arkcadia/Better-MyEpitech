# 0001: Android portal-backed login candidate

Date: 22 October 2026. Status: implemented for validation; not approved for release as a proven Android login.

## Context

The school frontend signs in through its own Microsoft application and redirects back to `https://my.epitech.eu`. It then exchanges the Microsoft ID token at `/api/auth/token`, stores the Epitech session in its own `@account` local-storage entry, verifies the session, and supports `/api/auth/refresh`.

The independent app cannot assume it owns the school's registration, can add a callback, or can use a token minted to an unrelated Microsoft application. Prior anonymous callback requests both encountered a missing-login error; they did not establish native callback support.

## Candidate selected

Open the real portal in a private Android WebView. The portal itself performs Microsoft sign-in and the initial token exchange. Only after the user presses the native **Continue with this school session** button may the app request the resulting Epitech access/refresh pair from the exact school origin.

The transfer script checks both top-frame execution and origin before reading `@account`. It never reads password fields, Microsoft page storage or other browser applications. It clears the private portal's local/session storage before handoff and closes that WebView once a valid response is received. The app then verifies the student role and matching own-profile identity before showing a connection or saving a verified session.

Native controls reject unknown navigation origins, cross-origin messages, expired/mismatched challenges, malformed credentials and replayed responses. The page-message handler is enabled only when the current top-level page is on the school origin; no transfer script is injected through page-load hooks or on Microsoft credential pages. Android does not expose frame identity on every navigation callback, so the one-use native challenge plus the script's top-frame check remain important boundaries to test on-device.

The wildcard `originWhitelist` in the WebView routes all URL schemes through our explicit `onShouldStartLoadWithRequest` predicate. It does not grant arbitrary destinations: the initial URL is fixed and subsequent requests must match an exact HTTPS school/Microsoft origin. Unknown domains, custom schemes, popup windows and unsupported broker/federation flows fail visibly; do not broaden the allowlist based on untrusted page instructions.

The known school button uses `loginRedirect`, so popup support is intentionally not implemented. The native app does not issue the initial `/auth/token` exchange a second time. For the portal candidate, native provider operations are session verification, own-profile read and refresh. A later user request separately authorizes a direct external-account email/password candidate; see [its setup and limits](../setup/email-password.md).

## Session behavior

- A single protected JSON value stores a versioned access/refresh pair with its verified account binding. It is not exposed through the UI snapshot.
- Renewals are serialized. A rotated pair is persisted before another network call can lose it on interruption; it is reverified before a connected state is exposed.
- A 401 permits one refresh/retry; permission failures do not trigger refresh loops.
- Temporary failures retain an already saved session, while invalid identity/role/session results clear it.
- Disconnect cancels current work and orders secure deletion after any in-flight secure write. Late responses cannot publish or persist a newer connection.
- Cold start and foreground return recheck the saved session. Local disconnect does not promise remote token revocation.

## Open validation requirements

This approach may fail because of tenant policies, MFA/broker requirements or WebView behavior. Generic RN WebView sign-in is not equivalent to an MSAL broker integration. A successful desktop portal login does not resolve that uncertainty.

The API adapter requests `redirect: 'error'` and rejects unexpected response URLs. Verify on the native networking implementation that authorization headers are not forwarded on a redirect; a unit test of RequestInit alone does not establish that native guarantee.

Incognito/cache-disabled settings and portal-storage clearing are implemented, but do not assert forensic disk isolation without Android verification. Verify that cancellation, successful handoff and reopening the private window do not silently retain a previous student's usable portal session. Do not disable TLS validation, spoof ownership of a registration or capture passwords to make a failing flow appear to work.

No backend or app-owned identity registration is introduced. If this candidate fails, record the actual failure and evaluate a supported independent-native flow or report the no-school-involvement dependency explicitly. Do not mark M0 complete or start later milestones until the real login criteria pass.

## References

- [Microsoft callback configuration](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)
- [Microsoft Android browser/WebView differences](https://learn.microsoft.com/en-us/entra/msal/android/customize-browsers-and-webviews)
- [React Native WebView reference](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md)
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
