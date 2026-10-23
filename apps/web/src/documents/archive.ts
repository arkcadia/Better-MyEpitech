import {
  DocumentError,
  type ArchiveFactory,
} from "../../../../src/domain/documents";

type FileWritable = {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};
type PickerWindow = Window & {
  showSaveFilePicker?: (
    options: unknown,
  ) => Promise<{ createWritable(): Promise<FileWritable> }>;
};
const FALLBACK_LIMIT = 32 * 1024 * 1024;
export const createBrowserArchive =
  (usePicker = true): ArchiveFactory =>
  async () => {
    const filename = `epitech-documents-${new Date().toISOString().slice(0, 10)}.zip`;
    const picker = usePicker
      ? (window as PickerWindow).showSaveFilePicker
      : undefined;
    if (picker) {
      let output: FileWritable;
      try {
        const handle = await picker.call(window, {
          suggestedName: filename,
          types: [
            {
              description: "ZIP archive",
              accept: { "application/zip": [".zip"] },
            },
          ],
        });
        output = await handle.createWritable();
      } catch {
        throw new DocumentError("cancelled");
      }
      return {
        write: (chunk) => output.write(chunk),
        async finish() {
          await output.close();
          return { confirmed: true, async dispose() {} };
        },
        async abort() {
          await output.abort();
        },
      };
    }
    let chunks: Uint8Array<ArrayBuffer>[] = [];
    let bytes = 0;
    let url: string | null = null;
    return {
      async write(chunk) {
        bytes += chunk.byteLength;
        if (bytes > FALLBACK_LIMIT) throw new DocumentError("limit");
        chunks.push(new Uint8Array(chunk));
      },
      async finish() {
        const blob = new Blob(chunks, { type: "application/zip" });
        chunks = [];
        url = URL.createObjectURL(blob);
        return {
          confirmed: false,
          downloadLink: { href: url, filename },
          async save() {
            if (!url) throw new DocumentError("storage");
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
          },
          async dispose() {
            if (url) URL.revokeObjectURL(url);
            url = null;
            chunks = [];
          },
        };
      },
      async abort() {
        if (url) URL.revokeObjectURL(url);
        url = null;
        chunks = [];
      },
    };
  };

export const browserArchive = createBrowserArchive();
export const browserDownloadArchive = createBrowserArchive(false);
