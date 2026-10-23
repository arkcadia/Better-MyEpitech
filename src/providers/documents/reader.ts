import { strToU8 } from "fflate";
import { isRecord } from "../../domain/auth";
import {
  checkDocumentSignal,
  DocumentError,
  type DocumentReader,
  type SchoolDocument,
} from "../../domain/documents";

type Dependencies = {
  read(path: string, signal: AbortSignal): Promise<unknown>;
  readFile(path: string, signal: AbortSignal): Promise<Response>;
  fetch: typeof fetch;
  allowedHosts: readonly string[] | (() => readonly string[]);
};
export function downloadHosts(value: string | undefined): string[] {
  const hosts = [
    "my.epitech.eu",
    ...(value ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  ];
  if (
    hosts.some(
      (host) =>
        !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(host) ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".internal"),
    )
  )
    throw new DocumentError("host");
  return [...new Set(hosts)];
}
export function approvedDownloadUrl(
  value: unknown,
  allowedHosts: readonly string[],
): string {
  if (typeof value !== "string" || value.length > 16384)
    throw new DocumentError("contract");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DocumentError("contract");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !allowedHosts.includes(url.hostname)
  )
    throw new DocumentError("host");
  return url.href;
}
async function* responseChunks(
  response: Response,
  signal: AbortSignal,
  expectedSize: number | null,
): AsyncIterable<Uint8Array> {
  if (!response.ok || !response.body) throw new DocumentError("transfer");
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  let received = 0;
  try {
    for (;;) {
      checkDocumentSignal(signal);
      const result = await reader.read();
      checkDocumentSignal(signal);
      if (result.done) break;
      const chunk = result.value;
      received += chunk.byteLength;
      if (
        received > 2_000_000_000 ||
        (expectedSize !== null && received > expectedSize)
      )
        throw new DocumentError("limit");
      // Bound the input handed to ZIP writers even when a provider returns a large chunk.
      for (let offset = 0; offset < chunk.length; offset += 65536)
        yield chunk.subarray(offset, offset + 65536);
    }
    if (expectedSize !== null && received !== expectedSize)
      throw new DocumentError("transfer");
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export class SchoolDocumentReader implements DocumentReader {
  constructor(private readonly dependencies: Dependencies) {}
  async open(
    document: SchoolDocument,
    signal: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array>> {
    checkDocumentSignal(signal);
    const reference = document.reference;
    if (reference.kind === "markdown" || reference.kind === "subtitles") {
      const value = await this.dependencies.read(reference.path, signal);
      checkDocumentSignal(signal);
      let content: unknown;
      if (reference.kind === "markdown")
        content = isRecord(value) ? value.content : null;
      else if (isRecord(value) && Array.isArray(value.subtitles)) {
        const subtitle = value.subtitles.find(
          (row) => isRecord(row) && row.language === reference.language,
        );
        content = isRecord(subtitle) ? subtitle.content : null;
      }
      if (typeof content !== "string" || content.length > 4_000_000)
        throw new DocumentError("contract");
      const bytes = strToU8(content);
      return (async function* () {
        for (let offset = 0; offset < bytes.length; offset += 65536) {
          checkDocumentSignal(signal);
          yield bytes.subarray(offset, offset + 65536);
        }
      })();
    }
    if (reference.kind === "binary")
      return responseChunks(
        await this.dependencies.readFile(reference.path, signal),
        signal,
        document.size,
      );
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.dependencies.read(reference.path, signal);
      checkDocumentSignal(signal);
      const url = approvedDownloadUrl(
        typeof result === "string"
          ? result
          : isRecord(result)
            ? result.url
            : null,
        typeof this.dependencies.allowedHosts === 'function' ? this.dependencies.allowedHosts() : this.dependencies.allowedHosts,
      );
      let response: Response;
      try {
        response = await this.dependencies.fetch(url, {
          method: "GET",
          headers: { Accept: "*/*" },
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal,
        });
      } catch {
        checkDocumentSignal(signal);
        throw new DocumentError("transfer");
      }
      checkDocumentSignal(signal);
      if (attempt === 0 && [401, 403].includes(response.status)) {
        await response.body?.cancel();
        continue;
      }
      if (response.url && response.url !== url) {
        await response.body?.cancel();
        throw new DocumentError("host");
      }
      if (
        !response.ok ||
        (response.headers.get("content-type")?.includes("text/html") &&
          !/\.html?$/i.test(document.name))
      ) {
        await response.body?.cancel();
        throw new DocumentError("transfer");
      }
      return responseChunks(response, signal, document.size);
    }
    throw new DocumentError("transfer");
  }
}
