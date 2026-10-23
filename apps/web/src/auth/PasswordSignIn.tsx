import { useEffect, useState } from "react";
import type { SessionManager } from "../../../../src/application/sessionManager";

export function PasswordSignIn({ session, busy, disabled, onBegin }: {
  session: SessionManager;
  busy: boolean;
  disabled: boolean;
  onBegin(): void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  useEffect(() => {
    const clear = () => { setPassword(""); setEmail(""); };
    window.addEventListener("pagehide", clear);
    return () => window.removeEventListener("pagehide", clear);
  }, []);
  if (!open) return (
    <button className="secondary" disabled={disabled || busy} onClick={() => setOpen(true)}>
      Use email and password
    </button>
  );
  return (
    <form className="password-sign-in" aria-label="Email and password sign-in" onSubmit={(event) => {
      event.preventDefault();
      if (busy || disabled) return;
      const submittedPassword = password;
      setPassword("");
      onBegin();
      void session.connectWithPassword(email, submittedPassword);
    }}>
      <h3>Email and password</h3>
      <p id="password-sign-in-help" className="fine-print">
        For accounts enabled for MyEpitech’s external email/password sign-in.
        Microsoft-only accounts must continue with Microsoft. Student access is verified after sign-in.
      </p>
      <fieldset disabled={disabled || busy}>
        <label htmlFor="school-email">Email</label>
        <input id="school-email" name="email" type="email" autoComplete="username"
          autoCapitalize="none" spellCheck={false} maxLength={254} required
          value={email} onChange={(event) => setEmail(event.target.value)} />
        <label htmlFor="school-password">Password</label>
        <input id="school-password" name="password" type="password" autoComplete="current-password"
          maxLength={4096} required aria-describedby="password-sign-in-help"
          value={password} onChange={(event) => setPassword(event.target.value)} />
        <button type="submit" className="primary">Sign in with email</button>
      </fieldset>
      <button type="button" className="text-button" disabled={disabled} onClick={() => {
        setPassword(""); setEmail(""); setOpen(false);
        if (busy) void session.disconnect();
      }}>Cancel email sign-in</button>
      <p className="fine-print">Your password goes directly to MyEpitech over HTTPS. This app does not save it.</p>
    </form>
  );
}
