import { AuthError } from '../domain/auth';
import type { StudentDataSnapshot } from '../domain/studentData';

export interface StudentDataCollector {
  collect(from: string, to: string, signal: AbortSignal): Promise<StudentDataSnapshot>;
}

export interface StudentDataState {
  account: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: StudentDataSnapshot | null;
  issue: string | null;
}

/** In-memory snapshot, deliberately discarded at every account boundary. */
export class StudentDataManager {
  private state: StudentDataState = { account: null, status: 'idle', data: null, issue: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller = new AbortController();
  constructor(private readonly collector: StudentDataCollector) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(update: Partial<StudentDataState>) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  setAccount(account: string | null) {
    if (this.state.account === account) return;
    this.controller.abort();
    this.generation += 1;
    this.publish({ account, status: 'idle', data: null, issue: null });
  }
  async refresh(from: string, to: string) {
    if (!this.state.account) return;
    this.controller.abort();
    this.controller = new AbortController();
    const controller = this.controller;
    const generation = ++this.generation;
    // Old-range records must never appear under a new range heading.
    this.publish({ status: 'loading', data: null, issue: null });
    try {
      const data = await this.collector.collect(from, to, controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return;
      this.publish({ status: 'ready', data });
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return;
      const issue = error instanceof AuthError ? error.message : 'School information could not be loaded. Please try again.';
      this.publish({ status: 'error', issue, data: null });
    }
  }
  suspend() { this.controller.abort(); this.generation += 1; this.publish({ account: null, data: null, status: 'idle', issue: null }); }
}

export function timetableWindow(offset = 0, now = new Date()): { from: string; to: string } {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset * 14);
  return { from: new Date(start).toISOString(), to: new Date(start + 14 * 86_400_000).toISOString() };
}
