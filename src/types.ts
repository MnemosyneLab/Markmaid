export type ThemeMode = "system" | "light" | "dark";
export type ColorTheme =
  | "default"
  | "solarized"
  | "nord"
  | "gruvbox"
  | "catppuccin"
  | "high-contrast";
export type TabPlacement = "top" | "left";
export type SidebarView = "files" | "tabs";
export type TextFont = string;
export type CodeFont = string;
export type PageWidth =
  | "default"
  | "narrow"
  | "comfortable"
  | "wide"
  | "extra-wide"
  | "full";
export type MermaidLightTheme =
  | "default"
  | "base"
  | "forest"
  | "neutral"
  | "neo"
  | "redux"
  | "redux-color";
export type MermaidDarkTheme =
  | "dark"
  | "neo-dark"
  | "redux-dark"
  | "redux-dark-color";
export type MermaidTheme = MermaidLightTheme | MermaidDarkTheme;

export interface ImageAsset {
  token: string;
  original: string;
  path: string | null;
}

export interface ReadyDocumentResult {
  status: "ready";
  requestedPath: string;
  canonicalPath: string;
  displayName: string;
  source: string;
  html: string;
  modifiedAtMs: number;
  sizeBytes: number;
  imageAssets: ImageAsset[];
}

export interface ErrorDocumentResult {
  status: "error";
  requestedPath: string;
  canonicalPath: string | null;
  displayName: string;
  code: string;
  message: string;
}

export type DocumentLoadResult = ReadyDocumentResult | ErrorDocumentResult;

export interface DocumentNavigationEntry {
  path: string;
  scrollTop: number;
  fragment?: string;
}

export interface ReadyDocumentTab extends ReadyDocumentResult {
  kind: "document";
  key: string;
  scrollTop: number;
  reloadError: string | null;
}

export interface ErrorDocumentTab extends ErrorDocumentResult {
  kind: "document";
  key: string;
  scrollTop: number;
}

export interface LoadingDocumentTab {
  kind: "document";
  key: string;
  status: "loading";
  requestedPath: string;
  displayName: string;
  scrollTop: number;
}

export interface SettingsTab {
  kind: "settings";
  key: "settings";
}

export type DocumentTab =
  | ReadyDocumentTab
  | ErrorDocumentTab
  | LoadingDocumentTab;

export interface ReadyMermaidTab {
  kind: "mermaid";
  key: string;
  status: "ready";
  canonicalPath: string;
  displayName: string;
  source: string;
  html: string;
  sizeBytes: number;
  modifiedAtMs: number;
  scrollTop: number;
}

export interface LoadingMermaidTab {
  kind: "mermaid";
  key: string;
  status: "loading";
  requestedPath: string;
  displayName: string;
  scrollTop: number;
}

export interface ErrorMermaidTab {
  kind: "mermaid";
  key: string;
  status: "error";
  requestedPath: string;
  canonicalPath: string | null;
  displayName: string;
  code: string;
  message: string;
  scrollTop: number;
}

export type MermaidTab = ReadyMermaidTab | LoadingMermaidTab | ErrorMermaidTab;

export interface ReadyImageTab {
  kind: "image";
  key: string;
  status: "ready";
  canonicalPath: string;
  displayName: string;
  assetUrl: string;
  sizeBytes: number;
  modifiedAtMs: number;
  dimensions: { width: number; height: number } | null;
  scrollTop: number;
}

export interface LoadingImageTab {
  kind: "image";
  key: string;
  status: "loading";
  requestedPath: string;
  displayName: string;
  scrollTop: number;
}

export interface ErrorImageTab {
  kind: "image";
  key: string;
  status: "error";
  requestedPath: string;
  canonicalPath: string | null;
  displayName: string;
  code: string;
  message: string;
  scrollTop: number;
}

export type ImageTab = ReadyImageTab | LoadingImageTab | ErrorImageTab;

export type PreviewTab = DocumentTab | MermaidTab | ImageTab;
export type AppTab = PreviewTab | SettingsTab;

export interface ClosedTab {
  kind: PreviewTab["kind"];
  path: string;
  scrollTop: number;
  index: number;
}

export type WorkspaceEntryKind = "directory" | "markdown" | "mermaid" | "image";

export interface WorkspaceRoot {
  id: string;
  canonicalPath: string;
  displayName: string;
}

export interface WorkspaceEntry {
  rootId: string;
  relativePath: string;
  canonicalPath: string;
  name: string;
  kind: WorkspaceEntryKind;
  sizeBytes?: number;
  modifiedAtMs?: number;
  hasVisibleChildren?: boolean;
}

export interface WorkspaceMutation {
  oldPath: string;
  newPath: string | null;
  affectedDirectoryPaths: string[];
  removedPathPrefix: string | null;
}

export interface MermaidPreview {
  status: "ready" | "error";
  requestedPath: string;
  canonicalPath: string;
  displayName: string;
  source: string;
  html: string;
  sizeBytes: number;
  modifiedAtMs: number;
  code?: string;
  message?: string;
}

export interface ImagePreview {
  status: "ready" | "error";
  requestedPath: string;
  canonicalPath: string;
  displayName: string;
  path: string;
  sizeBytes: number;
  modifiedAtMs: number;
  code?: string;
  message?: string;
}

export type PreviewLoadResult =
  | { kind: "document"; result: DocumentLoadResult }
  | { kind: "mermaid"; result: MermaidPreview }
  | { kind: "image"; result: ImagePreview }
  | {
      kind: "unsupported";
      requestedPath: string;
      displayName: string;
      code: string;
      message: string;
    };

export interface WorkspaceMarkdownEntry {
  rootId: string;
  canonicalPath: string;
  relativePath: string;
  name: string;
}

export interface WorkspaceMarkdownIndex {
  entries: WorkspaceMarkdownEntry[];
  unavailableRootIds: string[];
  truncatedRootIds: string[];
}

/**
 * Tagged outcome for cooperatively cancellable native commands. A
 * cancellation carries no payload and must never be treated as an error.
 */
export type TaskOutcome<T> =
  | { status: "completed"; result: T }
  | { status: "cancelled" };

export interface PreviewTaskRequest {
  taskId: string;
  path: string;
}

export type PreviewTaskOutcome =
  | { status: "completed"; taskId: string; result: PreviewLoadResult }
  | { status: "cancelled"; taskId: string };

export interface AppState {
  tabs: AppTab[];
  activeTabKey: string | null;
  closedTabsHistory: ClosedTab[];
  documentVisitHistory: DocumentNavigationEntry[];
  documentVisitHistoryIndex: number;
  theme: ThemeMode;
  colorTheme: ColorTheme;
  tabPlacement: TabPlacement;
  sidebarView: SidebarView;
  sidebarWidth: number;
  tableOfContentsWidth: number;
  leftSidebarVisible: boolean;
  workspaceRoots: WorkspaceRoot[];
  expandedWorkspacePaths: Record<string, string[]>;
  mermaidLightTheme: MermaidLightTheme;
  mermaidDarkTheme: MermaidDarkTheme;
  textFont: TextFont;
  codeFont: CodeFont;
  pageWidth: PageWidth;
  tableOfContentsVisible: boolean;
  recentDocuments: string[];
}

export type PersistedTab =
  | { kind: "document"; path: string; scrollTop: number }
  | { kind: "mermaid"; path: string; scrollTop: number }
  | { kind: "image"; path: string; scrollTop: number }
  | { kind: "settings" };

export interface PersistedSessionV1 {
  version: 1;
  tabs: PersistedTab[];
  activeTabKey: string | null;
  theme: ThemeMode;
  colorTheme?: ColorTheme;
  tabPlacement: TabPlacement;
  sidebarView?: SidebarView;
  sidebarWidth?: number;
  tableOfContentsWidth?: number;
  leftSidebarVisible?: boolean;
  workspaceRoots?: WorkspaceRoot[];
  expandedWorkspacePaths?: Record<string, string[]>;
  mermaidLightTheme?: MermaidLightTheme;
  mermaidDarkTheme?: MermaidDarkTheme;
  textFont?: TextFont;
  codeFont?: CodeFont;
  pageWidth?: PageWidth;
  tableOfContentsVisible?: boolean;
  recentDocuments?: string[];
  // Kept for one-time migration from the earlier light/dark selector.
  mermaidTheme?: "light" | "dark";
}

export type ExportFormat = "html" | "pdf";
export type ExportPaperSize = "a4" | "a5";
export type ExportOrientation = "portrait" | "landscape";
export type ExportMargins = "normal" | "compact" | "wide";

export interface ExportConfig {
  format: ExportFormat;
  paperSize: ExportPaperSize;
  orientation: ExportOrientation;
  margins: ExportMargins;
}
