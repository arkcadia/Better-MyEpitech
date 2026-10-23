import {
  AuthError,
  normalizedLogin,
  parseCredentials,
  parseStoredSession,
  safeAuthError,
  type Credentials,
  type EpitechAuthApi,
  type SessionVault,
  type VerifiedStudent,
} from '../domain/auth';

export type SessionStatus = 'disconnected' | 'restoring' | 'connecting' | 'checking' | 'refreshing' | 'connected' | 'disconnecting' | 'reauthentication_required' | 'error';

export interface SessionSnapshot {
  readonly status: SessionStatus;
  readonly student: VerifiedStudent | null;
  readonly issue: AuthError | null;
  readonly lastVerifiedAt: number | null;
  readonly refreshCount: number;
}

const emptySnapshot = (): SessionSnapshot => ({ status: 'disconnected', student: null, issue: null, lastVerifiedAt: null, refreshCount: 0 });
const invalidSession = (error: AuthError) => ['unauthorized', 'forbidden', 'not_student', 'identity_mismatch', 'contract'].includes(error.code);

async function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new AuthError('cancelled');
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new AuthError('cancelled'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([pending, cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export function expiresSoon(token: string, now: number): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return false;
    const json: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof json !== 'object' || json === null || !('exp' in json)) return false;
    return typeof json.exp === 'number' && json.exp * 1_000 <= now + 30_000;
  } catch {
    // Token claims are only an expiry hint. The API verifies identity and role.
    return false;
  }
}

export class SessionManager {
  private snapshot: SessionSnapshot = emptySnapshot();
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller = new AbortController();
  private credentials: Credentials | null = null;
  private boundLogin: string | null = null;
  private storageQueue: Promise<unknown> = Promise.resolve();
  private checkPromise: Promise<void> | null = null;

  constructor(
    private readonly api: EpitechAuthApi,
    private readonly vault: SessionVault,
    private readonly now: () => number = Date.now,
  ) {}

  getSnapshot = (): SessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(update: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    this.listeners.forEach(listener => listener());
  }

  private begin(status: SessionStatus): number {
    this.controller.abort();
    this.controller = new AbortController();
    this.generation += 1;
    this.checkPromise = null;
    this.credentials = null;
    this.boundLogin = null;
    this.snapshot = { ...emptySnapshot(), status };
    this.listeners.forEach(listener => listener());
    return this.generation;
  }

  private assertCurrent(generation: number): void {
    if (this.generation !== generation || this.controller.signal.aborted) throw new AuthError('cancelled');
  }

  private store<T>(operation: () => Promise<T>, generation?: number): Promise<T> {
    const task = this.storageQueue.then(async () => {
      if (generation !== undefined) this.assertCurrent(generation);
      try {
        const result = await operation();
        if (generation !== undefined) this.assertCurrent(generation);
        return result;
      } catch (error) {
        if (error instanceof AuthError) throw error;
        throw new AuthError('storage');
      }
    });
    this.storageQueue = task.catch(() => undefined);
    return task;
  }

  private async fail(error: unknown, generation: number, imported = false): Promise<void> {
    if (generation !== this.generation) return;
    const issue = safeAuthError(error);
    if (issue.code === 'cancelled') return;
    if (invalidSession(issue) || imported) {
      this.credentials = null;
      this.boundLogin = null;
      try {
        await this.store(() => this.vault.clear());
      } catch {
        if (generation === this.generation) this.publish({ status: 'error', student: null, issue: new AuthError('storage') });
        return;
      }
    }
    if (generation !== this.generation) return;
    this.publish({ status: invalidSession(issue) ? 'reauthentication_required' : 'error', issue, student: null });
  }

  async restore(): Promise<void> {
    const generation = this.begin('restoring');
    try {
      const value = await this.store(() => this.vault.read(), generation);
      this.assertCurrent(generation);
      if (!value) {
        this.publish({ status: 'disconnected' });
        return;
      }
      const saved = parseStoredSession(value);
      this.credentials = saved.credentials;
      this.boundLogin = saved.login;
      await this.verifyCurrent(generation);
    } catch (error) {
      await this.fail(error, generation);
    }
  }

  async connectFromPortal(value: Credentials): Promise<void> {
    const generation = this.begin('connecting');
    try {
      await this.store(() => this.vault.clear());
      this.assertCurrent(generation);
      this.credentials = parseCredentials(value);
      await this.verifyCurrent(generation);
    } catch (error) {
      await this.fail(error, generation, true);
    }
  }

  private async rotate(generation: number): Promise<void> {
    this.assertCurrent(generation);
    if (!this.credentials) throw new AuthError('unauthorized');
    this.publish({ status: 'refreshing' });
    const next = await this.api.refresh(this.credentials, this.controller.signal);
    this.assertCurrent(generation);
    this.credentials = parseCredentials(next);
    // Preserve a rotated refresh token even if the subsequent profile read fails.
    // Bound identity is still checked before exposing a connected state.
    if (this.boundLogin) {
      const saved = { version: 1 as const, credentials: this.credentials, login: this.boundLogin };
      await this.store(() => this.vault.write(saved), generation);
    }
    this.assertCurrent(generation);
    this.publish({ refreshCount: this.snapshot.refreshCount + 1 });
  }

  private async verifyCurrent(generation: number, forceRefresh = false): Promise<void> {
    this.assertCurrent(generation);
    if (!this.credentials) throw new AuthError('unauthorized');
    let refreshed = false;
    if (forceRefresh || expiresSoon(this.credentials.accessToken, this.now())) {
      await this.rotate(generation);
      refreshed = true;
    }
    let student: VerifiedStudent;
    for (;;) {
      try {
        this.assertCurrent(generation);
        const identity = await this.api.verify(this.credentials!.accessToken, this.controller.signal);
        this.assertCurrent(generation);
        if (!identity.roles.includes('student')) throw new AuthError('not_student');
        const login = normalizedLogin(identity.login);
        if (this.boundLogin && login !== this.boundLogin) throw new AuthError('identity_mismatch');
        // Bind before a later profile 401 can trigger a rotation.
        this.boundLogin = login;
        student = await this.api.ownProfile(this.credentials!.accessToken, this.controller.signal);
        this.assertCurrent(generation);
        if (normalizedLogin(student.login) !== login) throw new AuthError('identity_mismatch');
        break;
      } catch (error) {
        if (!(error instanceof AuthError) || error.code !== 'unauthorized' || refreshed) throw error;
        await this.rotate(generation);
        refreshed = true;
      }
    }
    this.assertCurrent(generation);
    const saved = { version: 1 as const, credentials: this.credentials!, login: this.boundLogin! };
    await this.store(() => this.vault.write(saved), generation);
    this.assertCurrent(generation);
    this.publish({ status: 'connected', student, issue: null, lastVerifiedAt: this.now() });
  }

  /** Concurrent checks share one refresh/verification sequence. */
  checkConnection(forceRefresh = false): Promise<void> {
    if (this.checkPromise) return this.checkPromise;
    if (!this.credentials) return this.restore();
    const generation = this.generation;
    this.publish({ status: 'checking', issue: null });
    const task = this.verifyCurrent(generation, forceRefresh).catch(error => this.fail(error, generation));
    this.checkPromise = task;
    void task.finally(() => {
      if (this.checkPromise === task) this.checkPromise = null;
    });
    return task;
  }

  /** Authenticated student reads never expose credentials to screens or collectors. */
  async readSchool(path: string, callerSignal: AbortSignal): Promise<unknown> {
    const generation = this.generation;
    const login = this.boundLogin;
    const sessionSignal = this.controller.signal;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const assertConnected = () => {
      this.assertCurrent(generation);
      if (callerSignal.aborted) throw new AuthError('cancelled');
      if (!login || this.boundLogin !== login || !this.credentials || !this.snapshot.student ||
          normalizedLogin(this.snapshot.student.login) !== login) {
        throw this.snapshot.issue ?? new AuthError('unauthorized');
      }
    };
    assertConnected();
    callerSignal.addEventListener('abort', abort, { once: true });
    sessionSignal.addEventListener('abort', abort, { once: true });
    try {
      // Foreground/manual checks and all data reads share the same refresh owner.
      if (this.checkPromise) await waitFor(this.checkPromise, controller.signal);
      assertConnected();
      if (expiresSoon(this.credentials!.accessToken, this.now())) {
        await waitFor(this.checkConnection(), controller.signal);
        assertConnected();
      }
      const attemptedToken = this.credentials!.accessToken;
      const attemptedRefreshCount = this.snapshot.refreshCount;
      try {
        const result = await this.api.readSchool(path, attemptedToken, controller.signal);
        assertConnected();
        return result;
      } catch (error) {
        assertConnected();
        if (!(error instanceof AuthError) || error.code !== 'unauthorized') throw safeAuthError(error);
      }

      // A parallel read may have already renewed this token. Await its verification
      // before retrying; never rotate the same refresh token concurrently.
      if (this.checkPromise) await waitFor(this.checkPromise, controller.signal);
      assertConnected();
      if (this.credentials!.accessToken === attemptedToken && this.snapshot.refreshCount === attemptedRefreshCount) {
        await waitFor(this.checkConnection(true), controller.signal);
        assertConnected();
      }
      try {
        const result = await this.api.readSchool(path, this.credentials!.accessToken, controller.signal);
        assertConnected();
        return result;
      } catch (error) {
        assertConnected();
        const issue = safeAuthError(error);
        if (issue.code === 'unauthorized') await this.fail(issue, generation);
        // Endpoint permission/schema errors belong to this source, not the login.
        throw issue;
      }
    } finally {
      callerSignal.removeEventListener('abort', abort);
      sessionSignal.removeEventListener('abort', abort);
    }
  }

  async disconnect(): Promise<void> {
    const generation = this.begin('disconnecting');
    try {
      // Storage operations are serialized; a late write cannot outlive this clear.
      await this.store(() => this.vault.clear());
      this.assertCurrent(generation);
      this.publish({ status: 'disconnected' });
    } catch (error) {
      if (generation === this.generation) this.publish({ status: 'error', issue: safeAuthError(error), student: null });
    }
  }

  suspend(): void {
    this.controller.abort();
    this.generation += 1;
    this.credentials = null;
    this.boundLogin = null;
    this.checkPromise = null;
  }
}
