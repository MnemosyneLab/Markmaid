export type ThemeMode = "system" | "light" | "dark";
export type TabPlacement = "top" | "left";
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
  html: string;
  modifiedAtMs: number;
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
export type AppTab = DocumentTab | SettingsTab;

export interface AppState {
  tabs: AppTab[];
  activeTabKey: string | null;
  theme: ThemeMode;
  tabPlacement: TabPlacement;
  sidebarWidth: number;
  mermaidLightTheme: MermaidLightTheme;
  mermaidDarkTheme: MermaidDarkTheme;
  textFont: TextFont;
  codeFont: CodeFont;
  pageWidth: PageWidth;
  recentDocuments: string[];
}

export type PersistedTab =
  | { kind: "document"; path: string; scrollTop: number }
  | { kind: "settings" };

export interface PersistedSessionV1 {
  version: 1;
  tabs: PersistedTab[];
  activeTabKey: string | null;
  theme: ThemeMode;
  tabPlacement: TabPlacement;
  sidebarWidth?: number;
  mermaidLightTheme?: MermaidLightTheme;
  mermaidDarkTheme?: MermaidDarkTheme;
  textFont?: TextFont;
  codeFont?: CodeFont;
  pageWidth?: PageWidth;
  recentDocuments?: string[];
  // Kept for one-time migration from the earlier light/dark selector.
  mermaidTheme?: "light" | "dark";
}
