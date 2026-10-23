import { describe, expect, it, vi } from "vitest";
import { loginConfiguration } from "../apps/web/src/auth/config";
import { MemorySessionVault } from "../apps/web/src/auth/memoryVault";
import { exchangeMicrosoftToken } from "../apps/web/src/auth/exchange";
import { WebSignIn } from "../apps/web/src/auth/signIn";
import { formatMoment, safeSchoolLink } from "../apps/web/src/format";
import { AuthError, type Credentials } from "../src/domain/auth";

const credentials = {
  accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh",
};
const config = {
  VITE_EXPERIMENTAL_SCHOOL_LOGIN: "true",
  VITE_MICROSOFT_CLIENT_ID: "11111111-1111-1111-1111-111111111111",
  VITE_MICROSOFT_TENANT_ID: "22222222-2222-2222-2222-222222222222",
  VITE_MICROSOFT_REDIRECT_URI: "http://localhost:5173/redirect.html",
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
describe("web registration boundary", () => {
  it("stays disabled without explicit opt-in and app-owned public configuration", () => {
    expect(loginConfiguration({}, "http://localhost:5173").ready).toBe(false);
    expect(
      loginConfiguration(
        { ...config, VITE_MICROSOFT_CLIENT_ID: "" },
        "http://localhost:5173",
      ).ready,
    ).toBe(false);
    expect(loginConfiguration(config, "http://localhost:5173").ready).toBe(
      true,
    );
  });
  it.each([
    "https://my.epitech.eu/redirect.html",
    "http://localhost:5173/dashboard",
    "http://localhost:5173/redirect.html?token=bad",
    "http://localhost:5173/redirect.html#code=bad",
    "http://user@localhost:5173/redirect.html",
    "http://app.example/redirect.html",
  ])("rejects foreign or unsafe callback %s", (uri) => {
    expect(
      loginConfiguration(
        { ...config, VITE_MICROSOFT_REDIRECT_URI: uri },
        new URL(uri).origin === "http://app.example"
          ? "http://app.example"
          : "http://localhost:5173",
      ).ready,
    ).toBe(false);
  });
  it("accepts matching HTTPS deployment callbacks", () => {
    expect(
      loginConfiguration(
        {
          ...config,
          VITE_MICROSOFT_REDIRECT_URI: "https://app.example/redirect.html",
        },
        "https://app.example",
      ).ready,
    ).toBe(true);
  });
});
describe("web credential exchange", () => {
  it("uses only the fixed observed exchange with no cookies, redirects, URL token or HTTP cache", async () => {
    const transport = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: credentials.accessToken,
            refresh_token: credentials.refreshToken,
          }),
        ),
    );
    expect(
      await exchangeMicrosoftToken(
        "synthetic-id",
        new AbortController().signal,
        transport,
      ),
    ).toEqual(credentials);
    expect(transport).toHaveBeenCalledWith(
      "https://my.epitech.eu/api/auth/token",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer synthetic-id",
        },
      }),
    );
  });
  it.each([
    { access_token: "access" },
    { access_token: "a b", refresh_token: "refresh" },
    [],
    null,
  ])("rejects invalid school credentials", async (body) => {
    await expect(
      exchangeMicrosoftToken(
        "synthetic-id",
        new AbortController().signal,
        async () => new Response(JSON.stringify(body)),
      ),
    ).rejects.toMatchObject({ code: "contract" });
  });
  it("does not leak provider failures or confuse Microsoft identity with a school session", async () => {
    await expect(
      exchangeMicrosoftToken(
        "synthetic-id",
        new AbortController().signal,
        async () => {
          throw new Error("private-url?token=secret");
        },
      ),
    ).rejects.toMatchObject({ code: "network" });
    await expect(
      exchangeMicrosoftToken(
        "synthetic-id",
        new AbortController().signal,
        async () => new Response("private body", { status: 403 }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("does not accept credentials returned after cancellation", async () => {
    const wait = deferred<Response>();
    const controller = new AbortController();
    const result = exchangeMicrosoftToken(
      "synthetic-id",
      controller.signal,
      () => wait.promise,
    );
    controller.abort();
    wait.resolve(
      new Response(
        JSON.stringify({ access_token: "access", refresh_token: "refresh" }),
      ),
    );
    await expect(result).rejects.toMatchObject({ code: "cancelled" });
  });
});
describe("web sign-in cancellation and account boundaries", () => {
  const setup = () => {
    const popup = deferred<string>();
    const microsoft = {
      signIn: vi.fn(() => popup.promise),
      clear: vi.fn(async () => undefined),
    };
    const session = {
      disconnect: vi.fn(async () => undefined),
      connectFromPortal: vi.fn(async (_value: Credentials) => undefined),
    };
    const exchange = vi.fn(async () => credentials);
    return {
      popup,
      microsoft,
      session,
      exchange,
      signIn: new WebSignIn(microsoft, session, exchange),
    };
  };
  it("clears the previous student and verifies exchanged credentials through the shared session manager", async () => {
    const state = setup();
    const result = state.signIn.start();
    state.popup.resolve("synthetic-id");
    await result;
    expect(state.session.disconnect).toHaveBeenCalledOnce();
    expect(state.session.connectFromPortal).toHaveBeenCalledWith(credentials);
    expect(state.signIn.getSnapshot()).toEqual({ busy: false, issue: null });
  });
  it("ignores a popup completion after logout", async () => {
    const state = setup();
    const result = state.signIn.start();
    await state.signIn.cancel();
    state.popup.resolve("late-token");
    await result;
    expect(state.exchange).not.toHaveBeenCalled();
    expect(state.session.connectFromPortal).not.toHaveBeenCalled();
  });
  it("ignores an exchange completion after logout", async () => {
    const state = setup();
    const exchange = deferred<Credentials>();
    state.exchange.mockImplementation(() => exchange.promise);
    const result = state.signIn.start();
    state.popup.resolve("synthetic-id");
    await vi.waitFor(() => expect(state.exchange).toHaveBeenCalledOnce());
    await state.signIn.cancel();
    exchange.resolve(credentials);
    await result;
    expect(state.session.connectFromPortal).not.toHaveBeenCalled();
  });
  it("does not start concurrent popups or expose raw exception text", async () => {
    const state = setup();
    const result = state.signIn.start();
    await state.signIn.start();
    state.popup.reject(new Error("private info"));
    await result;
    expect(state.microsoft.signIn).toHaveBeenCalledOnce();
    expect(state.signIn.getSnapshot().issue).toBe(
      new AuthError("network").message,
    );
  });
});
it("browser credentials expire with the runtime rather than persisting to a new instance", async () => {
  const first = new MemorySessionVault();
  await first.write({
    version: 1,
    credentials,
    login: "synthetic@example.test",
  });
  expect((await first.read())?.credentials).toEqual(credentials);
  expect(await new MemorySessionVault().read()).toBeNull();
  await first.clear();
  expect(await first.read()).toBeNull();
});
it("preserves all-day dates and explicit campus timezones in browser formatting", () => {
  expect(formatMoment({ date: "2026-10-25" })).toContain("All day");
  expect(
    formatMoment({
      dateTime: "2026-10-25T12:00:00Z",
      timeZone: "Europe/Paris",
    }),
  ).toContain("Europe/Paris");
  expect(safeSchoolLink("https://my.epitech.eu.evil.test")).toBeNull();
  expect(safeSchoolLink("javascript:alert(1)")).toBeNull();
});
