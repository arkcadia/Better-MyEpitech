import {
  AuthError,
  isRecord,
  isToken,
  type Credentials,
} from "../../../../src/domain/auth";
import {
  EPITECH_API,
  type Fetcher,
} from "../../../../src/providers/epitech/api";

/** Observed portal exchange, NOT proof that Epitech accepts an independent app's audience. */
export async function exchangeMicrosoftToken(
  idToken: string,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<Credentials> {
  if (!isToken(idToken)) throw new AuthError("contract");
  if (signal.aborted) throw new AuthError("cancelled");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 20_000);
  try {
    const url = `${EPITECH_API}/auth/token`;
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    if (signal.aborted) throw new AuthError("cancelled");
    if (controller.signal.aborted) throw new AuthError("timeout");
    if (response.url && response.url !== url) throw new AuthError("contract");
    if (response.status === 401) throw new AuthError("unauthorized");
    if (response.status === 403) throw new AuthError("forbidden");
    if (response.status === 429 || response.status >= 500)
      throw new AuthError("server");
    if (!response.ok) throw new AuthError("contract");
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new AuthError("contract");
    }
    if (
      !isRecord(value) ||
      !isToken(value.access_token) ||
      !isToken(value.refresh_token)
    )
      throw new AuthError("contract");
    return {
      accessToken: value.access_token,
      refreshToken: value.refresh_token,
    };
  } catch (error) {
    if (signal.aborted) throw new AuthError("cancelled");
    if (controller.signal.aborted) throw new AuthError("timeout");
    throw error instanceof AuthError ? error : new AuthError("network");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
