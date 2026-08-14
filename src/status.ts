import type {
  AppTab,
  ColorTheme,
  DocumentTab,
  ImageTab,
  MermaidTab,
  ThemeMode,
} from "./types";
import { message, type MessageKey, type Translator } from "./i18n";

export type StatusAppearance = "light" | "dark";

export type StatusBarAlertKind = "changed" | "unavailable" | "reload-error";

export interface StatusBarAlert {
  kind: StatusBarAlertKind;
  title: string;
  detail: string;
  actions: Array<"reload" | "ignore">;
}

export interface StatusBarModel {
  left: string;
  right: string;
  alert: StatusBarAlert | null;
}

const COLOR_THEME_MESSAGE_KEYS: Record<ColorTheme, MessageKey> = {
  default: "status.theme.default",
  solarized: "status.theme.solarized",
  nord: "status.theme.nord",
  gruvbox: "status.theme.gruvbox",
  catppuccin: "status.theme.catppuccin",
  "high-contrast": "status.theme.highContrast",
};

export function resolveAppearance(
  theme: ThemeMode,
  systemDark: boolean,
): StatusAppearance {
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}

export function formatThemeLabel(
  colorTheme: ColorTheme,
  appearance: StatusAppearance,
  translator?: Translator,
): string {
  const palette = message(COLOR_THEME_MESSAGE_KEYS[colorTheme], translator);
  const mode = message(
    appearance === "dark" ? "status.appearance.dark" : "status.appearance.light",
    translator,
  );
  return `${palette} · ${mode}`;
}

export function countUnicodeCharacters(source: string): number {
  return Array.from(source).length;
}

export function countLines(source: string): number {
  if (source.length === 0) return 0;
  let lines = 1;
  for (const character of source) {
    if (character === "\n") lines += 1;
  }
  return lines;
}

export function countWords(source: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
      let count = 0;
      for (const segment of segmenter.segment(source)) {
        if (segment.isWordLike) count += 1;
      }
      return count;
    } catch {
      // Fall through to whitespace splitting.
    }
  }
  return source
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0).length;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  if (unitIndex === 0) return `${Math.round(value)} B`;
  const rounded = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${trimTrailingZero(rounded)} ${units[unitIndex]}`;
}

export function formatModifiedAt(
  modifiedAtMs: number,
  now = new Date(),
  translator?: Translator,
): string {
  if (!Number.isFinite(modifiedAtMs) || modifiedAtMs <= 0) {
    return message("status.unknown", translator);
  }
  const date = new Date(modifiedAtMs);
  const locale = translator?.locale === "zh-Hans" ? "zh-CN" : undefined;
  const datePart = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  void now;
  return message("status.modified", translator, { date: datePart, time: timePart });
}

export function buildStatusBar(
  tab: AppTab | null,
  options: {
    colorTheme: ColorTheme;
    theme: ThemeMode;
    systemDark: boolean;
    translator?: Translator;
    loadingLabel?: string;
    externalChange?: {
      kind: "changed" | "unavailable";
      message: string;
    } | null;
  },
): StatusBarModel {
  const appearance = resolveAppearance(options.theme, options.systemDark);
  const themeLabel = formatThemeLabel(
    options.colorTheme,
    appearance,
    options.translator,
  );

  if (!tab) {
    return {
      left: message("status.noPreview", options.translator),
      right: themeLabel,
      alert: null,
    };
  }

  if (tab.kind === "settings") {
    return {
      left: message("status.settings", options.translator),
      right: themeLabel,
      alert: null,
    };
  }

  if (tab.status === "loading") {
    return {
      left: message("status.loadingPreview", options.translator, {
        name: tab.displayName,
      }),
      right: themeLabel,
      alert: null,
    };
  }

  if (tab.status === "error") {
    return {
      left: message("status.error", options.translator, { code: tab.code }),
      right: themeLabel,
      alert: null,
    };
  }

  if (tab.kind === "document") {
    return markdownStatus(
      tab,
      themeLabel,
      options.externalChange ?? null,
      options.translator,
    );
  }
  if (tab.kind === "mermaid") {
    return mermaidStatus(tab, themeLabel, options.translator);
  }
  return imageStatus(tab, themeLabel, options.translator);
}

function markdownStatus(
  tab: DocumentTab & { status: "ready" },
  themeLabel: string,
  externalChange: { kind: "changed" | "unavailable"; message: string } | null,
  translator?: Translator,
): StatusBarModel {
  const lines = countLines(tab.source);
  const words = countWords(tab.source);
  const characters = countUnicodeCharacters(tab.source);
  return {
    left: message("status.markdownPreview", translator, {
      lines: formatCount(lines, translator),
      words: formatCount(words, translator),
      characters: formatCount(characters, translator),
    }),
    right: `${formatFileSize(tab.sizeBytes)} · ${formatModifiedAt(tab.modifiedAtMs, new Date(), translator)} · ${themeLabel}`,
    alert: documentAlert(tab, externalChange, translator),
  };
}

function documentAlert(
  tab: DocumentTab & { status: "ready" },
  externalChange: { kind: "changed" | "unavailable"; message: string } | null,
  translator?: Translator,
): StatusBarAlert | null {
  if (tab.reloadError) {
    return {
      kind: "reload-error",
      title: message("status.reloadFailed", translator),
      detail: `${tab.reloadError} ${message("status.previousPreview", translator)}`,
      actions: ["reload"],
    };
  }
  if (!externalChange) return null;
  if (externalChange.kind === "changed") {
    return {
      kind: "changed",
      title: message("status.fileChanged", translator),
      detail: stripLeadingSentence(externalChange.message),
      actions: ["reload", "ignore"],
    };
  }
  return {
    kind: "unavailable",
    title: message("status.fileUnavailable", translator),
    detail: stripLeadingSentence(externalChange.message),
    actions: ["reload", "ignore"],
  };
}

function stripLeadingSentence(message: string): string {
  return message.replace(/^[^.。]+[.。]\s*/u, "");
}

function mermaidStatus(
  tab: MermaidTab & { status: "ready" },
  themeLabel: string,
  translator?: Translator,
): StatusBarModel {
  const lines = countLines(tab.source);
  const characters = countUnicodeCharacters(tab.source);
  return {
    left: message("status.mermaidPreview", translator, {
      lines: formatCount(lines, translator),
      characters: formatCount(characters, translator),
    }),
    right: `${formatFileSize(tab.sizeBytes)} · ${formatModifiedAt(tab.modifiedAtMs, new Date(), translator)} · ${themeLabel}`,
    alert: null,
  };
}

function imageStatus(
  tab: ImageTab & { status: "ready" },
  themeLabel: string,
  translator?: Translator,
): StatusBarModel {
  const dimensions = tab.dimensions
    ? ` · ${tab.dimensions.width}×${tab.dimensions.height}`
    : "";
  return {
    left: message("status.imagePreview", translator, { dimensions }),
    right: `${formatFileSize(tab.sizeBytes)} · ${formatModifiedAt(tab.modifiedAtMs, new Date(), translator)} · ${themeLabel}`,
    alert: null,
  };
}

function formatCount(value: number, translator?: Translator): string {
  const locale = translator?.locale === "zh-Hans" ? "zh-CN" : undefined;
  return new Intl.NumberFormat(locale).format(value);
}

function trimTrailingZero(value: string): string {
  return value.replace(/\.0$/, "");
}
