import { indexedDB } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import { BrowserDownloadHistory } from "../apps/web/src/documents/history";

vi.stubGlobal("indexedDB", indexedDB);
const account = "a".repeat(64);
const one = "b".repeat(64);
const two = "c".repeat(64);
it("retains metadata across adapter instances, merges concurrent tabs atomically, and isolates accounts", async () => {
  const tabOne = new BrowserDownloadHistory();
  const tabTwo = new BrowserDownloadHistory();
  await tabOne.clear(account);
  await Promise.all([
    tabOne.commit(account, { [one]: "d".repeat(64) }),
    tabTwo.commit(account, { [two]: "e".repeat(64) }),
  ]);
  expect(await new BrowserDownloadHistory().read(account)).toEqual({
    [one]: "d".repeat(64),
    [two]: "e".repeat(64),
  });
  expect(await tabOne.read("f".repeat(64))).toEqual({});
  await tabOne.clear(account);
  expect(await tabTwo.read(account)).toEqual({});
});
it("rejects plaintext/private metadata rather than putting it in persistent history", async () => {
  const history = new BrowserDownloadHistory();
  await expect(
    history.commit(account, { "private-filename.pdf": "signed-url" }),
  ).rejects.toThrow();
});
