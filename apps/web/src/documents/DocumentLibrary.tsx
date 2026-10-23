import { isMissingDocumentStatus } from "../../../../src/application/documentManager";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { DocumentManager } from "../../../../src/application/documentManager";
import {
  fileCategory,
  fileExtension,
} from "../../../../src/application/documentFiles";
import { browserArchive, browserDownloadArchive } from "./archive";
import { addPreviewDocument } from "./preview";

const labels = {
  new: "New",
  changed: "Updated",
  downloaded: "Saved version",
  unversioned: "Saved · version unknown",
};
export function DocumentLibrary({
  manager,
  preview,
  connected,
}: {
  manager: DocumentManager;
  preview: boolean;
  connected: boolean;
}) {
  const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const [query, setQuery] = useState("");
  const [extension, setExtension] = useState("all");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState(100);
  const [saveRequested, setSaveRequested] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);
  const [standardDownload, setStandardDownload] = useState(false);
  useEffect(() => {
    if (preview) manager.setAccount("synthetic-document-preview");
    if (preview || connected) void manager.scan();
    return () => {
      manager.cancel();
      if (preview) manager.setAccount(null);
    };
  }, [manager, preview, connected]);
  useEffect(() => {
    setSelected(
      new Set(
        state.index?.documents
          .filter((doc) => isMissingDocumentStatus(state.states[doc.id]))
          .map((doc) => doc.id) ?? [],
      ),
    );
  }, [state.index, state.states]);
  useEffect(() => {
    if (state.status !== "awaiting_confirmation") setSaveRequested(false);
  }, [state.status]);
  const documents = state.index?.documents ?? [];
  const extensions = useMemo(
    () => [...new Set(documents.map((doc) => fileExtension(doc.name)))].sort(),
    [state.index],
  );
  const filtered = useMemo(
    () =>
      documents
        .filter(
          (doc) =>
            (extension === "all" || fileExtension(doc.name) === extension) &&
            (status === "all" ||
              (status === "missing"
                ? isMissingDocumentStatus(state.states[doc.id])
                : state.states[doc.id] === status)) &&
            `${doc.name} ${doc.context}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort(
          (a, b) =>
            fileExtension(a.name).localeCompare(fileExtension(b.name)) ||
            a.name.localeCompare(b.name),
        ),
    [state.index, state.states, extension, status, query],
  );
  const displayed = filtered.slice(0, visible);
  const ids = filtered
    .filter((doc) => selected.has(doc.id))
    .map((doc) => doc.id);
  const missing = ids.filter((id) => isMissingDocumentStatus(state.states[id]));
  const busy = ["scanning", "exporting", "awaiting_confirmation"].includes(
    state.status,
  );
  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section className="document-library">
      <div className="notice">
        Discover files across supported personal, project, activity, e-learning
        and follow-up sources. Coverage below shows any gaps. Download history
        is kept on this browser for this account; it cannot check whether you
        later moved or deleted a saved ZIP.
      </div>
      {preview && (
        <div className="notice preview-notice">
          Document preview ZIPs contain fictional files only.{" "}
          <button
            className="text-button"
            disabled={busy}
            onClick={addPreviewDocument}
          >
            Add a new sample document
          </button>
        </div>
      )}
      {!preview && !connected && (
        <div className="panel">
          <h2>Connect Epitech to discover your documents.</h2>
          <p>
            Use Connections to configure the experimental web sign-in, or
            explore documents in the sample workspace.
          </p>
        </div>
      )}
      {(preview || connected) && (
        <>
          <div className="section-toolbar">
            <div>
              <h2>{documents.length} discovered files</h2>
              <p className="muted">
                {
                  documents.filter((doc) =>
                    isMissingDocumentStatus(state.states[doc.id]),
                  ).length
                }{" "}
                new or updated files
              </p>
            </div>
            <div className="actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void manager.scan()}
              >
                Refresh document index
              </button>
              {["scanning", "exporting"].includes(state.status) && (
                <button className="secondary" onClick={() => manager.cancel()}>
                  Cancel
                </button>
              )}
            </div>
          </div>
          {state.issue && (
            <div className="notice error" role="alert">
              {state.issue}
            </div>
          )}
          {state.status === "scanning" && (
            <p role="status">
              Discovering accessible files and nested folders…
            </p>
          )}
          {state.progress && (
            <p role="status">
              Preparing ZIP: {state.progress.completed} / {state.progress.total}{" "}
              files · {(state.progress.bytes / 1048576).toFixed(1)} MiB
              retrieved. History stays unchanged until the ZIP is saved.
            </p>
          )}
          {state.status === "awaiting_confirmation" && (
            <div className="panel save-panel">
              <h2>Your ZIP is ready</h2>
              <p>
                Save the archive to your device, then confirm it finished. A
                browser download prompt alone cannot prove the file was saved.
              </p>
              <div className="actions">
                {manager.getDownloadLink() ? (
                  <a
                    className="primary download-link"
                    href={manager.getDownloadLink()!.href}
                    download={manager.getDownloadLink()!.filename}
                    onClick={() => setSaveRequested(true)}
                  >
                    Save ZIP to device
                  </a>
                ) : (
                  <button
                    className="primary"
                    onClick={() => {
                      setSaveRequested(true);
                      void manager.saveZip();
                    }}
                  >
                    Save ZIP to device
                  </button>
                )}
                <button
                  className="secondary"
                  disabled={!saveRequested}
                  onClick={() => void manager.confirmSaved()}
                >
                  I saved the ZIP — remember these files
                </button>
                <button
                  className="secondary"
                  onClick={() => void manager.discardZip()}
                >
                  Discard ZIP
                </button>
              </div>
            </div>
          )}
          {state.savedCount > 0 && (
            <p className="notice" role="status">
              {state.savedCount} file versions recorded as saved. The next
              missing-files ZIP will skip unchanged versions.
            </p>
          )}
          <div className="filters document-filters">
            <label className="search">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="Search documents"
                type="search"
                placeholder="Search files or folders…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setVisible(100);
                }}
              />
            </label>
            <label>
              Extension{" "}
              <select
                aria-label="Filter document extension"
                value={extension}
                onChange={(event) => {
                  setExtension(event.target.value);
                  setVisible(100);
                }}
              >
                <option value="all">All extensions</option>
                {extensions.map((ext) => (
                  <option key={ext}>{ext}</option>
                ))}
              </select>
            </label>
            <label>
              Download state{" "}
              <select
                aria-label="Filter document download state"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setVisible(100);
                }}
              >
                <option value="all">All files</option>
                <option value="missing">Missing / changed</option>
                <option value="downloaded">Saved versions</option>
                <option value="new">New files</option>
                <option value="changed">Updated files</option>
                <option value="unversioned">Saved · version unknown</option>
              </select>
            </label>
          </div>
          <div className="actions document-actions">
            <label className="checkbox">
              <input
                type="checkbox"
                disabled={busy || !filtered.length}
                aria-label="Select all filtered documents"
                checked={
                  filtered.length > 0 &&
                  filtered.every((doc) => selected.has(doc.id))
                }
                onChange={(event) =>
                  setSelected((previous) => {
                    const next = new Set(previous);
                    for (const doc of filtered) {
                      if (event.target.checked) next.add(doc.id);
                      else next.delete(doc.id);
                    }
                    return next;
                  })
                }
              />{" "}
              Select all {filtered.length} matching files
            </label>
            <button
              className="primary"
              disabled={busy || !missing.length}
              onClick={() =>
                void manager.download(
                  ids,
                  true,
                  standardDownload ? browserDownloadArchive : browserArchive,
                )
              }
            >
              ZIP missing selected ({missing.length})
            </button>
            <button
              className="secondary"
              disabled={busy || !ids.length}
              onClick={() =>
                void manager.download(
                  ids,
                  false,
                  standardDownload ? browserDownloadArchive : browserArchive,
                )
              }
            >
              ZIP all selected ({ids.length})
            </button>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              disabled={busy}
              checked={standardDownload}
              onChange={(event) => setStandardDownload(event.target.checked)}
            />
            Use standard browser download (32 MiB maximum)
          </label>
          <p className="fine-print">
            ZIP folders are grouped by type and extension. Duplicate names keep
            distinct IDs. Browsers without streaming save support are limited to
            32 MiB per ZIP; other exports are limited to 2 GB. Files without a
            reliable source version stay marked as saved with unknown version;
            use ZIP all selected to refresh them manually.
          </p>
          <div className="panel document-list">
            {displayed.map((doc, index) => (
              <div key={doc.id}>
                {(index === 0 ||
                  fileExtension(displayed[index - 1]!.name) !==
                    fileExtension(doc.name)) && (
                  <h3 className="extension-heading">
                    {fileExtension(doc.name).toUpperCase()}
                  </h3>
                )}
                <label className="document-row">
                  <input
                    type="checkbox"
                    aria-label={`Select ${doc.name} in ${doc.context}`}
                    checked={selected.has(doc.id)}
                    disabled={busy}
                    onChange={() => toggle(doc.id)}
                  />
                  <span className="document-name">
                    <strong>{doc.name}</strong>
                    <span>
                      {doc.context} · {doc.source}
                    </span>
                  </span>
                  <span className="pill">{fileCategory(doc)}</span>
                  <span className="document-size">
                    {doc.size === null
                      ? "Size unknown"
                      : `${(doc.size / 1024).toFixed(1)} KiB`}
                  </span>
                  <span className="pill">
                    {labels[state.states[doc.id] ?? "new"]}
                  </span>
                </label>
              </div>
            ))}
            {!filtered.length && state.index && (
              <p className="empty">No matching documents.</p>
            )}
            {filtered.length > visible && (
              <button
                className="secondary"
                onClick={() => setVisible((value) => value + 100)}
              >
                Show 100 more files
              </button>
            )}
          </div>
          {state.index && (
            <details className="document-coverage">
              <summary>Source coverage — review what is included</summary>
              {state.index.coverage.map((item) => (
                <p key={item.source}>
                  <strong>
                    {item.source}: {item.status} ({item.count})
                  </strong>
                  <br />
                  {item.message}
                </p>
              ))}
            </details>
          )}
          <p className="fine-print">
            History contains only account, document and revision hashes. It
            persists across sign-out on this browser, separately from
            credentials. Clearing browser storage or using another device resets
            it.
          </p>
          {!resetRequested ? (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setResetRequested(true)}
            >
              Forget this account’s download history
            </button>
          ) : (
            <div className="notice">
              <p>
                Forgetting history makes previously saved versions eligible
                again. Existing ZIPs on your device stay untouched.
              </p>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    void manager.forgetHistory();
                    setResetRequested(false);
                  }}
                >
                  Forget history
                </button>
                <button
                  className="secondary"
                  onClick={() => setResetRequested(false)}
                >
                  Keep history
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
