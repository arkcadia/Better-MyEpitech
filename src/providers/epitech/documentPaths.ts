import { AuthError } from "../../domain/auth";

const numeric = "[1-9]\\d*";
const code = "[A-Za-z0-9_%.-]+";
const files = new RegExp(
  `^/units/(?:instances/projects/${numeric}/related-resources/files|\\d{4}/${code}/${code}/activities/${numeric}/files/students|\\d{4}/${code}/projects/${numeric}/files/students)(?:/.*)?$`,
);
export function documentReadPath(path: string): string | null {
  if (typeof path !== "string" || path.length > 4096 || /[\\\s#]/.test(path))
    throw new AuthError("contract");
  const [route = "", query = "", ...extra] = path.split("?");
  if (extra.length) throw new AuthError("contract");
  const params = new URLSearchParams(query);
  const routes = [
    /^\/students\/documents(?:\/[1-9]\d*\/download)?$/,
    /^\/students\/follow-ups$/,
    /^\/units\/instances\/school-years$/,
    /^\/e-learning\/overview$/,
    /^\/e-learning\/modules\/[1-9]\d*$/,
    /^\/e-learning\/chapters\/[1-9]\d*\/(?:url|content|subtitles)$/,
    new RegExp(`^/units/\\d{4}/${code}/${code}$`),
    files,
  ];
  const units = route === "/units/instances";
  if (!units && !routes.some((pattern) => pattern.test(route))) return null;
  // Reject nested traversal, encoded separators and control characters before giving a route a bearer.
  for (const raw of route.split("/").slice(1)) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      throw new AuthError("contract");
    }
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      /[\/\\\x00-\x1f\x7f]/.test(segment) ||
      /%[0-9a-f]{2}/i.test(segment)
    )
      throw new AuthError("contract");
  }
  const detail = /^\/units\/\d{4}\//.test(route) && !route.includes("/files/");
  for (const key of params.keys()) {
    if (
      params.getAll(key).length !== 1 ||
      !(
        units
          ? ["page", "limit", "schoolYear", "expanded"]
          : detail
            ? ["expanded"]
            : []
      ).includes(key)
    )
      throw new AuthError("contract");
    const value = params.get(key)!;
    if (
      key === "expanded"
        ? value !== "true"
        : !/^[1-9]\d*$/.test(value) ||
          Number(value) >
            (key === "limit" ? 1000 : key === "schoolYear" ? 9999 : 100000)
    )
      throw new AuthError("contract");
  }
  return route + (params.size ? `?${params.toString()}` : "");
}
export function schoolBinaryPath(path: string): string {
  if (!/^\/students\/follow-ups\/[1-9]\d*\/attachment$/.test(path))
    throw new AuthError("contract");
  return path;
}
