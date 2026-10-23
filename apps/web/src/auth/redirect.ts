import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";
// This entry must stay separate from the app, with no routing, analytics or COOP header.
void broadcastResponseToMainFrame().catch(() => {
  const status = document.getElementById("status");
  if (status)
    status.textContent =
      "Sign-in could not return to the app. Close this window and try again.";
});
