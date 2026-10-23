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
let previousAccount: string | null = null;
session.subscribe(() => {
  const account = session.getSnapshot().student?.login ?? null;
  if (account !== previousAccount) {
    previousAccount = account;
    data.setAccount(account);
  }
});
export const runtime = { configuration, session, data, signIn };
