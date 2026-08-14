import type { ResolvedUiLocale, UiLocalePreference } from "../types";
import {
  CHINESE_MESSAGES,
  ENGLISH_MESSAGES,
  type MessageKey,
} from "./messages";

export type { MessageKey };
export type MessageCatalog = Record<MessageKey, string>;
export type PartialMessageCatalog = Partial<Record<MessageKey, string>>;

export interface Translator {
  locale: ResolvedUiLocale;
  t(key: MessageKey, vars?: Record<string, string | number>): string;
}

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

export function resolveUiLocale(
  preference: UiLocalePreference,
  languages: readonly string[],
): ResolvedUiLocale {
  if (preference === "en" || preference === "zh-Hans") return preference;
  for (const language of languages) {
    const resolved = resolveLanguageTag(language);
    if (resolved) return resolved;
  }
  return "en";
}

function resolveLanguageTag(tag: string): ResolvedUiLocale | null {
  const normalized = tag.trim().toLowerCase().replaceAll("_", "-");
  if (!normalized) return null;
  const parts = normalized.split("-");
  const language = parts[0];
  const regionOrScript = parts[1];
  if (language === "en") return "en";
  if (language !== "zh") return null;
  if (
    regionOrScript === "hant" ||
    regionOrScript === "tw" ||
    regionOrScript === "hk" ||
    regionOrScript === "mo"
  ) {
    return null;
  }
  if (
    !regionOrScript ||
    regionOrScript === "hans" ||
    regionOrScript === "cn" ||
    regionOrScript === "sg"
  ) {
    return "zh-Hans";
  }
  return null;
}

export function createTranslator(
  locale: ResolvedUiLocale,
  catalogs: {
    en?: PartialMessageCatalog;
    "zh-Hans"?: PartialMessageCatalog;
  } = {},
): Translator {
  const english = { ...ENGLISH_MESSAGES, ...catalogs.en };
  const selected =
    locale === "zh-Hans"
      ? { ...CHINESE_MESSAGES, ...catalogs["zh-Hans"] }
      : english;

  return {
    locale,
    t(key, vars = {}) {
      const template = selected[key] ?? english[key] ?? ENGLISH_MESSAGES[key];
      return interpolate(template, vars, key);
    },
  };
}

export function interpolate(
  template: string,
  vars: Record<string, string | number>,
  key?: string,
): string {
  const used = new Set<string>();
  const result = template.replace(PLACEHOLDER, (_match, name: string) => {
    if (!(name in vars)) {
      throw new Error(
        `Missing interpolation value "${name}"${key ? ` for ${key}` : ""}`,
      );
    }
    used.add(name);
    return String(vars[name]);
  });
  for (const name of Object.keys(vars)) {
    if (!used.has(name)) {
      throw new Error(
        `Unknown interpolation placeholder "${name}"${key ? ` for ${key}` : ""}`,
      );
    }
  }
  return result;
}

export function message(
  key: MessageKey,
  translator?: Translator,
  vars?: Record<string, string | number>,
): string {
  if (translator) return translator.t(key, vars);
  return interpolate(ENGLISH_MESSAGES[key], vars ?? {}, key);
}

export { CHINESE_MESSAGES, ENGLISH_MESSAGES };
