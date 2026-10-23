import {
  AuthError,
  safeAuthError,
  type Credentials,
} from "../../../../src/domain/auth";
import type { MicrosoftSignIn } from "./microsoft";

type Session = {
  disconnect(): Promise<void>;
  connectFromPortal(value: Credentials): Promise<void>;
};
export type SignInState = { busy: boolean; issue: string | null };

/** Popup completions after cancel/logout can never reconnect the student. */
export class WebSignIn {
  private generation = 0;
  private controller = new AbortController();
  private state: SignInState = { busy: false, issue: null };
  private listeners = new Set<() => void>();
  constructor(
    private readonly microsoft: MicrosoftSignIn,
    private readonly session: Session,
    private readonly exchange: (
      token: string,
      signal: AbortSignal,
    ) => Promise<Credentials>,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: SignInState) {
    this.state = state;
    this.listeners.forEach((fn) => fn());
  }
  async start() {
    if (this.state.busy) return;
    this.controller.abort();
    this.controller = new AbortController();
    const controller = this.controller;
    const generation = ++this.generation;
    this.publish({ busy: true, issue: null });
    // Start the popup on the click before waiting for session cleanup.
    const pendingToken = this.microsoft.signIn();
    // Attach a rejection handler immediately while disconnect finishes.
    void pendingToken.catch(() => undefined);
    try {
      await this.session.disconnect();
      const token = await pendingToken;
      if (generation !== this.generation) return;
      const credentials = await this.exchange(token, controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return;
      // Legacy shared name: this verifies role/profile before any connected state.
      await this.session.connectFromPortal(credentials);
    } catch (error) {
      if (generation === this.generation)
        this.publish({
          busy: false,
          issue:
            error instanceof AuthError && error.code === "cancelled"
              ? null
              : safeAuthError(error).message,
        });
    } finally {
      if (generation === this.generation)
        this.publish({ ...this.state, busy: false });
    }
  }
  async cancel() {
    ++this.generation;
    this.controller.abort();
    this.publish({ busy: false, issue: null });
    await this.session.disconnect();
    await this.microsoft.clear().catch(() => undefined);
  }
}
