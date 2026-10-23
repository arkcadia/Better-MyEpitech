# Web development and experimental school sign-in

The first web slice is a React/TypeScript app built with Vite under `apps/web`. Android stays at the repository root for now. Both consume the existing platform-independent models, session manager and school collectors; native UI, SecureStore, WebView and Google native authorization are not imported by the browser. Workspace/package migration remains incremental rather than moving the Android build before browser feasibility is established.

## Run on a PC

Use Node.js 24 and npm from the repository root:

```sh
npm ci
npm run web
```

Open **http://localhost:5173**. No Android emulator or SDK is needed. Choose **Explore the preview** to try fictional projects, deadlines, cancellations and timetable navigation. The banner always identifies sample data; this is not a school login. Preview navigation makes no school or Google requests. Exiting the preview removes the sample workspace.

```sh
npm run typecheck:web
npm run build:web
npm run preview:web
```

The production preview runs at **http://localhost:4173**. Production files are in `apps/web/dist`; the Android export still uses root `dist`. No deployment is configured or performed.

## Email/password alternative

**Connections → Use email and password** uses the school’s external-account endpoint directly. It is available without Microsoft configuration; support for ordinary student Microsoft credentials is unproven. It still requires verified student access and live CORS checks. See [email/password setup and validation](email-password.md).

## Configure a candidate Microsoft flow

This is an **experimental feasibility adapter**, disabled by default. The school frontend exchanges a Microsoft ID token at its `/auth/token` endpoint. That does **not** prove its server will accept a token issued for Better MyEpitech’s own client ID. A successful Microsoft sign-in alone never displays a connected school account: school token exchange, verified student role and a matching own-profile identity must all succeed.

1. Create a Microsoft Entra app registration that you own, if your directory policy permits this. Do not reuse Epitech’s registration or request its secret. If registration or consent requires school administration, record that as a blocker under the no-school-involvement constraint.
2. Configure the **Single-page application** platform and register `http://localhost:5173/redirect.html` exactly. Record the public Application (client) ID and target Directory (tenant) ID. The target directory must allow the student’s sign-in. No client secret belongs in a browser app.
3. Copy `apps/web/.env.example` to `apps/web/.env.local`. Set the two public IDs, exact redirect URI, and `VITE_EXPERIMENTAL_SCHOOL_LOGIN=true`. Restart the dev server. `localhost` and `127.0.0.1` are different origins: open the configured one. For port 4173, register that distinct redirect and rebuild with the matching value.
4. Open **Connections → Continue with Microsoft** in a top-level browser tab. Allow its sign-in popup and complete ordinary sign-in/MFA at Microsoft. The app requests OIDC identity scopes, not Graph mailbox/files access.
5. Record whether school token exchange and profile verification succeed. A school 401/403 may mean the independent audience is unsupported. Do not substitute the school’s client ID, paste a token, proxy credential entry, disable CORS or claim a BFF fixes the audience restriction.
6. Test cancellation during the popup and token exchange; sign out, reload and switch school accounts. A late result must not reconnect a signed-out student. Then complete the live checklist in [web validation](../validation/web.md).

The adapter uses MSAL Browser 5’s authorization-code/PKCE popup flow and a separate redirect bridge HTML entry. The bridge must be built and served at `/redirect.html`; it must not load the main app, routing or analytics. Do not serve a `Cross-Origin-Opener-Policy` header on that bridge page. This candidate uses popups to keep credentials in memory; mobile Safari/popup restrictions require separate testing. A fallback redirect flow is not implemented.

### Credential lifetime and sign-out

MSAL uses memory storage for provider credentials and clears its cache after each attempt. Its SDK-managed temporary OAuth state/PKCE transaction metadata may use sessionStorage; that is distinct from persisting provider access/refresh tokens. The returned ID token is used only for the fixed school exchange; school access/refresh tokens live in the in-memory session vault. School reads and renewal use the shared manager with bounded retries, student identity checks, cancellation and account isolation. Browser requests omit cookies, reject redirects and bypass HTTP caches. Credentials are not written to localStorage, sessionStorage, IndexedDB or an app server. Closing/reloading the page ends this app session. Page-hide also clears access; a restored browser page must reconnect.

Local sign-out clears this app’s school session and data; it does not claim server-side token revocation or global Microsoft sign-out. School refresh tokens are usable only while this page/runtime exists. Do not add persistent token storage to make reloads work. No analytics, service worker, offline archive or background synchronization is included.

### Remaining release gates

- App-owned registration/tenant consent and Epitech acceptance of its ID-token audience.
- Real browser school login/MFA, renewal, account switching, logout and authenticated API collection.
- Authenticated CORS on all used endpoints and file-host byte access for documents/ZIPs and future Drive. See [documents setup](documents.md).
- Browser Google OAuth/linking, protected credential handling and durable duplicate-prevention metadata. **Google Calendar export is not available on web yet**; Android’s native adapter remains separate. No fake connected account or placeholder export button is offered.
- Hosting/security-header configuration, supported browser matrix and any decision to introduce a BFF. A BFF requires a legitimate login path and a separate custody/retention/CSRF design.

Keep production sessions out of public previews. Use HTTPS outside localhost, no shared caching of authenticated responses, a restrictive Content Security Policy and `Referrer-Policy: no-referrer`; preserve the redirect bridge’s COOP exception. Deployment and authenticated release remain gated, even though the static preview builds.

References checked on 23 October 2026: [Microsoft SPA quickstart](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-single-page-app-sign-in), [MSAL redirect bridge](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge), [MSAL sign-in](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/login-user), [Vite guide](https://vite.dev/guide/). These describe supported building blocks, not Epitech interoperability.
