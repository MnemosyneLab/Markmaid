import type { AppTab, DocumentTab } from "./types";

export interface QuickSwitcherItem {
  id: string;
  kind: "tab" | "recent";
  label: string;
  detail: string;
  tabKey?: string;
  path?: string;
}

export function documentPath(tab: DocumentTab): string {
  if (tab.status === "ready") return tab.canonicalPath;
  if (tab.status === "error") {
    return tab.canonicalPath ?? tab.requestedPath;
  }
  return tab.requestedPath;
}

export function disambiguatedTabLabels(tabs: AppTab[]): Map<string, string> {
  const documents = tabs.filter(
    (tab): tab is DocumentTab => tab.kind === "document",
  );
  const labelsByPath = disambiguatePathLabels(documents.map(documentPath));
  return new Map(
    documents.map((tab) => [
      tab.key,
      labelsByPath.get(documentPath(tab)) ?? tab.displayName,
    ]),
  );
}

export function disambiguatePathLabels(paths: string[]): Map<string, string> {
  const uniquePaths = [...new Set(paths)];
  const groups = new Map<string, string[]>();
  for (const path of uniquePaths) {
    const name = fileName(path);
    groups.set(name, [...(groups.get(name) ?? []), path]);
  }

  const labels = new Map<string, string>();
  for (const [name, groupedPaths] of groups) {
    if (groupedPaths.length === 1) {
      labels.set(groupedPaths[0], name);
      continue;
    }

    const parents = groupedPaths.map(parentSegments);
    for (let index = 0; index < groupedPaths.length; index += 1) {
      const segments = parents[index];
      let suffix = segments.at(-1) ?? directoryName(groupedPaths[index]);
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const candidate = segments.slice(-depth).join("/");
        const unique = parents.every(
          (other, otherIndex) =>
            otherIndex === index || other.slice(-depth).join("/") !== candidate,
        );
        suffix = candidate;
        if (unique) break;
      }
      labels.set(groupedPaths[index], suffix ? `${name} — ${suffix}` : groupedPaths[index]);
    }
  }
  return labels;
}

export function buildQuickSwitcherItems(
  tabs: AppTab[],
  recentDocuments: string[],
  query: string,
): QuickSwitcherItem[] {
  const openPaths = new Set<string>();
  const items: QuickSwitcherItem[] = [];
  const openLabels = disambiguatedTabLabels(tabs);

  for (const tab of tabs) {
    if (tab.kind === "settings") {
      items.push({
        id: "tab:settings",
        kind: "tab",
        label: "Settings",
        detail: "Open tab",
        tabKey: tab.key,
      });
      continue;
    }
    const path = documentPath(tab);
    openPaths.add(path);
    items.push({
      id: `tab:${tab.key}`,
      kind: "tab",
      label: openLabels.get(tab.key) ?? tab.displayName,
      detail: path,
      tabKey: tab.key,
    });
  }

  for (const path of recentDocuments) {
    if (openPaths.has(path)) continue;
    items.push({
      id: `recent:${path}`,
      kind: "recent",
      label: fileName(path),
      detail: path,
      path,
    });
  }

  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter((item) => {
    const haystack = `${item.label}\n${item.detail}`.toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function shouldSuppressTabClick(
  key: string | null,
  suppressedKey: string | null,
  suppressedUntil: number,
  now: number,
): boolean {
  return Boolean(key && key === suppressedKey && now < suppressedUntil);
}

function fileName(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  return normalized.split("/").at(-1) || path;
}

function directoryName(path: string): string {
  const segments = parentSegments(path);
  return segments.at(-1) ?? "";
}

function parentSegments(path: string): string[] {
  const segments = path.replace(/\/+$/, "").split("/").filter(Boolean);
  return segments.slice(0, -1);
}
