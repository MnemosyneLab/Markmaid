export type ThemeMode = "system" | "light" | "dark";
export type TabPlacement = "top" | "left";

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
}
