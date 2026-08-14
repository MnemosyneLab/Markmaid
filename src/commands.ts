import type { Translator } from "./i18n";
import type { MessageKey } from "./i18n/messages";

export type CommandId =
  | "file.open-preview-files"
  | "workspace.add-folder"
  | "file.quick-open"
  | "file.toggle-favorite"
  | "file.open-favorites"
  | "file.export-document"
  | "file.reload-document"
  | "file.reveal-in-finder"
  | "external.open-preferred"
  | "external.choose-application"
  | "tabs.close"
  | "tabs.reopen-closed"
  | "tabs.next"
  | "tabs.previous"
  | "tabs.move-up"
  | "tabs.move-down"
  | "view.toggle-focus-mode"
  | "view.show-sidebar"
  | "view.hide-sidebar"
  | "view.show-outline"
  | "view.hide-outline"
  | "appearance.system"
  | "appearance.light"
  | "appearance.dark"
  | "appearance.palette.default"
  | "appearance.palette.solarized"
  | "appearance.palette.nord"
  | "appearance.palette.gruvbox"
  | "appearance.palette.catppuccin"
  | "appearance.palette.high-contrast"
  | "application.settings"
  | "application.copy-diagnostics"
  | "annotations.add-bookmark"
  | "annotations.show-bookmarks"
  | "annotations.highlight-find-match"
  | "annotations.add-note"
  | "annotations.manage";

export type CommandSection =
  | "File"
  | "External"
  | "Tabs"
  | "View"
  | "Appearance"
  | "Application"
  | "Annotations";

export type CommandAvailability =
  | { state: "hidden" }
  | { state: "disabled"; reason: string }
  | { state: "enabled" };

export const COMMAND_ENABLED: CommandAvailability = { state: "enabled" };
export const COMMAND_HIDDEN: CommandAvailability = { state: "hidden" };

export interface AppCommand<TContext> {
  id: CommandId;
  label: string;
  section: string;
  keywords: readonly string[];
  shortcutLabel?: string;
  availability(context: TContext): CommandAvailability;
  execute(context: TContext): void | Promise<void>;
}

export interface CommandMetadata {
  id: CommandId;
  label: string;
  section: string;
  keywords: readonly string[];
  shortcutLabel?: string;
}

export interface CommandCatalogHandlers<TContext> {
  availability(id: CommandId, context: TContext): CommandAvailability;
  execute(id: CommandId, context: TContext): void | Promise<void>;
}

export interface CommandSearchResult<TContext> {
  command: AppCommand<TContext>;
  availability: Exclude<CommandAvailability, { state: "hidden" }>;
  score: number;
  catalogIndex: number;
}

export interface CommandSearchOptions {
  limit?: number;
  recommendedCommandIds?: readonly CommandId[];
  contextualCommandId?: CommandId | null;
}

export const COMMAND_RESULT_LIMIT = 50;

export const DEFAULT_RECOMMENDED_COMMAND_IDS: readonly CommandId[] = [
  "view.toggle-focus-mode",
  "file.open-preview-files",
  "file.quick-open",
];

/**
 * Static, user-content-free command metadata. Keep this order stable because it
 * is the deterministic tie-breaker for search ranking.
 */
export const COMMAND_CATALOG_METADATA: readonly CommandMetadata[] = [
  {
    id: "file.open-preview-files",
    label: "Open Preview Files",
    section: "File",
    keywords: ["open", "markdown", "mermaid", "image", "file"],
    shortcutLabel: "⌘O",
  },
  {
    id: "workspace.add-folder",
    label: "Add Folder",
    section: "File",
    keywords: ["workspace", "root", "directory"],
  },
  {
    id: "file.quick-open",
    label: "Quick Open",
    section: "File",
    keywords: ["workspace", "file", "search"],
    shortcutLabel: "⌘P",
  },
  {
    id: "file.toggle-favorite",
    label: "Toggle Favorite",
    section: "File",
    keywords: ["pin", "star", "favorite", "bookmark"],
  },
  {
    id: "file.open-favorites",
    label: "Open Favorites",
    section: "File",
    keywords: ["pin", "star", "favorite", "quick open"],
  },
  {
    id: "file.export-document",
    label: "Export Document",
    section: "File",
    keywords: ["pdf", "html", "save", "print"],
  },
  {
    id: "file.reload-document",
    label: "Reload Document",
    section: "File",
    keywords: ["refresh", "retry", "preview"],
    shortcutLabel: "⌘R",
  },
  {
    id: "file.reveal-in-finder",
    label: "Reveal in Finder",
    section: "File",
    keywords: ["show", "folder", "location"],
  },
  {
    id: "external.open-preferred",
    label: "Open in Preferred Application",
    section: "External",
    keywords: ["editor", "external", "application", "open with"],
  },
  {
    id: "external.choose-application",
    label: "Choose External Application",
    section: "External",
    keywords: ["editor", "external", "application", "open with"],
  },
  {
    id: "tabs.close",
    label: "Close Tab",
    section: "Tabs",
    keywords: ["document", "remove"],
    shortcutLabel: "⌘W",
  },
  {
    id: "tabs.reopen-closed",
    label: "Reopen Closed Tab",
    section: "Tabs",
    keywords: ["restore", "undo", "document"],
    shortcutLabel: "⇧⌘T",
  },
  {
    id: "tabs.next",
    label: "Next Tab",
    section: "Tabs",
    keywords: ["forward", "document"],
  },
  {
    id: "tabs.previous",
    label: "Previous Tab",
    section: "Tabs",
    keywords: ["back", "document"],
  },
  {
    id: "tabs.move-up",
    label: "Move Tab Up",
    section: "Tabs",
    keywords: ["reorder", "previous"],
  },
  {
    id: "tabs.move-down",
    label: "Move Tab Down",
    section: "Tabs",
    keywords: ["reorder", "next"],
  },
  {
    id: "view.toggle-focus-mode",
    label: "Toggle Focus Mode",
    section: "View",
    keywords: ["reading", "distraction", "zen"],
    shortcutLabel: "⇧⌘F",
  },
  {
    id: "view.show-sidebar",
    label: "Show Sidebar",
    section: "View",
    keywords: ["workspace", "files", "tabs", "navigation"],
  },
  {
    id: "view.hide-sidebar",
    label: "Hide Sidebar",
    section: "View",
    keywords: ["workspace", "files", "tabs", "navigation"],
  },
  {
    id: "view.show-outline",
    label: "Show Outline",
    section: "View",
    keywords: ["contents", "headings", "navigation"],
  },
  {
    id: "view.hide-outline",
    label: "Hide Outline",
    section: "View",
    keywords: ["contents", "headings", "navigation"],
  },
  {
    id: "appearance.system",
    label: "Use System Appearance",
    section: "Appearance",
    keywords: ["theme", "automatic", "macos"],
  },
  {
    id: "appearance.light",
    label: "Use Light Appearance",
    section: "Appearance",
    keywords: ["theme", "day"],
  },
  {
    id: "appearance.dark",
    label: "Use Dark Appearance",
    section: "Appearance",
    keywords: ["theme", "night"],
  },
  {
    id: "appearance.palette.default",
    label: "Use Default Color Palette",
    section: "Appearance",
    keywords: ["theme", "neutral", "blue"],
  },
  {
    id: "appearance.palette.solarized",
    label: "Use Solarized Color Palette",
    section: "Appearance",
    keywords: ["theme", "warm", "contrast"],
  },
  {
    id: "appearance.palette.nord",
    label: "Use Nord Color Palette",
    section: "Appearance",
    keywords: ["theme", "cool", "arctic"],
  },
  {
    id: "appearance.palette.gruvbox",
    label: "Use Gruvbox Color Palette",
    section: "Appearance",
    keywords: ["theme", "warm", "retro"],
  },
  {
    id: "appearance.palette.catppuccin",
    label: "Use Catppuccin Color Palette",
    section: "Appearance",
    keywords: ["theme", "pastel"],
  },
  {
    id: "appearance.palette.high-contrast",
    label: "Use High Contrast Color Palette",
    section: "Appearance",
    keywords: ["theme", "accessible", "black", "white"],
  },
  {
    id: "application.settings",
    label: "Open Settings",
    section: "Application",
    keywords: ["preferences", "configuration"],
    shortcutLabel: "⌘,",
  },
  {
    id: "application.copy-diagnostics",
    label: "Copy Diagnostics",
    section: "Application",
    keywords: ["support", "debug", "report", "clipboard"],
  },
  {
    id: "annotations.add-bookmark",
    label: "Add Bookmark",
    section: "Annotations",
    keywords: ["bookmark", "scroll", "heading"],
  },
  {
    id: "annotations.show-bookmarks",
    label: "Show Bookmarks",
    section: "Annotations",
    keywords: ["bookmark", "list", "jump"],
  },
  {
    id: "annotations.highlight-find-match",
    label: "Highlight Find Match",
    section: "Annotations",
    keywords: ["highlight", "find", "mark"],
  },
  {
    id: "annotations.add-note",
    label: "Add Note",
    section: "Annotations",
    keywords: ["note", "comment", "private"],
  },
  {
    id: "annotations.manage",
    label: "Manage Annotations",
    section: "Annotations",
    keywords: ["bookmark", "highlight", "note", "manage"],
  },
];

const COMMAND_LABEL_KEYS: Record<CommandId, MessageKey> = {
  "file.open-preview-files": "command.file.open-preview-files",
  "workspace.add-folder": "command.workspace.add-folder",
  "file.quick-open": "command.file.quick-open",
  "file.toggle-favorite": "command.file.toggle-favorite",
  "file.open-favorites": "command.file.open-favorites",
  "file.export-document": "command.file.export-document",
  "file.reload-document": "command.file.reload-document",
  "file.reveal-in-finder": "command.file.reveal-in-finder",
  "external.open-preferred": "command.external.open-preferred",
  "external.choose-application": "command.external.choose-application",
  "tabs.close": "command.tabs.close",
  "tabs.reopen-closed": "command.tabs.reopen-closed",
  "tabs.next": "command.tabs.next",
  "tabs.previous": "command.tabs.previous",
  "tabs.move-up": "command.tabs.move-up",
  "tabs.move-down": "command.tabs.move-down",
  "view.toggle-focus-mode": "command.view.toggle-focus-mode",
  "view.show-sidebar": "command.view.show-sidebar",
  "view.hide-sidebar": "command.view.hide-sidebar",
  "view.show-outline": "command.view.show-outline",
  "view.hide-outline": "command.view.hide-outline",
  "appearance.system": "command.appearance.system",
  "appearance.light": "command.appearance.light",
  "appearance.dark": "command.appearance.dark",
  "appearance.palette.default": "command.appearance.palette.default",
  "appearance.palette.solarized": "command.appearance.palette.solarized",
  "appearance.palette.nord": "command.appearance.palette.nord",
  "appearance.palette.gruvbox": "command.appearance.palette.gruvbox",
  "appearance.palette.catppuccin": "command.appearance.palette.catppuccin",
  "appearance.palette.high-contrast": "command.appearance.palette.high-contrast",
  "application.settings": "command.application.settings",
  "application.copy-diagnostics": "command.application.copy-diagnostics",
  "annotations.add-bookmark": "command.annotations.add-bookmark",
  "annotations.show-bookmarks": "command.annotations.show-bookmarks",
  "annotations.highlight-find-match": "command.annotations.highlight-find-match",
  "annotations.add-note": "command.annotations.add-note",
  "annotations.manage": "command.annotations.manage",
};

const COMMAND_SECTION_KEYS: Record<CommandSection, MessageKey> = {
  File: "section.file",
  External: "section.external",
  Tabs: "section.tabs",
  View: "section.view",
  Appearance: "section.appearance",
  Application: "section.application",
  Annotations: "section.annotations",
};

export function createCommandCatalogMetadata(
  t: Translator,
): readonly CommandMetadata[] {
  return COMMAND_CATALOG_METADATA.map((command) => ({
    ...command,
    label: t.t(COMMAND_LABEL_KEYS[command.id]),
    section: t.t(COMMAND_SECTION_KEYS[command.section as CommandSection]),
    keywords:
      t.locale === "zh-Hans"
        ? uniqueKeywords([
            ...t.t(COMMAND_LABEL_KEYS[command.id]).split(/\s+/u).filter(Boolean),
            ...command.keywords,
          ])
        : command.keywords,
  }));
}

function uniqueKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const keyword of keywords) {
    const key = keyword.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

export function createCommandCatalog<TContext>(
  handlers: CommandCatalogHandlers<TContext>,
  metadata: readonly CommandMetadata[] = COMMAND_CATALOG_METADATA,
): readonly AppCommand<TContext>[] {
  return metadata.map((item) => ({
    ...item,
    availability: (context) => handlers.availability(item.id, context),
    execute: (context) => handlers.execute(item.id, context),
  }));
}

/** Normalize canonically equivalent input and make accent-insensitive matching deterministic. */
export function normalizeCommandSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/gu, " ");
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

function fieldScore(
  token: string,
  value: string,
  kind: "label" | "keyword" | "section",
): number {
  if (!value) return -1;
  if (kind === "label") {
    if (value === token) return 1_400;
    if (value.startsWith(token)) return 1_300;
    if (value.split(" ").some((word) => word.startsWith(token))) return 1_100;
    if (value.includes(token)) return 900;
    if (isSubsequence(token, value)) return 600;
    return -1;
  }
  if (kind === "keyword") {
    if (value === token) return 850;
    if (value.startsWith(token)) return 800;
    if (value.includes(token)) return 700;
    if (isSubsequence(token, value)) return 500;
    return -1;
  }
  if (value === token) return 650;
  if (value.startsWith(token)) return 600;
  if (value.includes(token)) return 450;
  return isSubsequence(token, value) ? 300 : -1;
}

function commandMatchScore<TContext>(
  command: AppCommand<TContext>,
  normalizedQuery: string,
): number | null {
  const label = normalizeCommandSearchText(command.label);
  const section = normalizeCommandSearchText(command.section);
  const keywords = command.keywords.map(normalizeCommandSearchText);
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  let total =
    label === normalizedQuery
      ? 2_000
      : label.startsWith(normalizedQuery)
        ? 1_000
        : 0;

  for (const token of tokens) {
    const score = Math.max(
      fieldScore(token, label, "label"),
      fieldScore(token, section, "section"),
      ...keywords.map((keyword) => fieldScore(token, keyword, "keyword")),
    );
    if (score < 0) return null;
    total += score;
  }
  return total;
}

function visibleResult<TContext>(
  command: AppCommand<TContext>,
  context: TContext,
  catalogIndex: number,
  score: number,
): CommandSearchResult<TContext> | null {
  const availability = command.availability(context);
  if (availability.state === "hidden") return null;
  return { command, availability, score, catalogIndex };
}

export function searchCommands<TContext>(
  catalog: readonly AppCommand<TContext>[],
  context: TContext,
  query: string,
  options: CommandSearchOptions = {},
): readonly CommandSearchResult<TContext>[] {
  const limit = Math.max(
    0,
    Math.min(options.limit ?? COMMAND_RESULT_LIMIT, COMMAND_RESULT_LIMIT),
  );
  const normalizedQuery = normalizeCommandSearchText(query);

  if (!normalizedQuery) {
    const recommended = [
      ...(options.recommendedCommandIds ?? DEFAULT_RECOMMENDED_COMMAND_IDS),
      ...(options.contextualCommandId ? [options.contextualCommandId] : []),
      ...catalog.map((command) => command.id),
    ];
    const seen = new Set<CommandId>();
    const byId = new Map(
      catalog.map((command, index) => [command.id, { command, index }]),
    );
    const results: CommandSearchResult<TContext>[] = [];
    for (const id of recommended) {
      if (seen.has(id)) continue;
      seen.add(id);
      const entry = byId.get(id);
      if (!entry) continue;
      const result = visibleResult(entry.command, context, entry.index, 0);
      if (result) results.push(result);
      if (results.length === limit) break;
    }
    return results;
  }

  return catalog
    .map((command, catalogIndex) => {
      const score = commandMatchScore(command, normalizedQuery);
      return score === null
        ? null
        : visibleResult(command, context, catalogIndex, score);
    })
    .filter((result): result is CommandSearchResult<TContext> => result !== null)
    .sort(
      (left, right) =>
        right.score - left.score || left.catalogIndex - right.catalogIndex,
    )
    .slice(0, limit);
}
