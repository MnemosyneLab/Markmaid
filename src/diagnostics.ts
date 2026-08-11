import type {
  AppState,
  AppTab,
  ColorTheme,
  ThemeMode,
  WorkspaceMarkdownIndex,
} from "./types";

export interface DiagnosticsEnvironment {
  appName: string;
  appVersion: string;
  osName: string;
  osVersion: string;
  architecture: string;
  buildMode: string;
}

export interface DiagnosticErrorRecord {
  operation: string;
  code: string;
}

export type QuickOpenDiagnosticsStatus =
  | "idle"
  | "indexing"
  | "ready"
  | "failed";

export interface DiagnosticsSnapshotInput {
  environment: DiagnosticsEnvironment;
  state: AppState;
  expandedNodeCount: number;
  quickOpenStatus: QuickOpenDiagnosticsStatus;
  quickOpenIndex: WorkspaceMarkdownIndex | null;
  recentError: DiagnosticErrorRecord | null;
  resolvedAppearance: "light" | "dark";
}

export interface TabDiagnosticsCounts {
  total: number;
  document: number;
  mermaid: number;
  image: number;
  error: number;
  loading: number;
}

const PROHIBITED_FIELD_MARKERS = [
  "requestedPath",
  "canonicalPath",
  "displayName",
  "source",
  "html",
  "query",
  "recentDocuments",
  "message",
] as const;

export { PROHIBITED_FIELD_MARKERS };

export function countTabs(tabs: AppTab[]): TabDiagnosticsCounts {
  const counts: TabDiagnosticsCounts = {
    total: tabs.length,
    document: 0,
    mermaid: 0,
    image: 0,
    error: 0,
    loading: 0,
  };
  for (const tab of tabs) {
    if (tab.kind === "document") counts.document += 1;
    if (tab.kind === "mermaid") counts.mermaid += 1;
    if (tab.kind === "image") counts.image += 1;
    if (tab.kind !== "settings" && tab.status === "error") counts.error += 1;
    if (tab.kind !== "settings" && tab.status === "loading") counts.loading += 1;
  }
  return counts;
}

export function normalizeDiagnosticError(
  operation: string,
  error: unknown,
): DiagnosticErrorRecord {
  const code = normalizeErrorCode(error);
  return {
    operation: redactOperation(operation),
    code,
  };
}

export function formatDiagnosticsReport(input: DiagnosticsSnapshotInput): string {
  const tabs = countTabs(input.state.tabs);
  const unavailable = input.quickOpenIndex?.unavailableRootIds.length ?? 0;
  const truncated = input.quickOpenIndex?.truncatedRootIds.length ?? 0;
  const recent = input.recentError;
  const lines = [
    "MarkMaid diagnostics v1",
    `App: ${input.environment.appName} ${input.environment.appVersion}`,
    `Runtime: ${input.environment.osName} ${input.environment.osVersion} (${input.environment.architecture})`,
    `Build: ${input.environment.buildMode}`,
    `Tabs: total=${tabs.total}, document=${tabs.document}, mermaid=${tabs.mermaid}, image=${tabs.image}, error=${tabs.error}, loading=${tabs.loading}`,
    `Workspace: roots=${input.state.workspaceRoots.length}, expanded-nodes=${input.expandedNodeCount}`,
    `Quick Open: ${input.quickOpenStatus}, unavailable-roots=${unavailable}, truncated-roots=${truncated}`,
    `UI: appearance=${formatAppearance(input.state.theme)}, resolved=${input.resolvedAppearance}, palette=${formatPalette(input.state.colorTheme)}`,
    `Recent error: operation=${recent?.operation ?? "none"}, code=${recent?.code ?? "none"}`,
  ];
  return `${lines.join("\n")}\n`;
}

function formatAppearance(theme: ThemeMode): string {
  return theme;
}

function formatPalette(palette: ColorTheme): string {
  return palette;
}

function normalizeErrorCode(error: unknown): string {
  if (typeof error === "string" && error.trim()) return extractErrorCode(error);
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return extractErrorCode(message);
  }
  return "unknown";
}

function extractErrorCode(message: string): string {
  const trimmed = message.trim();
  const separator = trimmed.indexOf(":");
  const candidate = (separator >= 0 ? trimmed.slice(0, separator) : trimmed).trim();

  // Never sanitize arbitrary prose into a code: doing so can preserve private
  // usernames, directory names, and filenames from a raw error message.
  return /^[a-z][a-z0-9_-]{0,63}$/i.test(candidate)
    ? candidate.toLowerCase()
    : "unknown";
}

function redactOperation(operation: string): string {
  return operation
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "unknown";
}
