import { DocumentManager } from "../../../src/application/documentManager";
import { HttpEpitechDocuments } from "../../../src/providers/epitech/documents";
import {
  downloadHosts,
  SchoolDocumentReader,
} from "../../../src/providers/documents/reader";
import { BrowserDownloadHistory } from "./documents/history";
import { SessionManager } from "../../../src/application/sessionManager";
import { StudentDataManager } from "../../../src/application/studentDataManager";
import { HttpEpitechAuthApi } from "../../../src/providers/epitech/api";
import { HttpEpitechStudentDataApi } from "../../../src/providers/epitech/studentData";
import { loginConfiguration } from "./auth/config";
import { MemorySessionVault } from "./auth/memoryVault";
import { exchangeMicrosoftToken } from "./auth/exchange";
import { createMicrosoftSignIn } from "./auth/microsoft";
import { WebSignIn } from "./auth/signIn";

const configuration = loginConfiguration(
  import.meta.env,
  window.location.origin,
);
// Native fetch behavior stays unchanged; browser-authenticated requests explicitly bypass HTTP caches.
const api = new HttpEpitechAuthApi((url, init) =>
  fetch(url, { ...init, cache: "no-store" }),
);
const session = new SessionManager(api, new MemorySessionVault());
const data = new StudentDataManager(
  new HttpEpitechStudentDataApi((path, signal) =>
    session.readSchool(path, signal),
  ),
);
const signIn = configuration.ready
  ? new WebSignIn(
      createMicrosoftSignIn(configuration.value),
      session,
      exchangeMicrosoftToken,
    )
  : null;
const digest = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
const read = (path: string, signal: AbortSignal) =>
  session.readSchool(path, signal);
const documents = new DocumentManager({
  collect: (login, signal) =>
    new HttpEpitechDocuments(read, login).collect(signal),
  history: new BrowserDownloadHistory(),
  digest,
  reader: new SchoolDocumentReader({
    read,
    readFile: (path, signal) => session.readSchoolFile(path, signal),
    fetch,
    allowedHosts: () => downloadHosts(import.meta.env.VITE_DOCUMENT_DOWNLOAD_HOSTS),
  }),
});
let previousAccount: string | null = null;
session.subscribe(() => {
  const account = session.getSnapshot().student?.login ?? null;
  if (account !== previousAccount) {
    previousAccount = account;
    data.setAccount(account);
    documents.setAccount(account);
  }
});
export const runtime = { configuration, session, data, signIn, documents };
