import type { SchoolDocument } from "../domain/documents";

export function fileExtension(name: string): string {
  const value = name.toLowerCase();
  if (value.endsWith(".tar.gz")) return "tar.gz";
  const match = /\.([a-z0-9_+-]{1,16})$/.exec(value);
  return match?.[1] ?? "no-extension";
}
export function fileCategory(
  document: Pick<SchoolDocument, "name" | "mimeType">,
): string {
  const extension = fileExtension(document.name);
  if (
    [
      "exe",
      "dll",
      "so",
      "dylib",
      "bin",
      "elf",
      "o",
      "a",
      "apk",
      "deb",
      "rpm",
      "wasm",
    ].includes(extension)
  )
    return "binaries";
  if (extension === "pdf" || document.mimeType === "application/pdf")
    return "pdf";
  if (
    ["zip", "tar", "gz", "tar.gz", "7z", "rar", "bz2", "xz"].includes(extension)
  )
    return "archives";
  if (
    ["png", "jpg", "jpeg", "svg", "gif", "webp", "bmp", "ico"].includes(
      extension,
    )
  )
    return "images";
  if (["mp4", "webm", "mov", "mp3", "wav", "ogg"].includes(extension))
    return "media";
  if (
    [
      "c",
      "h",
      "cpp",
      "hpp",
      "py",
      "js",
      "ts",
      "tsx",
      "java",
      "rs",
      "go",
      "sh",
      "makefile",
    ].includes(extension)
  )
    return "code";
  if (
    [
      "txt",
      "md",
      "csv",
      "json",
      "xml",
      "html",
      "vtt",
      "srt",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "ppt",
      "pptx",
      "odt",
    ].includes(extension)
  )
    return "documents";
  return document.mimeType === "application/octet-stream"
    ? "binaries"
    : "other";
}
export function safeArchiveComponent(value: string): string {
  let name = value
    .normalize("NFC")
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  if (!name || name === "." || name === "..") name = "document";
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name))
    name = `_${name}`;
  return name;
}
export function archivePath(
  document: SchoolDocument,
  identityHash: string,
): string {
  const extension = fileExtension(document.name);
  const suffix = extension === "no-extension" ? "" : `.${extension}`;
  const stem = suffix ? document.name.slice(0, -suffix.length) : document.name;
  return `${fileCategory(document)}/${extension}/${safeArchiveComponent(document.context)}/${safeArchiveComponent(stem)}--${identityHash}${suffix}`;
}
