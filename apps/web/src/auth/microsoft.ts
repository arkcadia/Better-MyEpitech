import { PublicClientApplication } from "@azure/msal-browser";
import { AuthError } from "../../../../src/domain/auth";
import type { WebLoginConfig } from "./config";

export interface MicrosoftSignIn {
  signIn(): Promise<string>;
  clear(): Promise<void>;
}

export function createMicrosoftSignIn(config: WebLoginConfig): MicrosoftSignIn {
  const client = new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: config.redirectUri,
    },
    cache: { cacheLocation: "memoryStorage" },
    system: {
      loggerOptions: {
        loggerCallback: () => undefined,
        piiLoggingEnabled: false,
      },
    },
  });
  // Initialize when the runtime is created, before the student's click, to preserve popup activation.
  const initialized = client.initialize();
  void initialized.catch(() => undefined);
  return {
    async signIn() {
      try {
        await initialized;
        const result = await client.loginPopup({
          scopes: ["openid", "profile"],
          prompt: "select_account",
        });
        if (!result.idToken) throw new AuthError("contract");
        return result.idToken;
      } catch {
        throw new AuthError("unauthorized");
      } finally {
        await client.clearCache().catch(() => undefined);
      }
    },
    async clear() {
      await initialized;
      await client.clearCache();
    },
  };
}
