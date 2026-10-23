export type DocumentSource =
  "personal" | "projects" | "activities" | "elearning" | "followups";
export type DocumentReference =
  | { kind: "url"; path: string }
  | { kind: "binary"; path: string }
  | { kind: "markdown"; path: string }
  | { kind: "subtitles"; path: string; language: string };
export interface SchoolDocument {
  id: string;
  name: string;
  source: DocumentSource;
  context: string;
  sourceUrl: string;
  mimeType: string | null;
  size: number | null;
  /** Null means saved IDs need a visible unknown-version label and explicit refresh option. */
  revision: string | null;
  reference: DocumentReference;
}
export type DocumentCoverage = {
  source: DocumentSource | "external";
  status: "collected" | "partial" | "unavailable" | "link_only";
  count: number;
  message: string;
};
export type DocumentIndex = {
  documents: SchoolDocument[];
  coverage: DocumentCoverage[];
  collectedAt: string;
};
export interface DocumentCollector {
  collect(signal: AbortSignal): Promise<DocumentIndex>;
}
export interface DocumentReader {
  open(
    document: SchoolDocument,
    signal: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array>>;
}
export type DownloadRecords = Record<string, string>;
/** Keys are SHA-256 account/document IDs. Values are SHA-256 revisions, never URLs/tokens/names. */
export interface DownloadHistory {
  read(account: string): Promise<DownloadRecords>;
  commit(account: string, records: DownloadRecords): Promise<void>;
  clear(account: string): Promise<void>;
}
export interface SavedArchive {
  confirmed: boolean;
  downloadLink?: { href: string; filename: string };
  save?(): Promise<void>;
  share?(): Promise<void>;
  dispose(): Promise<void>;
}
export interface ArchiveSink {
  write(chunk: Uint8Array): Promise<void>;
  finish(): Promise<SavedArchive>;
  abort(): Promise<void>;
}
export type ArchiveFactory = () => Promise<ArchiveSink>;
export class DocumentError extends Error {
  constructor(
    readonly code:
      | "contract"
      | "cancelled"
      | "host"
      | "transfer"
      | "limit"
      | "history"
      | "empty"
      | "busy"
      | "storage",
  ) {
    super(
      {
        contract: "Some document information could not be read safely.",
        cancelled: "Document operation cancelled.",
        host: "This file host has not been configured for downloads. Check the document setup guide.",
        transfer:
          "A file could not be downloaded completely. No download history was updated. Refresh and retry.",
        limit:
          "This export reached its file or size limit. Select a smaller batch and retry.",
        history:
          "Download history could not be read or saved. Retry or explicitly forget it before continuing.",
        empty: "No matching new or changed documents to download.",
        busy: "A document operation is already running.",
        storage:
          "The ZIP could not be saved. Check available storage and retry.",
      }[code],
    );
    this.name = "DocumentError";
  }
}
export function checkDocumentSignal(signal: AbortSignal) {
  if (signal.aborted) throw new DocumentError("cancelled");
}
export function validateDownloadRecords(value: unknown): DownloadRecords {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 100_000
  )
    throw new DocumentError("history");
  const output: DownloadRecords = {};
  for (const [key, revision] of Object.entries(value)) {
    if (
      !/^[a-f0-9]{64}$/.test(key) ||
      typeof revision !== "string" ||
      !/^[a-f0-9]{64}$/.test(revision)
    )
      throw new DocumentError("history");
    output[key] = revision;
  }
  return output;
}
