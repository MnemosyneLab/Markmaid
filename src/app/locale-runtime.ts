import {
  createCommandCatalog,
  createCommandCatalogMetadata,
  type AppCommand,
  type CommandCatalogHandlers,
} from "../commands";
import {
  createTranslator,
  resolveUiLocale,
  type Translator,
} from "../i18n";
import type { ResolvedUiLocale, UiLocalePreference } from "../types";

export interface LocaleRuntime<TContext> {
  translator(): Translator;
  resolved(): ResolvedUiLocale;
  refresh(): Translator;
  catalog(): readonly AppCommand<TContext>[];
  bindSystemLanguageChange(): void;
}

export interface LocaleRuntimeDeps<TContext> {
  getPreference: () => UiLocalePreference;
  languages?: () => readonly string[];
  handlers: CommandCatalogHandlers<TContext>;
  onResolvedChange?: (locale: ResolvedUiLocale) => void;
}

export function createLocaleRuntime<TContext>(
  deps: LocaleRuntimeDeps<TContext>,
): LocaleRuntime<TContext> {
  let translator = createTranslator("en");
  let resolved: ResolvedUiLocale = "en";
  let catalog = createCommandCatalog(
    deps.handlers,
    createCommandCatalogMetadata(translator),
  );
  let ready = false;

  function refresh(): Translator {
    const next = resolveUiLocale(
      deps.getPreference(),
      deps.languages?.() ??
        (typeof navigator === "undefined" ? ["en"] : navigator.languages),
    );
    const changed = next !== resolved;
    resolved = next;
    translator = createTranslator(next);
    catalog = createCommandCatalog(
      deps.handlers,
      createCommandCatalogMetadata(translator),
    );
    if (ready && changed) deps.onResolvedChange?.(next);
    return translator;
  }

  refresh();
  ready = true;

  return {
    translator: () => translator,
    resolved: () => resolved,
    refresh,
    catalog: () => catalog,
    bindSystemLanguageChange() {
      if (typeof window === "undefined") return;
      window.addEventListener("languagechange", () => {
        if (deps.getPreference() !== "system") return;
        refresh();
      });
    },
  };
}
