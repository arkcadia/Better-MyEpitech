import { DocumentManager } from "../../../../src/application/documentManager";
import type {
  DocumentIndex,
  SchoolDocument,
} from "../../../../src/domain/documents";
import { BrowserDownloadHistory } from "./history";
let added = false;
const encoder = new TextEncoder();
function document(
  id: string,
  name: string,
  context: string,
  source: SchoolDocument["source"] = "personal",
): SchoolDocument {
  return {
    id: `preview:${id}`,
    name,
    context,
    source,
    sourceUrl: "https://my.epitech.eu/dashboard",
    mimeType: name.endsWith(".pdf") ? "application/pdf" : null,
    size: null,
    revision: "synthetic-v1",
    reference: { kind: "markdown", path: "/preview-only" },
  };
}
const digest = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
export const previewDocuments = new DocumentManager({
  digest,
  history: new BrowserDownloadHistory(),
  collect: async (): Promise<DocumentIndex> => ({
    documents: [
      document("brief", "project-brief.pdf", "2026 / Tiny shell", "projects"),
      document(
        "old-brief",
        "project-brief.pdf",
        "2025 / Intro project",
        "projects",
      ),
      document(
        "binary",
        "sample.bin",
        "Fictional exercise files",
        "activities",
      ),
      document("source", "starter.c", "Fictional exercise files", "activities"),
      ...(added
        ? [
            document(
              "new",
              "new-course-notes.txt",
              "New fictional upload",
              "elearning",
            ),
          ]
        : []),
    ],
    coverage: [
      {
        source: "personal",
        count: 4 + Number(added),
        status: "collected",
        message:
          "Fictional preview files only. No school account or file host is accessed.",
      },
    ],
    collectedAt: new Date().toISOString(),
  }),
  reader: {
    async open(item) {
      const bytes = item.name.endsWith(".pdf")
        ? encoder.encode(
            "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
          )
        : item.name.endsWith(".bin")
          ? new Uint8Array([0, 1, 2, 3, 4, 5])
          : encoder.encode(
              `Fictional Better MyEpitech preview file: ${item.name}\n`,
            );
      return (async function* () {
        yield bytes;
      })();
    },
  },
});
export const addPreviewDocument = () => {
  added = true;
  void previewDocuments.scan();
};
