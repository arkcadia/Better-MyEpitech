import { AuthError, isRecord, normalizedLogin } from "../../domain/auth";
import {
  checkDocumentSignal,
  DocumentError,
  type DocumentCoverage,
  type DocumentIndex,
  type DocumentSource,
  type SchoolDocument,
} from "../../domain/documents";

type Read = (path: string, signal: AbortSignal) => Promise<unknown>;
type State = {
  count: number;
  failed: boolean;
  unavailable: boolean;
  notes: Set<string>;
};
const sources: DocumentSource[] = [
  "personal",
  "projects",
  "activities",
  "elearning",
  "followups",
];
const validId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const text = (value: unknown, max = 500): value is string =>
  typeof value === "string" && Boolean(value.trim()) && value.length <= max;
const size = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
const revision = (row: Record<string, unknown>): string | null =>
  typeof row.updatedAt === "string" &&
  Number.isFinite(Date.parse(row.updatedAt))
    ? row.updatedAt
    : null;
const segment = (value: unknown): string => {
  if (
    !text(value, 200) ||
    /[\/\\\x00-\x1f]/.test(value) ||
    /%[0-9a-f]{2}/i.test(value) ||
    value === "." ||
    value === ".."
  )
    throw new DocumentError("contract");
  return encodeURIComponent(value);
};
const portal = "https://my.epitech.eu";
class DiscoveryBudgetError extends DocumentError {
  constructor() {
    super("limit");
  }
}

/** Read-only source registry. Every ID/context comes from the signed-in student's own responses. */
export class HttpEpitechDocuments {
  constructor(
    private readonly read: Read,
    private readonly login: string,
    private readonly now: () => number = Date.now,
  ) {}
  async collect(signal: AbortSignal): Promise<DocumentIndex> {
    const documents = new Map<string, SchoolDocument>();
    const state = Object.fromEntries(
      sources.map((source) => [
        source,
        {
          count: 0,
          failed: false,
          unavailable: false,
          notes: new Set<string>(),
        },
      ]),
    ) as Record<DocumentSource, State>;
    let external = 0;
    let requests = 0;
    const note = (source: DocumentSource, message: string) => {
      state[source].failed = true;
      state[source].notes.add(message);
    };
    const add = (document: SchoolDocument) => {
      checkDocumentSignal(signal);
      if (documents.size >= 20000 && !documents.has(document.id)) {
        note(
          document.source,
          "The 20,000-document discovery limit was reached.",
        );
        return;
      }
      if (!documents.has(document.id)) {
        documents.set(document.id, document);
        state[document.source].count++;
      }
    };
    const guard = (error: unknown) => {
      if (error instanceof DiscoveryBudgetError) throw error;
      checkDocumentSignal(signal);
      if (
        error instanceof AuthError &&
        [
          "unauthorized",
          "not_student",
          "identity_mismatch",
          "cancelled",
        ].includes(error.code)
      )
        throw error;
    };
    const safely = async (
      source: DocumentSource,
      operation: () => Promise<void>,
    ) => {
      try {
        await operation();
      } catch (error) {
        guard(error);
        state[source].failed = true;
        if (error instanceof AuthError && error.code === "forbidden")
          state[source].unavailable = true;
        state[source].notes.add(
          "One or more source requests were unavailable or had an unsupported response.",
        );
      }
    };
    const read = async (path: string) => {
      if (++requests > 5000) throw new DiscoveryBudgetError();
      checkDocumentSignal(signal);
      const value = await this.read(path, signal);
      checkDocumentSignal(signal);
      return value;
    };
    const array = (value: unknown): unknown[] => {
      if (!Array.isArray(value) || value.length > 20000)
        throw new DocumentError("contract");
      return value;
    };
    const paginated = async (
      source: DocumentSource,
      route: string,
      query: Record<string, string>,
    ): Promise<Record<string, unknown>[]> => {
      const records = new Map<number, Record<string, unknown>>();
      let total: number | null = null;
      for (let page = 1; page <= 100; page++) {
        const raw = await read(
          `${route}?${new URLSearchParams({ ...query, page: String(page), limit: "50" })}`,
        );
        if (!isRecord(raw) || !Array.isArray(raw.data) || !isRecord(raw.meta))
          throw new DocumentError("contract");
        const meta = raw.meta;
        if (
          meta.page !== page ||
          !Number.isSafeInteger(meta.limit) ||
          Number(meta.limit) < 1 ||
          raw.data.length > Number(meta.limit) ||
          !Number.isSafeInteger(meta.total) ||
          Number(meta.total) < 0 ||
          !Number.isSafeInteger(meta.pages) ||
          Number(meta.pages) < 0 ||
          typeof meta.hasNext !== "boolean" ||
          (meta.hasNext && (!raw.data.length || Number(meta.pages) <= page))
        )
          throw new DocumentError("contract");
        if (total !== null && total !== meta.total)
          note(
            source,
            "The source changed while its pages were collected. Refresh to check coverage.",
          );
        total = Number(meta.total);
        for (const row of raw.data) {
          if (!isRecord(row) || !validId(row.id)) {
            note(source, "Some source records could not be read.");
            continue;
          }
          if (records.has(row.id))
            note(
              source,
              "Source pages overlapped; refresh to check completeness.",
            );
          records.set(row.id, row);
        }
        if (!meta.hasNext) {
          if (records.size !== total)
            note(
              source,
              "The source count did not match its pagination total.",
            );
          return [...records.values()];
        }
      }
      note(source, "The 100-page discovery limit was reached.");
      return [...records.values()];
    };
    const tree = async (
      source: "projects" | "activities",
      path: string,
      context: string,
      sourceUrl: string,
    ) => {
      const raw = array(await read(path));
      let visited = 0;
      const walk = (nodes: unknown[], parent: string[], depth: number) => {
        if (depth > 40) {
          note(source, "A resource tree exceeded the folder depth limit.");
          return;
        }
        for (const node of nodes) {
          checkDocumentSignal(signal);
          if (++visited > 20000) {
            note(source, "A resource tree exceeded its item limit.");
            return;
          }
          if (
            !isRecord(node) ||
            !validId(node.id) ||
            !text(node.name) ||
            !["folder", "file"].includes(String(node.kind))
          ) {
            note(source, "An invalid resource entry was skipped.");
            continue;
          }
          let component: string;
          try {
            component = segment(node.name);
          } catch {
            note(source, "A resource name cannot be addressed safely.");
            continue;
          }
          const parts = [...parent, component];
          if (node.kind === "folder") {
            if (!Array.isArray(node.childrens)) {
              note(
                source,
                "A folder omitted its children; it may be incompletely expanded.",
              );
              continue;
            }
            walk(node.childrens, parts, depth + 1);
          } else {
            const blob = isRecord(node.blob) ? node.blob : {};
            const updated = revision(node);
            add({
              id: `files:${path}:${node.id}`,
              name: node.name,
              source,
              context: `${context}${parent.length ? ` / ${parent.map((value) => decodeURIComponent(value)).join(" / ")}` : ""}`,
              sourceUrl,
              mimeType: text(blob.mimeType) ? blob.mimeType : null,
              size: size(blob.size),
              revision: updated
                ? JSON.stringify([updated, blob.id ?? null, node.name])
                : null,
              reference: { kind: "url", path: `${path}/${parts.join("/")}` },
            });
          }
        }
      };
      walk(raw, [], 0);
    };
    try {
      await safely("personal", async () => {
        for (const item of array(await read("/students/documents"))) {
          if (
            !isRecord(item) ||
            !validId(item.id) ||
            !text(item.fileName) ||
            typeof item.visibleToStudent !== "boolean" ||
            typeof item.studentLogin !== "string"
          ) {
            note("personal", "Invalid personal document metadata was skipped.");
            continue;
          }
          if (
            normalizedLogin(item.studentLogin) !== normalizedLogin(this.login)
          )
            throw new AuthError("identity_mismatch");
          if (!item.visibleToStudent) continue;
          const updated = revision(item);
          add({
            id: `personal:${item.id}`,
            name: item.fileName,
            source: "personal",
            context: "Personal documents",
            sourceUrl: `${portal}/dashboard`,
            mimeType: text(item.mimeType) ? item.mimeType : null,
            size: size(item.fileSize),
            revision: updated
              ? JSON.stringify([updated, item.fileName, item.fileSize ?? null])
              : null,
            reference: {
              kind: "url",
              path: `/students/documents/${item.id}/download`,
            },
          });
        }
      });
      await safely("followups", async () => {
        for (const item of array(await read("/students/follow-ups"))) {
          if (
            !isRecord(item) ||
            !validId(item.id) ||
            typeof item.studentLogin !== "string" ||
            typeof item.visibleToStudent !== "boolean"
          ) {
            note("followups", "Some follow-up metadata could not be read.");
            continue;
          }
          if (
            normalizedLogin(item.studentLogin) !== normalizedLogin(this.login)
          )
            throw new AuthError("identity_mismatch");
          if (!item.visibleToStudent || !text(item.attachmentFileName))
            continue;
          add({
            id: `followup:${item.id}`,
            name: item.attachmentFileName,
            source: "followups",
            context: "Follow-up attachments",
            sourceUrl: `${portal}/dashboard`,
            mimeType: null,
            size: null,
            revision: revision(item),
            reference: {
              kind: "binary",
              path: `/students/follow-ups/${item.id}/attachment`,
            },
          });
        }
      });
      let years: (number | undefined)[] = [undefined];
      let yearsDiscovered = false;
      await safely("activities", async () => {
        const raw = array(await read("/units/instances/school-years"));
        if (
          raw.length > 100 ||
          !raw.every(
            (year) =>
              typeof year === "number" &&
              Number.isInteger(year) &&
              year >= 1900 &&
              year <= 9999,
          )
        )
          throw new DocumentError("contract");
        years = raw.length ? [...new Set(raw as number[])] : [undefined];
        yearsDiscovered = true;
      });
      if (!yearsDiscovered)
        note(
          "projects",
          "Accessible historical school years could not be established.",
        );
      const seenUnits = new Set<number>();
      const seenProjects = new Set<number>();
      const seenTrees = new Set<string>();
      const onceTree = async (
        source: "projects" | "activities",
        path: string,
        context: string,
        url: string,
      ) => {
        if (seenTrees.has(path)) return;
        seenTrees.add(path);
        await safely(source, () => tree(source, path, context, url));
      };
      for (const year of years) {
        const yearQuery: Record<string, string> = year
          ? { schoolYear: String(year) }
          : {};
        await safely("projects", async () => {
          const projects = await paginated(
            "projects",
            "/units/instances/projects",
            yearQuery,
          );
          for (const project of projects) {
            if (!validId(project.id) || seenProjects.has(project.id)) continue;
            seenProjects.add(project.id);
            external += text(project.description, 100000)
              ? (project.description.match(/https?:\/\//g)?.length ?? 0)
              : 0;
            await onceTree(
              "projects",
              `/units/instances/projects/${project.id}/related-resources/files`,
              text(project.name) ? project.name : `Project ${project.id}`,
              `${portal}/dashboard`,
            );
          }
        });
        await safely("activities", async () => {
          for (const summary of await paginated(
            "activities",
            "/units/instances",
            { ...yearQuery, expanded: "true" },
          )) {
            if (!validId(summary.id) || seenUnits.has(summary.id)) continue;
            seenUnits.add(summary.id);
            try {
              if (
                !Number.isInteger(summary.schoolYear) ||
                Number(summary.schoolYear) < 1900 ||
                Number(summary.schoolYear) > 9999
              )
                throw new DocumentError("contract");
              const base = `/units/${summary.schoolYear}/${segment(summary.unitCode)}/${segment(summary.code)}`;
              let unit = summary;
              if (
                !Array.isArray(unit.activityInstances) ||
                !Array.isArray(unit.projectInstances)
              ) {
                const detail = await read(`${base}?expanded=true`);
                if (!isRecord(detail) || detail.id !== summary.id)
                  throw new DocumentError("contract");
                unit = detail;
              }
              external += text(unit.description, 100000)
                ? (unit.description.match(/https?:\/\//g)?.length ?? 0)
                : 0;
              const name = text(unit.name)
                ? unit.name
                : String(summary.unitCode);
              for (const activity of array(unit.activityInstances)) {
                if (!isRecord(activity) || !validId(activity.id)) {
                  note("activities", "An activity could not be discovered.");
                  continue;
                }
                await onceTree(
                  "activities",
                  `${base}/activities/${activity.id}/files/students`,
                  `${summary.schoolYear} / ${name} / ${text(activity.name) ? activity.name : activity.id}`,
                  `${portal}/dashboard`,
                );
              }
              for (const project of array(unit.projectInstances)) {
                if (!isRecord(project) || !validId(project.id)) {
                  note("projects", "A unit project could not be discovered.");
                  continue;
                }
                const title = `${summary.schoolYear} / ${name} / ${text(project.name) ? project.name : project.id}`;
                await onceTree(
                  "projects",
                  `/units/instances/projects/${project.id}/related-resources/files`,
                  title,
                  `${portal}/dashboard`,
                );
                const templateYear =
                  typeof unit.unitSchoolYear === "number"
                    ? unit.unitSchoolYear
                    : isRecord(unit.unitTemplate)
                      ? unit.unitTemplate.schoolYear
                      : null;
                if (
                  validId(project.projectTemplateId) &&
                  typeof templateYear === "number" &&
                  Number.isInteger(templateYear) &&
                  templateYear >= 1900 &&
                  templateYear <= 9999
                ) {
                  await onceTree(
                    "projects",
                    `/units/${templateYear}/${segment(unit.unitCode)}/projects/${project.projectTemplateId}/files/students`,
                    `${title} / Project brief`,
                    `${portal}/dashboard`,
                  );
                }
              }
            } catch (error) {
              guard(error);
              note(
                "activities",
                "A unit or activity resource collection was incomplete.",
              );
            }
          }
        });
      }
      await safely("elearning", async () => {
        const modules = new Set<number>();
        let chapters = 0;
        for (const category of array(await read("/e-learning/overview"))) {
          if (!isRecord(category) || !Array.isArray(category.modules)) {
            note("elearning", "An e-learning category could not be read.");
            continue;
          }
          for (const summary of category.modules) {
            if (
              !isRecord(summary) ||
              !validId(summary.id) ||
              modules.has(summary.id)
            )
              continue;
            modules.add(summary.id);
            await safely("elearning", async () => {
              const module = await read(`/e-learning/modules/${summary.id}`);
              if (
                !isRecord(module) ||
                module.id !== summary.id ||
                !text(module.title)
              )
                throw new DocumentError("contract");
              for (const chapter of array(module.chapters)) {
                if (++chapters > 20000) {
                  note(
                    "elearning",
                    "The e-learning chapter limit was reached.",
                  );
                  return;
                }
                if (
                  !isRecord(chapter) ||
                  !validId(chapter.id) ||
                  !text(chapter.title)
                ) {
                  note("elearning", "A chapter could not be read.");
                  continue;
                }
                const context = `E-learning / ${module.title}`;
                const common = {
                  source: "elearning" as const,
                  context,
                  sourceUrl: `${portal}/e-learning`,
                  size: null,
                  revision: revision(chapter),
                };
                if (
                  chapter.contentType === "pdf" &&
                  chapter.hasDocument === true
                ) {
                  add({
                    ...common,
                    id: `chapter:${chapter.id}`,
                    name: /\.pdf$/i.test(chapter.title)
                      ? chapter.title
                      : `${chapter.title}.pdf`,
                    mimeType: "application/pdf",
                    reference: {
                      kind: "url",
                      path: `/e-learning/chapters/${chapter.id}/url`,
                    },
                  });
                } else if (chapter.contentType === "markdown") {
                  add({
                    ...common,
                    id: `chapter:${chapter.id}`,
                    name: `${chapter.title}.md`,
                    mimeType: "text/markdown",
                    reference: {
                      kind: "markdown",
                      path: `/e-learning/chapters/${chapter.id}/content`,
                    },
                  });
                } else {
                  external++;
                }
                if (Array.isArray(chapter.subtitleLanguages))
                  for (const language of chapter.subtitleLanguages) {
                    if (
                      typeof language !== "string" ||
                      !/^[A-Za-z0-9-]{1,40}$/.test(language)
                    ) {
                      note(
                        "elearning",
                        "A subtitle language could not be read.",
                      );
                      continue;
                    }
                    add({
                      ...common,
                      id: `subtitle:${chapter.id}:${language}`,
                      name: `${chapter.title}.${language}.vtt`,
                      mimeType: "text/vtt",
                      reference: {
                        kind: "subtitles",
                        path: `/e-learning/chapters/${chapter.id}/subtitles`,
                        language,
                      },
                    });
                  }
              }
            });
          }
        }
      });
    } catch (error) {
      if (!(error instanceof DiscoveryBudgetError)) throw error;
      for (const source of sources)
        note(
          source,
          "Discovery reached its 5,000-request safety limit; later sources may be incomplete.",
        );
    }
    checkDocumentSignal(signal);
    const coverage: DocumentCoverage[] = sources.map((source) => ({
      source,
      count: state[source].count,
      status: state[source].failed
        ? state[source].unavailable && state[source].count === 0
          ? "unavailable"
          : "partial"
        : "collected",
      message: state[source].notes.size
        ? [...state[source].notes].join(" ")
        : "Source responses collected; portal comparison is still required to validate full coverage.",
    }));
    coverage.push({
      source: "external",
      status: "link_only",
      count: external,
      message:
        "External platforms, streaming videos and description links stay on their source pages. Separate connectors may be needed; these are not counted as downloaded files.",
    });
    return {
      documents: [...documents.values()].sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      ),
      coverage,
      collectedAt: new Date(this.now()).toISOString(),
    };
  }
}
