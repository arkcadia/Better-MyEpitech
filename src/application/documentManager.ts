import { AuthError } from "../domain/auth";
import {
  checkDocumentSignal,
  DocumentError,
  type ArchiveFactory,
  type DocumentIndex,
  type DocumentReader,
  type DownloadHistory,
  type DownloadRecords,
  type SavedArchive,
  type SchoolDocument,
} from "../domain/documents";
import { writeDocumentZip } from "./documentZip";

export type DocumentStatus = "new" | "downloaded" | "changed" | "unversioned";
export type DocumentState = {
  account: string | null;
  status:
    | "idle"
    | "scanning"
    | "ready"
    | "exporting"
    | "awaiting_confirmation"
    | "error";
  index: DocumentIndex | null;
  states: Record<string, DocumentStatus>;
  issue: string | null;
  progress: { completed: number; total: number; bytes: number } | null;
  savedCount: number;
};
type Dependencies = {
  collect(account: string, signal: AbortSignal): Promise<DocumentIndex>;
  reader: DocumentReader;
  history: DownloadHistory;
  digest(value: string): Promise<string>;
};
const empty = (account: string | null): DocumentState => ({
  account,
  status: "idle",
  index: null,
  states: {},
  issue: null,
  progress: null,
  savedCount: 0,
});
export class DocumentManager {
  private state = empty(null);
  private generation = 0;
  private controller = new AbortController();
  private listeners = new Set<() => void>();
  private accountKey: string | null = null;
  private history: DownloadRecords = {};
  private keys = new Map<string, { id: string; revision: string }>();
  private artifact: SavedArchive | null = null;
  private delivery: symbol | null = null;
  private recording: symbol | null = null;
  private pending: DownloadRecords | null = null;
  constructor(private readonly dependencies: Dependencies) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(update: Partial<DocumentState>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach((fn) => fn());
  }
  private assert(generation: number) {
    if (generation !== this.generation) throw new DocumentError("cancelled");
    checkDocumentSignal(this.controller.signal);
  }
  setAccount(account: string | null) {
    if (this.state.account === account) return;
    this.controller.abort();
    this.generation++;
    this.controller = new AbortController();
    void this.artifact?.dispose().catch(() => undefined);
    this.artifact = null;
    this.delivery = null;
    this.recording = null;
    this.pending = null;
    this.history = {};
    this.keys.clear();
    this.accountKey = null;
    this.state = empty(account);
    this.listeners.forEach((fn) => fn());
  }
  private async keyed(index: DocumentIndex, generation: number) {
    const keys = new Map<string, { id: string; revision: string }>();
    for (const document of index.documents) {
      const id = await this.dependencies.digest(`document-v1:${document.id}`);
      this.assert(generation);
      const revision = await this.dependencies.digest(
        `revision-v1:${document.revision ?? "unknown"}`,
      );
      this.assert(generation);
      keys.set(document.id, { id, revision });
    }
    return keys;
  }
  private statuses(index: DocumentIndex) {
    return Object.fromEntries(
      index.documents.map((document) => {
        const key = this.keys.get(document.id)!;
        const previous = this.history[key.id];
        return [
          document.id,
          previous
            ? document.revision === null
              ? "unversioned"
              : previous === key.revision
                ? "downloaded"
                : "changed"
            : "new",
        ];
      }),
    ) as Record<string, DocumentStatus>;
  }
  async scan() {
    const account = this.state.account;
    if (
      !account ||
      ["scanning", "exporting", "awaiting_confirmation"].includes(
        this.state.status,
      )
    )
      return;
    this.controller.abort();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const generation = ++this.generation;
    this.publish({
      status: "scanning",
      index: null,
      states: {},
      issue: null,
      savedCount: 0,
      progress: null,
    });
    try {
      const key = await this.dependencies.digest(
        `account-v1:${account.trim().toLowerCase()}`,
      );
      this.assert(generation);
      const history = await this.dependencies.history.read(key);
      this.assert(generation);
      const index = await this.dependencies.collect(account, signal);
      this.assert(generation);
      const keys = await this.keyed(index, generation);
      this.assert(generation);
      this.accountKey = key;
      this.history = history;
      this.keys = keys;
      this.publish({ index, status: "ready", states: this.statuses(index) });
    } catch (error) {
      this.fail(error, generation);
    }
  }
  private fail(error: unknown, generation: number) {
    if (generation !== this.generation) return;
    this.pending = null;
    this.publish({
      status: this.state.index ? "ready" : "error",
      issue:
        error instanceof DocumentError || error instanceof AuthError
          ? error.message
          : new DocumentError("transfer").message,
      progress: null,
    });
  }
  /** Factory is called synchronously before the first await, preserving a browser save-picker gesture. */
  async download(
    ids: readonly string[],
    missingOnly: boolean,
    factory: ArchiveFactory,
  ) {
    if (!this.state.index || !this.accountKey || !this.state.account) return;
    if (
      ["scanning", "exporting", "awaiting_confirmation"].includes(
        this.state.status,
      )
    )
      return;
    const selected = new Set(ids);
    const documents = this.state.index.documents.filter(
      (document) =>
        selected.has(document.id) &&
        (!missingOnly ||
          isMissingDocumentStatus(this.state.states[document.id])),
    );
    if (!documents.length) {
      this.publish({ issue: new DocumentError("empty").message });
      return;
    }
    const generation = this.generation;
    const signal = this.controller.signal;
    this.publish({
      status: "exporting",
      issue: null,
      savedCount: 0,
      progress: { completed: 0, total: documents.length, bytes: 0 },
    });
    const pendingSink = factory();
    void pendingSink.catch(() => undefined);
    try {
      const sink = await pendingSink;
      try {
        this.assert(generation);
      } catch (error) {
        await sink.abort();
        throw error;
      }
      const artifact = await writeDocumentZip(documents, {
        reader: this.dependencies.reader,
        sink,
        digest: this.dependencies.digest,
        signal,
        progress: (completed, total, bytes) => {
          if (generation === this.generation)
            this.publish({ progress: { completed, total, bytes } });
        },
      });
      this.assert(generation);
      this.artifact = artifact;
      this.pending = Object.fromEntries(
        documents.map((document) => {
          const key = this.keys.get(document.id)!;
          return [key.id, key.revision];
        }),
      );
      if (artifact.confirmed) {
        this.delivery = null;
        await this.confirmSaved();
      } else this.publish({ status: "awaiting_confirmation" });
    } catch (error) {
      this.fail(error, generation);
    }
  }
  getDownloadLink() {
    return this.state.status === "awaiting_confirmation"
      ? (this.artifact?.downloadLink ?? null)
      : null;
  }
  async saveZip(): Promise<boolean> {
    const generation = this.generation;
    const artifact = this.artifact;
    if (!artifact?.save || this.delivery || this.recording) return false;
    const delivery = Symbol();
    this.delivery = delivery;
    try {
      await artifact.save?.();
      this.assert(generation);
      if (artifact.confirmed) {
        this.delivery = null;
        await this.confirmSaved();
      }
      return true;
    } catch (error) {
      if (generation === this.generation)
        this.publish({
          issue:
            error instanceof DocumentError
              ? error.message
              : "The save action did not finish. Your download history is unchanged.",
        });
      return false;
    } finally {
      if (this.delivery === delivery) this.delivery = null;
    }
  }
  async shareZip(): Promise<boolean> {
    const generation = this.generation;
    const artifact = this.artifact;
    if (!artifact?.share || this.delivery || this.recording) return false;
    const delivery = Symbol();
    this.delivery = delivery;
    try {
      await artifact.share();
      this.assert(generation);
      return true;
    } catch {
      if (generation === this.generation)
        this.publish({
          issue:
            "The share action did not finish. Download history is unchanged.",
        });
      return false;
    } finally {
      if (this.delivery === delivery) this.delivery = null;
    }
  }
  async confirmSaved() {
    if (
      this.delivery ||
      this.recording ||
      !this.pending ||
      !this.accountKey ||
      !this.state.index
    )
      return;
    const recording = Symbol();
    this.recording = recording;
    const generation = this.generation;
    const records = this.pending;
    const key = this.accountKey;
    const artifact = this.artifact;
    try {
      this.assert(generation);
      await this.dependencies.history.commit(key, records);
      this.assert(generation);
      this.history = { ...this.history, ...records };
      const count = Object.keys(records).length;
      this.pending = null;
      this.artifact = null;
      // Detach before awaiting cleanup: a new account/export may start while it finishes.
      await artifact?.dispose().catch(() => undefined);
      this.assert(generation);
      this.publish({
        status: "ready",
        states: this.statuses(this.state.index!),
        savedCount: count,
        progress: null,
        issue: null,
      });
    } catch {
      if (generation === this.generation)
        this.publish({
          status: "awaiting_confirmation",
          issue: new DocumentError("history").message,
        });
    } finally {
      if (this.recording === recording) this.recording = null;
    }
  }
  async discardZip() {
    const artifact = this.artifact;
    this.controller.abort();
    const generation = ++this.generation;
    this.controller = new AbortController();
    this.pending = null;
    this.artifact = null;
    this.delivery = null;
    this.recording = null;
    await artifact?.dispose().catch(() => undefined);
    if (generation === this.generation)
      this.publish({
        status: this.state.index ? "ready" : "idle",
        progress: null,
        issue: null,
      });
  }
  cancel() {
    this.controller.abort();
    this.generation++;
    this.controller = new AbortController();
    void this.artifact?.dispose().catch(() => undefined);
    this.artifact = null;
    this.delivery = null;
    this.recording = null;
    this.pending = null;
    this.publish({
      status: this.state.index ? "ready" : "idle",
      progress: null,
      issue: null,
    });
  }
  async forgetHistory() {
    if (
      !this.state.account ||
      ["scanning", "exporting", "awaiting_confirmation"].includes(
        this.state.status,
      )
    )
      return;
    const generation = this.generation;
    try {
      const key =
        this.accountKey ??
        (await this.dependencies.digest(
          `account-v1:${this.state.account.trim().toLowerCase()}`,
        ));
      this.assert(generation);
      await this.dependencies.history.clear(key);
      this.assert(generation);
      this.history = {};
      this.publish({
        states: this.state.index ? this.statuses(this.state.index) : {},
        issue: null,
        savedCount: 0,
      });
    } catch {
      if (generation === this.generation)
        this.publish({ issue: new DocumentError("history").message });
    }
  }
}
export const documentDownloadable = (
  document: SchoolDocument,
  state: DocumentState,
) => isMissingDocumentStatus(state.states[document.id]);

export const isMissingDocumentStatus = (status: DocumentStatus | undefined) =>
  status !== "downloaded" && status !== "unversioned";
