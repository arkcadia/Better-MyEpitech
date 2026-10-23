export type WebLoginConfig = {
  clientId: string;
  tenantId: string;
  redirectUri: string;
};
export type LoginConfiguration =
  { ready: true; value: WebLoginConfig } | { ready: false; message: string };
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loginConfiguration(
  env: Record<string, unknown>,
  origin: string,
): LoginConfiguration {
  const blocked = (message: string): LoginConfiguration => ({
    ready: false,
    message,
  });
  if (env.VITE_EXPERIMENTAL_SCHOOL_LOGIN !== "true") {
    return blocked(
      "Web school sign-in needs an app-owned Microsoft registration and a live validation. You can explore the preview now.",
    );
  }
  const clientId = env.VITE_MICROSOFT_CLIENT_ID;
  const tenantId = env.VITE_MICROSOFT_TENANT_ID;
  if (
    typeof clientId !== "string" ||
    !guid.test(clientId) ||
    typeof tenantId !== "string" ||
    !guid.test(tenantId)
  ) {
    return blocked(
      "Microsoft client and tenant IDs are missing or invalid. Follow the web setup guide.",
    );
  }
  try {
    const redirect = new URL(String(env.VITE_MICROSOFT_REDIRECT_URI));
    const local =
      redirect.hostname === "localhost" || redirect.hostname === "127.0.0.1";
    if (
      redirect.origin !== origin ||
      redirect.pathname !== "/redirect.html" ||
      redirect.search ||
      redirect.hash ||
      redirect.username ||
      redirect.password ||
      !(
        redirect.protocol === "https:" ||
        (redirect.protocol === "http:" && local)
      )
    )
      throw new Error();
    return {
      ready: true,
      value: { clientId, tenantId, redirectUri: redirect.href },
    };
  } catch {
    return blocked(
      "The registered redirect must match this app’s origin and end in /redirect.html. Use HTTPS outside localhost.",
    );
  }
}
