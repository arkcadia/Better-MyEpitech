import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DocumentManager } from "../src/application/documentManager";
import type { SchoolDocument } from "../src/domain/documents";
import { createBrowserArchive } from "../apps/web/src/documents/archive";

const document: SchoolDocument = {
  id: "fictional-pdf",
  name: "sample.pdf",
  source: "personal",
  context: "Fictional course",
  sourceUrl: "https://my.epitech.eu/dashboard",
  mimeType: "application/pdf",
  size: 3,
  revision: "v1",
  reference: { kind: "url", path: "/students/documents/1/download" },
};
function setup() {
  const history = {
    read: vi.fn(async () => ({})),
    commit: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };
  const open = vi.fn(async () =>
    (async function* () {
      yield new Uint8Array([1, 2, 3]);
    })(),
  );
  const manager = new DocumentManager({
    digest: async (value) => createHash("sha256").update(value).digest("hex"),
    collect: async () => ({ documents: [document], coverage: [], collectedAt: "2026-10-23" }),
    history,
    reader: { open },
  });
  manager.setAccount("fictional@example.test");
  return { manager, history, open };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browser ZIP delivery boundary (simulated browser APIs)", () => {
  it("keeps history untouched when the save picker is cancelled before any file transfer", async () => {
    vi.stubGlobal("window", {
      showSaveFilePicker: vi.fn(async () => { throw new Error("Cancelled"); }),
    });
    const { manager, history, open } = setup();
    await manager.scan();
    await manager.download([document.id], true, createBrowserArchive());
    expect(manager.getSnapshot()).toMatchObject({ status: "ready", states: { [document.id]: "new" } });
    expect(history.commit).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it("invalidates a ZIP when closing the chosen file fails after all bytes have been written", async () => {
    const output = {
      write: vi.fn(async () => undefined),
      close: vi.fn(async () => { throw new Error("Disk full"); }),
      abort: vi.fn(async () => undefined),
    };
    vi.stubGlobal("window", {
      showSaveFilePicker: async () => ({ createWritable: async () => output }),
    });
    const { manager, history } = setup();
    await manager.scan();
    await manager.download([document.id], true, createBrowserArchive());
    expect(output.write).toHaveBeenCalled();
    expect(output.abort).toHaveBeenCalledOnce();
    expect(history.commit).not.toHaveBeenCalled();
    expect(manager.getSnapshot()).toMatchObject({ status: "ready", states: { [document.id]: "new" } });
  });
  it("records a streamed save only after the browser writable close completes", async () => {
    let finish!: () => void;
    const closing = new Promise<void>((resolve) => { finish = resolve; });
    const output = {
      write: vi.fn(async () => undefined),
      close: vi.fn(() => closing),
      abort: vi.fn(async () => undefined),
    };
    vi.stubGlobal("window", {
      showSaveFilePicker: async () => ({ createWritable: async () => output }),
    });
    const { manager, history } = setup();
    await manager.scan();
    const saving = manager.download([document.id], true, createBrowserArchive());
    await vi.waitFor(() => expect(output.close).toHaveBeenCalledOnce());
    expect(history.commit).not.toHaveBeenCalled();
    finish();
    await saving;
    expect(history.commit).toHaveBeenCalledOnce();
    expect(manager.getSnapshot().states[document.id]).toBe("downloaded");
  });
  it("bounds the standard-download fallback and releases its object URL on discard", async () => {
    vi.stubGlobal("window", {});
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fictional");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { manager, history } = setup();
    await manager.scan();
    await manager.download([document.id], true, createBrowserArchive(false));
    expect(create).toHaveBeenCalledOnce();
    expect(manager.getDownloadLink()?.href).toBe("blob:fictional");
    expect(history.commit).not.toHaveBeenCalled();
    await manager.discardZip();
    expect(revoke).toHaveBeenCalledWith("blob:fictional");
    expect(manager.getDownloadLink()).toBeNull();
    const sink = await createBrowserArchive(false)();
    await expect(sink.write(new Uint8Array(32 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: "limit" });
    await sink.abort();
    expect(create).toHaveBeenCalledOnce();
  });
});
