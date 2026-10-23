import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { timetableWindow } from "../../../src/application/studentDataManager";
import type { CalendarEntry } from "../../../src/domain/calendar";
import { runtime } from "./runtime";
import { previewData } from "./data/preview";
import { entryTime, formatMoment, safeSchoolLink } from "./format";

type Page = "overview" | "projects" | "timetable" | "connections";
const pages: { id: Page; label: string; mark: string }[] = [
  { id: "overview", label: "Overview", mark: "◈" },
  { id: "projects", label: "Projects", mark: "▤" },
  { id: "timetable", label: "Timetable", mark: "◷" },
  { id: "connections", label: "Connections", mark: "↗" },
];
const idleSignIn = { busy: false, issue: null };
const noSubscribe = () => () => undefined;
function SourceLink({ url, preview }: { url: string; preview: boolean }) {
  const safe = safeSchoolLink(url);
  return safe && !preview ? (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      Open in MyEpitech ↗
    </a>
  ) : null;
}
function Entry({ entry, preview }: { entry: CalendarEntry; preview: boolean }) {
  return (
    <article className={`entry ${entry.cancelled ? "cancelled" : ""}`}>
      <div className="entry-icon" aria-hidden="true">
        {entry.sourceKind === "deadline" ? "↳" : "◷"}
      </div>
      <div className="entry-body">
        <div className="entry-title">
          <h3>{entry.title}</h3>
          {entry.cancelled && <span className="pill">Cancelled</span>}
        </div>
        <p>{formatMoment(entry.start)}</p>
        {"dateTime" in entry.end && <p>Ends {formatMoment(entry.end)}</p>}
        {entry.location && <p>{entry.location}</p>}
        <SourceLink url={entry.sourceUrl} preview={preview} />
      </div>
    </article>
  );
}
export function App() {
  const session = useSyncExternalStore(
    runtime.session.subscribe,
    runtime.session.getSnapshot,
  );
  const dataState = useSyncExternalStore(
    runtime.data.subscribe,
    runtime.data.getSnapshot,
  );
  const signIn = useSyncExternalStore(
    runtime.signIn?.subscribe ?? noSubscribe,
    runtime.signIn?.getSnapshot ?? (() => idleSignIn),
  );
  const [preview, setPreview] = useState(false);
  const [page, setPage] = useState<Page>("overview");
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [registeredOnly, setRegisteredOnly] = useState(false);
  const range = useMemo(() => timetableWindow(offset), [offset]);
  const account = session.student?.login ?? null;
  const connected = Boolean(account);
  useEffect(() => {
    if (account && !preview) void runtime.data.refresh(range.from, range.to);
  }, [account, preview, range]);
  useEffect(() => {
    const clear = () => {
      runtime.data.suspend();
      runtime.session.suspend();
      void runtime.signIn?.cancel();
    };
    window.addEventListener("pagehide", clear);
    return () => window.removeEventListener("pagehide", clear);
  }, []);
  const sample = useMemo(() => previewData(range.from, range.to), [range]);
  const data = preview
    ? sample
    : connected && dataState.account === account
      ? dataState.data
      : null;
  const projects =
    data?.projects.filter(
      (project) =>
        (!registeredOnly || project.registered === true) &&
        project.title.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const entries = [
    ...(data?.events ?? []),
    ...(data?.projects.flatMap((project) => project.deadlines) ?? []),
  ].sort((a, b) => entryTime(a.start).localeCompare(entryTime(b.start)));
  const visibleEntries = entries.filter(
    (entry) =>
      (page !== "timetable" || entry.sourceKind === "class") &&
      entry.title.toLowerCase().includes(query.toLowerCase()),
  );
  const leave = () => {
    setPreview(false);
    setQuery("");
    setOffset(0);
    runtime.data.suspend();
    void runtime.signIn?.cancel();
    void runtime.session.disconnect();
  };
  const explore = () => {
    leave();
    setPreview(true);
    setPage("overview");
  };
  const beginSignIn = () => {
    setPreview(false);
    setQuery("");
    setOffset(0);
    void runtime.signIn?.start();
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand" href="#main" aria-label="Better MyEpitech home">
          <span className="brand-mark">b.</span>
          <span>
            Better
            <br />
            <strong>MyEpitech</strong>
          </span>
        </a>
        <p className="nav-caption">YOUR WORKSPACE</p>
        <nav aria-label="Main navigation">
          {pages.map((item) => (
            <button
              key={item.id}
              aria-current={page === item.id ? "page" : undefined}
              onClick={() => {
                setPage(item.id);
                setQuery("");
              }}
            >
              <span aria-hidden="true">{item.mark}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" />
          Web preview <span className="version">0.1</span>
          <p>An independent student companion.</p>
          <a
            href="https://my.epitech.eu/dashboard"
            target="_blank"
            rel="noopener noreferrer"
          >
            Visit MyEpitech ↗
          </a>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span>{" "}
            {pages.find((item) => item.id === page)?.label}
          </span>
          <div>
            {preview ? (
              <span className="pill preview-pill">Sample data</span>
            ) : connected ? (
              <span className="pill">School connected</span>
            ) : (
              <span className="muted">Not connected</span>
            )}
            {(preview || connected) && (
              <button className="text-button" onClick={leave}>
                {preview ? "Exit preview" : "Sign out"}
              </button>
            )}
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">BETTER MYEPITECH</p>
              <h1>
                {page === "overview"
                  ? connected
                    ? `Hello, ${session.student?.firstName}.`
                    : "A little clarity for your school day."
                  : pages.find((item) => item.id === page)?.label}
              </h1>
              <p className="subtitle">
                {page === "overview"
                  ? "Your projects, deadlines and classes, together in one place."
                  : page === "projects"
                    ? "Keep your next submission in sight."
                    : page === "timetable"
                      ? "Know what’s coming up, and where to be."
                      : "Connect your school. Choose what to share with your tools."}
              </p>
            </div>
            <span className="heading-symbol" aria-hidden="true">
              ✳
            </span>
          </div>
          {preview && (
            <div className="notice preview-notice" role="status">
              <strong>You’re exploring sample data.</strong> These examples are
              fictional. No school account is connected and no Google events
              will be created.
            </div>
          )}
          {(session.issue || signIn.issue) && (
            <div className="notice error" role="alert">
              {signIn.issue ?? session.issue?.message} Web login is
              experimental; Microsoft consent alone does not establish school
              access.
            </div>
          )}
          {!preview && !connected && page !== "connections" && (
            <section className="welcome-card">
              <div>
                <span className="pill">A calmer workspace</span>
                <h2>Start with your school account.</h2>
                <p>
                  Keep MyEpitech as your source of truth. Bring the useful
                  details into one focused view.
                </p>
                <div className="actions">
                  <button
                    className="primary"
                    onClick={() => setPage("connections")}
                  >
                    Connect Epitech <span aria-hidden="true">↗</span>
                  </button>
                  <button className="secondary" onClick={explore}>
                    Explore the preview
                  </button>
                </div>
                <p className="fine-print">
                  School web sign-in requires setup and has not been validated
                  yet.
                </p>
              </div>
              <div className="welcome-art" aria-hidden="true">
                <div className="paper back-paper" />
                <div className="paper">
                  <span className="art-date">YOUR NEXT STEP</span>
                  <span className="art-check">✓</span>
                  <b>
                    Make room
                    <br />
                    for what matters.
                  </b>
                  <i />
                  <i />
                </div>
              </div>
            </section>
          )}
          {page === "connections" ? (
            <div className="connection-grid">
              <section className="panel">
                <span className="connection-icon">e.</span>
                <h2>Epitech</h2>
                <p>
                  Read your accessible projects and timetable through a verified
                  student session.
                </p>
                <div className="notice">
                  {runtime.configuration.ready
                    ? "Experimental login is configured. School acceptance of this independent app is still unverified."
                    : runtime.configuration.message}
                </div>
                {connected && (
                  <p>
                    Connected as <strong>{session.student?.login}</strong>
                    {session.student?.campus
                      ? ` · ${session.student.campus}`
                      : ""}
                  </p>
                )}
                <div className="actions">
                  <button
                    className="primary"
                    disabled={!runtime.configuration.ready || signIn.busy}
                    onClick={beginSignIn}
                  >
                    {signIn.busy
                      ? "Waiting for Microsoft…"
                      : connected
                        ? "Switch school account"
                        : "Continue with Microsoft"}
                  </button>
                  {signIn.busy && (
                    <button
                      className="secondary"
                      onClick={() => void runtime.signIn?.cancel()}
                    >
                      Cancel
                    </button>
                  )}
                  {connected && (
                    <button className="secondary" onClick={leave}>
                      Sign out
                    </button>
                  )}
                </div>
                <p className="fine-print">
                  Sign-in happens at Microsoft. This app never asks for your
                  school password. This web session ends on reload; signing out
                  here does not sign you out of Microsoft.
                </p>
                <details>
                  <summary>Setup and current limits</summary>
                  <p>
                    Register an app-owned Microsoft Entra SPA, set the public
                    IDs and exact redirect in apps/web/.env.local, then enable
                    experimental login. See docs/setup/web.md. Tenant policy or
                    school token validation may prevent this flow.
                  </p>
                </details>
              </section>
              <section className="panel">
                <span className="connection-icon google-icon">G</span>
                <h2>Google Calendar</h2>
                <span className="pill">Web integration planned</span>
                <p>
                  Add a class or project deadline when you choose to. Browser
                  Google linking and export are not available in this first web
                  slice.
                </p>
                <p className="fine-print">
                  The Android authorization module is separate. No Google
                  account is linked by opening this site.
                </p>
                <hr />
                <h3>Documents & Google Drive</h3>
                <p>
                  Document collection and Drive export remain on the roadmap for
                  both apps.
                </p>
              </section>
            </div>
          ) : (
            <>
              {(preview || connected) && (
                <>
                  {page === "overview" && (
                    <section className="stats" aria-label="Workspace totals">
                      <div>
                        <p>Accessible projects</p>
                        <strong>{data ? data.projects.length : "—"}</strong>
                        <span>Across your school access</span>
                      </div>
                      <div>
                        <p>Upcoming & ongoing</p>
                        <strong>
                          {data
                            ? data.projects.filter((p) =>
                                ["ongoing", "upcoming"].includes(p.status),
                              ).length
                            : "—"}
                        </strong>
                        <span>Projects to keep in view</span>
                      </div>
                      <div>
                        <p>Timetable entries</p>
                        <strong>
                          {data
                            ? data.events.filter((e) => !e.cancelled).length
                            : "—"}
                        </strong>
                        <span>In the selected fortnight</span>
                      </div>
                    </section>
                  )}
                  <div className="section-toolbar">
                    <div>
                      <h2>
                        {page === "projects"
                          ? "Your projects"
                          : page === "timetable"
                            ? "School timetable"
                            : "Dates to keep in view"}
                      </h2>
                      <p className="muted">
                        {page === "projects"
                          ? "Projects are collected independently of the timetable range."
                          : `${range.from.slice(0, 10)} — ${range.to.slice(0, 10)} · end exclusive, UTC range`}
                      </p>
                    </div>
                    <div className="actions">
                      {page !== "projects" && (
                        <>
                          <button
                            className="secondary compact"
                            aria-label="Previous fortnight"
                            onClick={() => setOffset((value) => value - 1)}
                          >
                            ←
                          </button>
                          <button
                            className="secondary compact"
                            onClick={() => setOffset(0)}
                          >
                            This fortnight
                          </button>
                          <button
                            className="secondary compact"
                            aria-label="Next fortnight"
                            onClick={() => setOffset((value) => value + 1)}
                          >
                            →
                          </button>
                        </>
                      )}
                      {connected && !preview && (
                        <button
                          className="secondary compact"
                          disabled={dataState.status === "loading"}
                          onClick={() =>
                            void runtime.data.refresh(range.from, range.to)
                          }
                        >
                          Refresh
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="filters">
                    <label className="search">
                      <span aria-hidden="true">⌕</span>
                      <input
                        type="search"
                        aria-label={
                          page === "projects"
                            ? "Search projects"
                            : "Search dates"
                        }
                        placeholder={
                          page === "projects"
                            ? "Search projects…"
                            : "Search dates…"
                        }
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                    {page === "projects" && (
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={registeredOnly}
                          onChange={(event) =>
                            setRegisteredOnly(event.target.checked)
                          }
                        />{" "}
                        Registered projects only
                      </label>
                    )}
                  </div>
                  {!preview && dataState.status === "loading" && (
                    <div className="empty" role="status">
                      Loading school information…
                    </div>
                  )}
                  {!preview && dataState.issue && (
                    <div className="notice error" role="alert">
                      {dataState.issue}
                    </div>
                  )}
                  {data?.warnings.map((warning) => (
                    <p className="notice" key={warning}>
                      {warning}
                    </p>
                  ))}
                  {data && !data.complete && (
                    <p className="notice">
                      This collection is incomplete. Missing records must not be
                      treated as cancelled or removed.
                    </p>
                  )}
                  {data &&
                    (page === "projects" ? (
                      <div className="project-grid">
                        {projects.map((project) => (
                          <article
                            className="panel project-card"
                            key={project.id}
                          >
                            <div className="project-top">
                              <span
                                className="project-symbol"
                                aria-hidden="true"
                              >
                                ▤
                              </span>
                              <span className="pill">{project.status}</span>
                            </div>
                            <h3>{project.title}</h3>
                            <p className="muted">
                              {project.registered === true
                                ? "Registered"
                                : project.registered === false
                                  ? "Not registered"
                                  : "Registration unconfirmed"}
                            </p>
                            {project.deadlines.length ? (
                              project.deadlines.map((entry) => (
                                <div className="deadline" key={entry.sourceId}>
                                  <strong>{entry.title}</strong>
                                  <p>
                                    {formatMoment(entry.start)}
                                    {entry.cancelled ? " · Cancelled" : ""}
                                  </p>
                                </div>
                              ))
                            ) : (
                              <p className="fine-print">
                                No verified deadline available.
                              </p>
                            )}
                            <SourceLink
                              url={project.sourceUrl}
                              preview={preview}
                            />
                          </article>
                        ))}
                        {!projects.length && (
                          <p className="empty">No matching projects.</p>
                        )}
                      </div>
                    ) : (
                      <section className="panel entries">
                        {visibleEntries.map((entry) => (
                          <Entry
                            key={`${entry.sourceKind}:${entry.sourceId}`}
                            entry={entry}
                            preview={preview}
                          />
                        ))}
                        {!visibleEntries.length && (
                          <p className="empty">
                            No matching dates in this view.
                          </p>
                        )}
                      </section>
                    ))}
                  <p className="fine-print">
                    {preview
                      ? "Sample workspace"
                      : data
                        ? `Last collected ${new Date(data.collectedAt).toLocaleString()}`
                        : "No collection yet"}{" "}
                    · Times use the source timezone; dates without a time stay
                    all day.
                  </p>
                </>
              )}
              {!preview && !connected && (
                <div className="feature-grid">
                  <section>
                    <span aria-hidden="true">▤</span>
                    <h3>Keep projects in view</h3>
                    <p>
                      See the projects you can access and their verified
                      deadlines.
                    </p>
                  </section>
                  <section>
                    <span aria-hidden="true">◷</span>
                    <h3>Find your next class</h3>
                    <p>Keep class times, rooms and cancellations together.</p>
                  </section>
                  <section>
                    <span aria-hidden="true">↗</span>
                    <h3>Your tools, your choice</h3>
                    <p>
                      Calendar and document exports are part of the wider
                      roadmap.
                    </p>
                  </section>
                </div>
              )}
            </>
          )}
          <footer>
            Made for Epitech students. Independent from the school.
            <span>Mobile + web, one project.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
