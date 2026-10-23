import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { AuthError } from "../src/domain/auth";
import {
  DocumentError,
  type ArchiveSink,
  type DocumentIndex,
  type DownloadHistory,
  type DownloadRecords,
  type SchoolDocument,
} from "../src/domain/documents";
import { DocumentManager } from "../src/application/documentManager";
import { writeDocumentZip } from "../src/application/documentZip";
import {
  archivePath,
  fileCategory,
  fileExtension,
  safeArchiveComponent,
} from "../src/application/documentFiles";
import { HttpEpitechDocuments } from "../src/providers/epitech/documents";
import {
  approvedDownloadUrl,
  downloadHosts,
  SchoolDocumentReader,
} from "../src/providers/documents/reader";
import { schoolReadPath } from "../src/providers/epitech/api";
import { schoolBinaryPath } from "../src/providers/epitech/documentPaths";

const digest = async (value: string) =>
  createHash("sha256").update(value).digest("hex");
const signal = () => new AbortController().signal;
const encoder = new TextEncoder();
const document = (
  id = "one",
  revision: string | null = "version-1",
): SchoolDocument => ({
  id,
  name: "brief.pdf",
  source: "personal",
  context: "Course",
  sourceUrl: "https://my.epitech.eu/dashboard",
  mimeType: "application/pdf",
  size: null,
  revision,
  reference: { kind: "url", path: "/students/documents/1/download" },
});
const index = (documents: SchoolDocument[]): DocumentIndex => ({
  documents,
  coverage: [],
  collectedAt: "2026-10-23T12:00:00Z",
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const memorySink = (confirmed = true) => {
  const chunks: Uint8Array[] = [];
  const artifact = {
    confirmed,
    dispose: vi.fn(async (): Promise<void> => undefined),
    save: vi.fn(async () => undefined),
  };
  const sink: ArchiveSink = {
    write: vi.fn(async (bytes) => {
      chunks.push(new Uint8Array(bytes));
    }),
    finish: vi.fn(async () => artifact),
    abort: vi.fn(async () => undefined),
  };
  return {
    sink,
    artifact,
    bytes: () => {
      const result = new Uint8Array(
        chunks.reduce((sum, chunk) => sum + chunk.length, 0),
      );
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    },
  };
};
const page = (
  data: unknown[],
  current = 1,
  total = data.length,
  hasNext = false,
) => ({
  data,
  meta: {
    page: current,
    limit: 50,
    total,
    pages: hasNext ? 2 : current,
    hasNext,
  },
});
function registryRead() {
  return vi.fn(async (path: string): Promise<unknown> => {
    const url = new URL(path, "https://my.epitech.eu");
    if (url.pathname === "/students/documents")
      return [
        {
          id: 1,
          studentLogin: "student@example.test",
          fileName: "transcript.pdf",
          visibleToStudent: true,
          updatedAt: "2026-10-22T12:00:00Z",
          fileSize: 20,
        },
        {
          id: 2,
          studentLogin: "student@example.test",
          fileName: "hidden.pdf",
          visibleToStudent: false,
        },
      ];
    if (url.pathname === "/students/follow-ups")
      return [
        {
          id: 3,
          studentLogin: "student@example.test",
          visibleToStudent: true,
          attachmentFileName: "followup.docx",
          updatedAt: "2026-10-22T12:00:00Z",
        },
      ];
    if (url.pathname === "/units/instances/school-years") return [2025, 2026];
    if (url.pathname === "/units/instances/projects")
      return page([
        { id: Number(url.searchParams.get("schoolYear")), name: "Project" },
      ]);
    if (url.pathname.includes("related-resources/files"))
      return [
        {
          id: Number(url.pathname.split("/")[4]),
          kind: "folder",
          name: "nested",
          childrens: [
            {
              id: Number(url.pathname.split("/")[4]) + 10000,
              kind: "file",
              name: "exercise.bin",
              updatedAt: "2026-10-23T12:00:00Z",
              blob: { id: 70, mimeType: "application/octet-stream" },
            },
          ],
        },
      ];
    if (url.pathname === "/units/instances") {
      const year = Number(url.searchParams.get("schoolYear"));
      return page([
        {
          id: year,
          schoolYear: year,
          unitCode: "B-CODE",
          code: "PAR-1",
          projectInstances: [],
          activityInstances: [{ id: year + 1, name: "Workshop" }],
        },
      ]);
    }
    if (url.pathname.endsWith("/files/students"))
      return [
        {
          id: Number(url.pathname.split("/")[6]),
          kind: "file",
          name: "starter.c",
          updatedAt: "2026-10-23T12:00:00Z",
        },
      ];
    if (url.pathname === "/e-learning/overview")
      return [{ id: 1, modules: [{ id: 10 }] }];
    if (url.pathname === "/e-learning/modules/10")
      return {
        id: 10,
        title: "Course",
        chapters: [
          { id: 100, title: "Lesson", contentType: "pdf", hasDocument: true },
          { id: 101, title: "Notes", contentType: "markdown" },
          {
            id: 102,
            title: "Video",
            contentType: "video",
            subtitleLanguages: ["en"],
          },
        ],
      };
    throw new Error("Unexpected fixture route");
  });
}
describe("student document source registry", () => {
  it("discovers personal/admin, historical projects, nested resources, activities, e-learning and own follow-up attachments without downloading bytes", async () => {
    const read = registryRead();
    const result = await new HttpEpitechDocuments(
      read,
      "student@example.test",
    ).collect(signal());
    expect(result.documents).toHaveLength(9);
    expect(new Set(result.documents.map((doc) => doc.source))).toEqual(
      new Set(["personal", "projects", "activities", "elearning", "followups"]),
    );
    expect(result.documents.some((doc) => doc.name === "hidden.pdf")).toBe(
      false,
    );
    expect(
      result.documents
        .filter((doc) => doc.source === "projects")
        .every((doc) => doc.reference.path.includes("/nested/exercise.bin")),
    ).toBe(true);
    expect(
      result.documents.find((doc) => doc.id === "chapter:100")?.revision,
    ).toBeNull();
    expect(
      result.coverage.find((row) => row.source === "external"),
    ).toMatchObject({ status: "link_only", count: 1 });
    expect(
      read.mock.calls.some(([path]) =>
        /download$|\/url$|\/content$|\/attachment$/.test(path),
      ),
    ).toBe(false);
    expect(
      result.coverage
        .filter((row) => row.source !== "external")
        .every((row) => row.status === "collected"),
    ).toBe(true);
  });
  it("follows source pagination and detects servers that ignore the page parameter", async () => {
    const base = registryRead();
    const read = vi.fn(async (path: string) => {
      if (path.startsWith("/units/instances/projects?"))
        return page([{ id: 1 }], 1, 2, true);
      return base(path);
    });
    const result = await new HttpEpitechDocuments(
      read,
      "student@example.test",
    ).collect(signal());
    expect(
      result.coverage.find((row) => row.source === "projects")?.status,
    ).toBe("partial");
    expect(
      read.mock.calls.filter(([path]) => path.includes("projects?")),
    ).toHaveLength(4);
  });
  it("reports incomplete folder expansion and unavailable sources rather than claiming full coverage", async () => {
    const base = registryRead();
    const result = await new HttpEpitechDocuments(async (path) => {
      if (path.includes("related-resources/files"))
        return [{ id: 1, kind: "folder", name: "unexpanded" }];
      if (path === "/students/follow-ups") throw new AuthError("forbidden");
      return base(path);
    }, "student@example.test").collect(signal());
    expect(
      result.coverage.find((row) => row.source === "projects")?.status,
    ).toBe("partial");
    expect(
      result.coverage.find((row) => row.source === "followups")?.status,
    ).toBe("unavailable");
  });
  it("stops on a wrong account or expired session instead of retaining partial private data", async () => {
    await expect(
      new HttpEpitechDocuments(
        async () => [
          {
            id: 1,
            fileName: "private.pdf",
            visibleToStudent: true,
            studentLogin: "other@example.test",
          },
        ],
        "student@example.test",
      ).collect(signal()),
    ).rejects.toMatchObject({ code: "identity_mismatch" });
    await expect(
      new HttpEpitechDocuments(async () => {
        throw new AuthError("unauthorized");
      }, "student@example.test").collect(signal()),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });
});
describe("document read boundaries", () => {
  it("allows observed student reads while rejecting staff scopes, traversal, alternate origins and writes disguised as reads", () => {
    expect(schoolReadPath("/students/documents/1/download")).toBe(
      "/students/documents/1/download",
    );
    expect(
      schoolReadPath(
        "/units/2026/B-CODE/PAR-1/activities/3/files/students/folder/brief.pdf",
      ),
    ).toContain("/students/");
    for (const path of [
      "/units/2026/B-CODE/PAR-1/activities/3/files/staffs",
      "/students/other/documents",
      "/students/documents?login=other",
      "/units/instances/projects/1/related-resources/files/%2e%2e/secrets",
      "/units/instances/projects/1/related-resources/files/a%2fb",
      "https://evil.test/files",
    ])
      expect(() => schoolReadPath(path)).toThrow();
    expect(schoolBinaryPath("/students/follow-ups/1/attachment")).toContain(
      "/attachment",
    );
    expect(() =>
      schoolBinaryPath("/students/other/follow-ups/1/attachment"),
    ).toThrow();
  });
  it("never sends a bearer or cookies to object storage and renews an expired signed URL only once", async () => {
    const read = vi.fn(async () => ({
      url: `https://files.example.test/doc?signature=${read.mock.calls.length}`,
    }));
    const transport = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        transport.mock.calls.length === 1
          ? new Response(null, { status: 403 })
          : new Response(new Uint8Array([1, 2, 3])),
    );
    const reader = new SchoolDocumentReader({
      read,
      readFile: vi.fn(),
      fetch: transport,
      allowedHosts: ["files.example.test"],
    });
    const chunks = [];
    for await (const chunk of await reader.open(document(), signal()))
      chunks.push(...chunk);
    expect(chunks).toEqual([1, 2, 3]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0]![1]).toMatchObject({
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "*/*" },
    });
  });
  it.each([
    "http://files.example.test/a",
    "https://files.example.test.evil.test/a",
    "https://user@files.example.test/a",
    "https://127.0.0.1/a",
    "https://files.example.test:444/a",
  ])("rejects an unapproved destination %s", (url) => {
    expect(() => approvedDownloadUrl(url, ["files.example.test"])).toThrow();
  });
  it("fails before fetching from an unknown file host", async () => {
    const transport = vi.fn();
    const reader = new SchoolDocumentReader({
      read: async () => ({ url: "https://unknown.test/private" }),
      readFile: vi.fn(),
      fetch: transport,
      allowedHosts: downloadHosts(""),
    });
    await expect(reader.open(document(), signal())).rejects.toMatchObject({
      code: "host",
    });
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects truncated bytes and a login page returned as a PDF", async () => {
    const reader = new SchoolDocumentReader({
      read: async () => "https://files.example.test/a",
      readFile: vi.fn(),
      fetch: async () => new Response(new Uint8Array([1])),
      allowedHosts: ["files.example.test"],
    });
    const consume = async () => {
      for await (const _chunk of await reader.open(
        { ...document(), size: 2 },
        signal(),
      )) {
        /* consume */
      }
    };
    await expect(consume()).rejects.toMatchObject({ code: "transfer" });
    const html = new SchoolDocumentReader({
      read: async () => "https://files.example.test/a",
      readFile: vi.fn(),
      fetch: async () =>
        new Response("<html>login</html>", {
          headers: { "content-type": "text/html" },
        }),
      allowedHosts: ["files.example.test"],
    });
    await expect(html.open(document(), signal())).rejects.toMatchObject({
      code: "transfer",
    });
  });
});
describe("ZIP archive integrity and streaming", () => {
  it("produces a readable ZIP with original binary bytes and collision-safe extension folders", async () => {
    const sink = memorySink();
    const docs = [
      document("a"),
      document("b"),
      {
        ...document("c"),
        name: "../CON.bin",
        mimeType: "application/octet-stream",
      },
    ];
    await writeDocumentZip(docs, {
      sink: sink.sink,
      reader: {
        open: async () =>
          (async function* () {
            yield new Uint8Array([0, 255]);
            yield new Uint8Array([17]);
          })(),
      },
      digest,
      signal: signal(),
      progress: vi.fn(),
    });
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files)).toHaveLength(3);
    expect(
      Object.keys(files).filter((name) => name.startsWith("pdf/pdf/")),
    ).toHaveLength(2);
    expect(
      Object.keys(files).some((name) => name.startsWith("binaries/bin/")),
    ).toBe(true);
    for (const [name, bytes] of Object.entries(files)) {
      expect(name.split("/")).not.toContain("..");
      expect([...bytes]).toEqual([0, 255, 17]);
    }
  });
  it("aborts the whole artifact on a mid-file failure, never finishing a partial ZIP", async () => {
    const sink = memorySink();
    await expect(
      writeDocumentZip([document()], {
        sink: sink.sink,
        reader: {
          open: async () =>
            (async function* () {
              yield encoder.encode("partial");
              throw new DocumentError("transfer");
            })(),
        },
        digest,
        signal: signal(),
        progress: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "transfer" });
    expect(sink.sink.finish).not.toHaveBeenCalled();
    expect(sink.sink.abort).toHaveBeenCalledOnce();
  });
  it("keeps sink writes serialized and waits for backpressure", async () => {
    const sink = memorySink();
    let active = 0;
    let max = 0;
    sink.sink.write = async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    };
    await writeDocumentZip([document()], {
      sink: sink.sink,
      reader: {
        open: async () =>
          (async function* () {
            for (let i = 0; i < 5; i++) yield new Uint8Array([i]);
          })(),
      },
      digest,
      signal: signal(),
      progress: vi.fn(),
    });
    expect(max).toBe(1);
  });
  it("sorts executable extensions without executing them and sanitizes reserved paths", () => {
    expect(fileCategory({ name: "tool.exe", mimeType: null })).toBe("binaries");
    expect(fileExtension("A.TAR.GZ")).toBe("tar.gz");
    expect(safeArchiveComponent("CON")).toBe("_CON");
    expect(safeArchiveComponent("../../file")).not.toContain("/");
    expect(archivePath(document(), "abc")).toContain("brief--abc.pdf");
  });
});
function managerSetup(confirmed = true) {
  let records: DownloadRecords = {};
  let current = index([document()]);
  const history: DownloadHistory = {
    read: vi.fn(async () => ({ ...records })),
    commit: vi.fn(async (_account, next) => {
      records = { ...records, ...next };
    }),
    clear: vi.fn(async () => {
      records = {};
    }),
  };
  const open = vi.fn(async (_doc: SchoolDocument) =>
    (async function* () {
      yield new Uint8Array([42]);
    })(),
  );
  const manager = new DocumentManager({
    history,
    digest,
    collect: async () => current,
    reader: { open },
  });
  manager.setAccount("student@example.test");
  return {
    manager,
    history,
    open,
    setIndex: (value: DocumentIndex) => {
      current = value;
    },
    factory: () => Promise.resolve(memorySink(confirmed).sink),
  };
}
describe("saved-version history and ZIP job boundaries", () => {
  it("skips known saved versions after rescanning, includes new/updated files, and permits deliberate redownload", async () => {
    const setup = managerSetup();
    await setup.manager.scan();
    await setup.manager.download(["one"], true, setup.factory);
    expect(setup.manager.getSnapshot().states.one).toBe("downloaded");
    setup.setIndex(index([document(), document("new")]));
    await setup.manager.scan();
    await setup.manager.download(["one", "new"], true, setup.factory);
    expect(setup.open.mock.calls.map(([doc]) => doc.id)).toEqual([
      "one",
      "new",
    ]);
    setup.setIndex(index([document("one", "version-2"), document("new")]));
    await setup.manager.scan();
    expect(setup.manager.getSnapshot().states.one).toBe("changed");
    await setup.manager.download(["one", "new"], true, setup.factory);
    expect(setup.open.mock.calls.map(([doc]) => doc.id)).toEqual([
      "one",
      "new",
      "one",
    ]);
    await setup.manager.download(["new"], false, setup.factory);
    expect(setup.open.mock.calls.at(-1)?.[0].id).toBe("new");
  });
  it("waits for explicit saved-file confirmation when the platform cannot prove delivery", async () => {
    const setup = managerSetup(false);
    await setup.manager.scan();
    await setup.manager.download(["one"], true, setup.factory);
    expect(setup.manager.getSnapshot().status).toBe("awaiting_confirmation");
    expect(setup.history.commit).not.toHaveBeenCalled();
    await setup.manager.discardZip();
    expect(setup.history.commit).not.toHaveBeenCalled();
    await setup.manager.download(["one"], true, setup.factory);
    await setup.manager.confirmSaved();
    expect(setup.history.commit).toHaveBeenCalledOnce();
    expect(setup.manager.getSnapshot().states.one).toBe("downloaded");
  });
  it("remembers saved unversioned IDs without claiming update detection and supports manual refresh", async () => {
    const setup = managerSetup();
    setup.setIndex(index([document("one", null)]));
    await setup.manager.scan();
    await setup.manager.download(["one"], true, setup.factory);
    expect(setup.manager.getSnapshot().states.one).toBe("unversioned");
    await setup.manager.download(["one"], true, setup.factory);
    expect(setup.open).toHaveBeenCalledOnce();
    await setup.manager.download(["one"], false, setup.factory);
    expect(setup.open).toHaveBeenCalledTimes(2);
  });
  it("does not mark failed, cancelled, or account-switched exports as downloaded", async () => {
    const setup = managerSetup();
    await setup.manager.scan();
    const gate = deferred<void>();
    setup.open.mockImplementation(async () =>
      (async function* () {
        await gate.promise;
        yield new Uint8Array([1]);
      })(),
    );
    const pending = setup.manager.download(["one"], true, setup.factory);
    await vi.waitFor(() => expect(setup.open).toHaveBeenCalledOnce());
    setup.manager.setAccount("other@example.test");
    gate.resolve();
    await pending;
    expect(setup.history.commit).not.toHaveBeenCalled();
    expect(setup.manager.getSnapshot()).toMatchObject({
      account: "other@example.test",
      index: null,
    });
  });
  it("never persists names, URLs or tokens in history and resets it only on explicit request", async () => {
    const setup = managerSetup();
    await setup.manager.scan();
    await setup.manager.download(["one"], true, setup.factory);
    const [account, records] = vi.mocked(setup.history.commit).mock.calls[0]!;
    expect(account).toMatch(/^[0-9a-f]{64}$/);
    for (const [id, revision] of Object.entries(records)) {
      expect(id).toMatch(/^[0-9a-f]{64}$/);
      expect(revision).toMatch(/^[0-9a-f]{64}$/);
    }
    setup.manager.setAccount(null);
    expect(setup.history.clear).not.toHaveBeenCalled();
    setup.manager.setAccount("student@example.test");
    await setup.manager.scan();
    expect(setup.manager.getSnapshot().states.one).toBe("downloaded");
    await setup.manager.forgetHistory();
    expect(setup.manager.getSnapshot().states.one).toBe("new");
  });
  it("does not silently overwrite unreadable history", async () => {
    const setup = managerSetup();
    vi.mocked(setup.history.read).mockRejectedValue(
      new DocumentError("history"),
    );
    await setup.manager.scan();
    expect(setup.manager.getSnapshot().status).toBe("error");
    expect(setup.history.commit).not.toHaveBeenCalled();
  });
});
it("records a completed native directory copy, while a share-sheet completion still requires explicit saved confirmation", async () => {
  const setup = managerSetup(false);
  await setup.manager.scan();
  const target = memorySink(false);
  await setup.manager.download(["one"], true, async () => target.sink);
  target.artifact.save.mockImplementation(async () => {
    target.artifact.confirmed = true;
  });
  await setup.manager.saveZip();
  expect(setup.history.commit).toHaveBeenCalledOnce();
  expect(setup.manager.getSnapshot().states.one).toBe("downloaded");
  const shared = managerSetup(false);
  await shared.manager.scan();
  const artifact = memorySink(false);
  const share = vi.fn(async () => undefined);
  artifact.sink.finish = async () => ({ ...artifact.artifact, share });
  await shared.manager.download(["one"], true, async () => artifact.sink);
  await shared.manager.shareZip();
  expect(share).toHaveBeenCalledOnce();
  expect(shared.history.commit).not.toHaveBeenCalled();
  expect(shared.manager.getSnapshot().status).toBe("awaiting_confirmation");
});
it("invalidates a pending share completion when its ZIP is discarded before a new export", async () => {
  const setup = managerSetup(false);
  await setup.manager.scan();
  const target = memorySink(false);
  const sharing = deferred<void>();
  target.sink.finish = async () => ({
    ...target.artifact,
    share: () => sharing.promise,
  });
  await setup.manager.download(["one"], true, async () => target.sink);
  const result = setup.manager.shareZip();
  await setup.manager.discardZip();
  await setup.manager.download(["one"], true, setup.factory);
  sharing.resolve();
  expect(await result).toBe(false);
  expect(setup.history.commit).not.toHaveBeenCalled();
  expect(setup.manager.getSnapshot().status).toBe("awaiting_confirmation");
});
it("preserves a new account's ZIP when the old saved archive finishes cleanup late", async () => {
  const setup = managerSetup(false);
  await setup.manager.scan();
  const old = memorySink(false);
  const cleanup = deferred<void>();
  old.artifact.dispose.mockImplementation(() => cleanup.promise);
  await setup.manager.download(["one"], true, async () => old.sink);
  const saving = setup.manager.confirmSaved();
  await vi.waitFor(() => expect(old.artifact.dispose).toHaveBeenCalledOnce());

  setup.manager.setAccount("other@example.test");
  setup.setIndex(index([document("other")]));
  await setup.manager.scan();
  const next = memorySink(false);
  await setup.manager.download(["other"], true, async () => next.sink);
  cleanup.resolve();
  await saving;

  expect(setup.manager.getSnapshot()).toMatchObject({
    account: "other@example.test",
    status: "awaiting_confirmation",
    savedCount: 0,
    states: { other: "new" },
  });
  expect(await setup.manager.saveZip()).toBe(true);
  expect(next.artifact.save).toHaveBeenCalledOnce();
  expect(next.artifact.dispose).not.toHaveBeenCalled();
});
it("records one confirmation at a time and permits retry after a history write fails", async () => {
  const setup = managerSetup(false);
  await setup.manager.scan();
  await setup.manager.download(["one"], true, setup.factory);
  const commit = deferred<void>();
  vi.mocked(setup.history.commit).mockImplementationOnce(() => commit.promise);
  const first = setup.manager.confirmSaved();
  await setup.manager.confirmSaved();
  expect(setup.history.commit).toHaveBeenCalledOnce();
  commit.resolve();
  await first;
  expect(setup.manager.getSnapshot().states.one).toBe("downloaded");

  await setup.manager.download(["one"], false, setup.factory);
  vi.mocked(setup.history.commit).mockRejectedValueOnce(new DocumentError("history"));
  await setup.manager.confirmSaved();
  expect(setup.manager.getSnapshot()).toMatchObject({ status: "awaiting_confirmation" });
  await setup.manager.confirmSaved();
  expect(setup.manager.getSnapshot()).toMatchObject({ status: "ready", savedCount: 1 });
});
