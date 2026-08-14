export function resolveLocalPath(
  documentPath: string,
  rawHref: string,
): string | null {
  if (!rawHref) return null;
  try {
    if (rawHref.startsWith("file://")) {
      return decodeURIComponent(new URL(rawHref).pathname);
    }
    const cleanHref = decodeURIComponent(rawHref.split("?", 1)[0]);
    if (cleanHref.startsWith("/")) return cleanHref;
    const directory = documentPath.slice(0, documentPath.lastIndexOf("/"));
    return `${directory}/${cleanHref}`;
  } catch {
    return null;
  }
}

export function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}
