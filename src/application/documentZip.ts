import { Zip, ZipPassThrough } from "fflate";
import { archivePath } from "./documentFiles";
import {
  checkDocumentSignal,
  DocumentError,
  type ArchiveSink,
  type DocumentReader,
  type SavedArchive,
  type SchoolDocument,
} from "../domain/documents";

/** Store-method ZIP: PDF/binaries stay byte-identical, with bounded buffers and sink backpressure. */
export async function writeDocumentZip(
  documents: readonly SchoolDocument[],
  dependencies: {
    reader: DocumentReader;
    sink: ArchiveSink;
    digest(value: string): Promise<string>;
    signal: AbortSignal;
    progress(completed: number, total: number, bytes: number): void;
  },
): Promise<SavedArchive> {
  const { reader, sink, digest, signal } = dependencies;
  let output = Promise.resolve();
  let outputError: unknown;
  let bytes = 0;
  const zip = new Zip((error, chunk) => {
    if (error) {
      outputError = new DocumentError("storage");
      return;
    }
    output = output.then(async () => {
      checkDocumentSignal(signal);
      await sink.write(chunk);
    });
    void output.catch((error) => {
      outputError = error;
    });
  });
  const drain = async () => {
    await output;
    if (outputError) throw outputError;
    checkDocumentSignal(signal);
  };
  try {
    if (!documents.length || documents.length > 20000)
      throw new DocumentError(documents.length ? "limit" : "empty");
    let completed = 0;
    for (const document of documents) {
      checkDocumentSignal(signal);
      if (document.size !== null && bytes + document.size > 2_000_000_000)
        throw new DocumentError("limit");
      const identity = await digest(document.id);
      checkDocumentSignal(signal);
      const fileController = new AbortController();
      const cancelFile = () => fileController.abort();
      signal.addEventListener("abort", cancelFile, { once: true });
      const timeout = setTimeout(cancelFile, 300_000);
      try {
        const input = await reader.open(document, fileController.signal);
        checkDocumentSignal(signal);
        const entry = new ZipPassThrough(archivePath(document, identity));
        zip.add(entry);
        await drain();
        // A partial entry invalidates the entire artifact. Never mark earlier entries as saved.
        for await (const chunk of input) {
          checkDocumentSignal(signal);
          bytes += chunk.byteLength;
          if (bytes > 2_000_000_000) throw new DocumentError("limit");
          entry.push(chunk);
          await drain();
          dependencies.progress(completed, documents.length, bytes);
        }
        entry.push(new Uint8Array(), true);
        await drain();
        completed++;
        dependencies.progress(completed, documents.length, bytes);
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", cancelFile);
        fileController.abort();
      }
    }
    zip.end();
    await drain();
    const artifact = await sink.finish();
    if (signal.aborted) {
      await artifact.dispose();
      throw new DocumentError("cancelled");
    }
    return artifact;
  } catch (error) {
    zip.terminate();
    await output.catch(() => undefined);
    await sink.abort().catch(() => undefined);
    checkDocumentSignal(signal);
    throw error instanceof DocumentError
      ? error
      : new DocumentError("transfer");
  }
}
