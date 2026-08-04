import type {
  AppTab,
  ColorTheme,
  DocumentTab,
  ImageTab,
  MermaidTab,
  ThemeMode,
} from "./types";

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

const COLOR_THEME_LABELS: Record<ColorTheme, string> = {
  default: "Default",
  solarized: "Solarized",
  nord: "Nord",
  gruvbox: "Gruvbox",
  catppuccin: "Catppuccin",
  "high-contrast": "High Contrast",
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
): string {
  const palette =
    colorTheme === "default" ? "System" : COLOR_THEME_LABELS[colorTheme];
  const mode = appearance === "dark" ? "Dark" : "Light";
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

export function formatModifiedAt(modifiedAtMs: number, now = new Date()): string {
  if (!Number.isFinite(modifiedAtMs) || modifiedAtMs <= 0) return "Unknown";
  const date = new Date(modifiedAtMs);
  const datePart = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  void now;
  return `Modified ${datePart}, ${timePart}`;
}

export function buildStatusBar(
  tab: AppTab | null,
  options: {
    colorTheme: ColorTheme;
    theme: ThemeMode;
    systemDark: boolean;
    loadingLabel?: string;
    externalChange?: {
      kind: "changed" | "unavailable";
      message: string;
    } | null;
  },
): StatusBarModel {
  const appearance = resolveAppearance(options.theme, options.systemDark);
  const themeLabel = formatThemeLabel(options.colorTheme, appearance);

  if (!tab) {
    return {
      left: "No preview open",
      right: themeLabel,
      alert: null,
    };
  }

  if (tab.kind === "settings") {
    return {
      left: "Settings",
      right: themeLabel,
      alert: null,
    };
  }

  if (tab.status === "loading") {
    return {
      left: `${tab.displayName} · Loading preview…`,
      right: themeLabel,
      alert: null,
    };
  }

  if (tab.status === "error") {
    return {
      left: `Error · ${tab.code}`,
      right: themeLabel,
      alert: null,
    };
  }

  if (tab.kind === "document") {
    return markdownStatus(tab, themeLabel, options.externalChange ?? null);
  }
  if (tab.kind === "mermaid") {
    return mermaidStatus(tab, themeLabel);
  }
  return imageStatus(tab, themeLabel);
}

function markdownStatus(
  tab: DocumentTab & { status: "ready" },
  themeLabel: string,
  externalChange: { kind: "changed" | "unavailable"; message: string } | null,
): StatusBarModel {
  const lines = countLines(tab.source);
  const words = countWords(tab.source);
  const characters = countUnicodeCharacters(tab.source);
  return {
    left: `Markdown Preview · ${formatCount(lines)} lines · ${formatCount(words)} words · ${formatCount(characters)} characters`,
    right: `${formatFileSize(tab.sizeBytes)} · ${formatModifiedAt(tab.modifiedAtMs)} · ${themeLabel}`,
    alert: documentAlert(tab, externalChange),
  };
}

function documentAlert(
  tab: DocumentTab & { status: "ready" },
  externalChange: { kind: "changed" | "unavailable"; message: string } | null,
): StatusBarAlert | null {
  if (tab.reloadError) {
    return {
      kind: "reload-error",
      title: "Reload failed.",
      detail: `${tab.reloadError} The previous preview is still shown.`,
      actions: ["reload"],
    };
  }
  if (!externalChange) return null;
  if (externalChange.kind === "changed") {
    return {
      kind: "changed",
      title: "File changed on disk.",
      detail: stripLeadingSentence(externalChange.message),
      actions: ["reload", "ignore"],
    };
  }
  return {
    kind: "unavailable",
    title: "File unavailable.",
    detail: stripLeadingSentence(externalChange.message),
    actions: ["reload", "ignore"],
  };
}

function stripLeadingSentence(message: string): string {
  return message.replace(/^[^.]+\.\s*/, "");
}

function mermaidStatus(tab: MermaidTab & { status: "ready" }, themeLabel: string): StatusBarModel {
  const lines = countLines(tab.source);
  const characters = countUnicodeCharacters(tab.source);
  return {
    left: `Mermaid Preview · ${formatCount(lines)} lines · ${formatCount(characters)} characters`,
    right: `${formatFileSize(tab.sizeBytes)} · ${formatModifiedAt(tab.modifiedAtMs)} · ${themeLabel}`,
    alert: null,
  };
}

function imageStatus(tab: ImageTab & { status: "ready" }, themeLabel: string): StatusBarModel {
  const dimensions = tab.dimensions
    ? ` · ${tab.dimensions.width}×${tab.dimensions.height}`
    : "";
  return {
    left: `Image Preview${dimensions}`,
    right: `${formatFileSize(tab.sizeBytes)} · ${formatModifiedAt(tab.modifiedAtMs)} · ${themeLabel}`,
    alert: null,
  };
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined).format(value);
}

function trimTrailingZero(value: string): string {
  return value.replace(/\.0$/, "");
}
