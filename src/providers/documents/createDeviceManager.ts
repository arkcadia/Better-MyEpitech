import { clearOrphanDocumentZips } from "./deviceArchive";
import * as Crypto from "expo-crypto";
import { fetch as expoFetch } from "expo/fetch";
import { DocumentManager } from "../../application/documentManager";
import type { SessionManager } from "../../application/sessionManager";
import { HttpEpitechDocuments } from "../epitech/documents";
import { DeviceDownloadHistory } from "../../storage/documentDownloadHistory";
import { downloadHosts, SchoolDocumentReader } from "./reader";

export function createDeviceDocumentManager(session: SessionManager) {
  try {
    clearOrphanDocumentZips();
  } catch {
    /* Later ZIP creation reports storage failures safely. */
  }
  const read = (path: string, signal: AbortSignal) =>
    session.readSchool(path, signal);
  return new DocumentManager({
    collect: (login, signal) =>
      new HttpEpitechDocuments(read, login).collect(signal),
    history: new DeviceDownloadHistory(),
    digest: (value) =>
      Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
    reader: new SchoolDocumentReader({
      read,
      readFile: (path, signal) => session.readSchoolFile(path, signal),
      fetch: expoFetch as typeof fetch,
      allowedHosts: () => downloadHosts(
        process.env.EXPO_PUBLIC_DOCUMENT_DOWNLOAD_HOSTS,
      ),
    }),
  });
}
