import { setPreferences } from "../state";
import type { IconName } from "../icons";
import type {
  AppState,
  ColorTheme,
  MermaidDarkTheme,
  MermaidLightTheme,
  MermaidTheme,
  PageWidth,
  ThemeMode,
} from "../types";

export type MermaidAppearance = "light" | "dark";

export interface SettingsViewUI {
  settingsPage: string;
  settingsContent: string;
  settingsHeader: string;
  settingsEyebrow: string;
  settingsHeading: string;
  settingsCopy: string;
  settingsSection: string;
  settingsSectionTitle: string;
  settingsSectionBody: string;
  settingGroup: string;
  settingTitle: string;
  settingDescription: string;
  segmented: string;
  segmentedButton: string;
  selectWrapper: string;
  select: string;
  selectIcon: string;
  fontInput: string;
  settingsNote: string;
  secondaryButton: string;
}

export interface SettingsOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SettingsColorThemeOption {
  value: ColorTheme;
  label: string;
  description: string;
}

export interface SettingsFontOption {
  kind: "text-font" | "code-font";
  title: string;
  description: string;
  value: string;
  placeholder: string;
  label: string;
}

export type SettingsPreferencePatch = Partial<
  Pick<
    AppState,
    | "theme"
    | "colorTheme"
    | "mermaidLightTheme"
    | "mermaidDarkTheme"
    | "textFont"
    | "codeFont"
    | "pageWidth"
  >
>;

export interface SettingsViewControlDeps {
  ui: Pick<
    SettingsViewUI,
    | "segmentedButton"
    | "selectWrapper"
    | "select"
    | "selectIcon"
    | "fontInput"
  >;
  escapeAttribute: (value: string) => string;
  icon: (name: IconName) => string;
}

export interface SettingsViewDeps extends SettingsViewControlDeps {
  state: AppState;
  ui: SettingsViewUI;
  themeOptions: ReadonlyArray<SettingsOption<ThemeMode>>;
  colorThemeOptions: ReadonlyArray<SettingsColorThemeOption>;
  lightMermaidThemes: ReadonlyArray<MermaidLightTheme>;
  darkMermaidThemes: ReadonlyArray<MermaidDarkTheme>;
  fontOptions: ReadonlyArray<SettingsFontOption>;
  pageWidthOptions: ReadonlyArray<SettingsOption<PageWidth>>;
  copy: () => void | Promise<void>;
  capture: () => void;
  commit: (nextState: AppState) => void;
  /** Return the host's authoritative state after `commit`, when available. */
  updateState: () => AppState | void;
  render: () => void;
  persist: () => void;
  applyTheme: () => void;
  applyFonts: () => void;
  activeMermaidTheme: () => MermaidTheme;
  resolveAppearance: () => MermaidAppearance;
  rerenderMermaidTheme: (
    theme: MermaidTheme,
    colorTheme?: ColorTheme,
  ) => void | Promise<void>;
}

export function settingButton(
  kind: "theme" | "placement",
  value: string,
  label: string,
  selected: string,
  deps: SettingsViewControlDeps,
): string {
  return `
    <button
      class="${deps.ui.segmentedButton} ${value === selected ? "is-selected" : ""}"
      type="button"
      data-${kind}="${deps.escapeAttribute(value)}"
      aria-pressed="${value === selected}"
    >${label}</button>
  `;
}

export function settingSelect<T extends MermaidTheme>(
  kind: "mermaid-light" | "mermaid-dark",
  themes: ReadonlyArray<T>,
  selected: T,
  deps: SettingsViewControlDeps,
): string {
  const label =
    kind === "mermaid-light" ? "Mermaid light theme" : "Mermaid dark theme";
  return `
    <div class="mermaid-theme-select ${deps.ui.selectWrapper}">
      <select class="${deps.ui.select}" data-${kind} aria-label="${label}">
        ${themes
          .map(
            (theme) =>
              `<option value="${deps.escapeAttribute(theme)}"${theme === selected ? " selected" : ""}>${theme}</option>`,
          )
          .join("")}
      </select>
      <span class="${deps.ui.selectIcon}">${deps.icon("chevron-down")}</span>
    </div>
  `;
}

export function selectControl<T extends string>(
  kind: "page-width",
  options: ReadonlyArray<SettingsOption<T>>,
  selected: T,
  label: string,
  deps: SettingsViewControlDeps,
): string {
  return `
    <div class="font-select ${deps.ui.selectWrapper}">
      <select class="${deps.ui.select}" data-${kind} aria-label="${label}">
        ${options
          .map(
            (option) =>
              `<option value="${deps.escapeAttribute(option.value)}"${option.value === selected ? " selected" : ""}${option.disabled ? " disabled" : ""}>${option.label}</option>`,
          )
          .join("")}
      </select>
      <span class="${deps.ui.selectIcon}">${deps.icon("chevron-down")}</span>
    </div>
  `;
}

export function colorThemeSelect(
  selected: ColorTheme,
  options: ReadonlyArray<SettingsColorThemeOption>,
  deps: SettingsViewControlDeps,
): string {
  return `
    <div class="color-theme-select ${deps.ui.selectWrapper}">
      <select class="${deps.ui.select}" data-color-theme aria-label="Color palette">
        ${options
          .map(
            (theme) =>
              `<option value="${deps.escapeAttribute(theme.value)}"${theme.value === selected ? " selected" : ""}>${theme.label} — ${theme.description}</option>`,
          )
          .join("")}
      </select>
      <span class="${deps.ui.selectIcon}">${deps.icon("chevron-down")}</span>
    </div>
  `;
}

export function fontInput(
  kind: SettingsFontOption["kind"],
  value: string,
  placeholder: string,
  label: string,
  deps: SettingsViewControlDeps,
): string {
  return `
    <input
      class="font-input ${deps.ui.fontInput}"
      type="text"
      data-${kind}
      value="${deps.escapeAttribute(value)}"
      placeholder="${deps.escapeAttribute(placeholder)}"
      aria-label="${label}"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    >
  `;
}

export function renderSettingsMarkup(deps: SettingsViewDeps): string {
  const { state, ui } = deps;
  return `
    <section class="settings-page ${ui.settingsPage}">
      <div class="settings-content ${ui.settingsContent}">
      <header class="settings-header ${ui.settingsHeader}">
        <span class="${ui.settingsEyebrow}">Preferences</span>
        <h1 class="${ui.settingsHeading}">Reading settings</h1>
        <p class="${ui.settingsCopy}">Changes apply immediately and are restored the next time MarkMaid opens.</p>
      </header>

      <section class="${ui.settingsSection}" aria-labelledby="appearance-settings">
        <h2 id="appearance-settings" class="${ui.settingsSectionTitle}">Appearance</h2>
        <div class="${ui.settingsSectionBody}">
          <div class="setting-group ${ui.settingGroup}">
            <div class="setting-copy">
              <h3 class="${ui.settingTitle}">Appearance mode</h3>
              <p class="${ui.settingDescription}">Use the macOS appearance or keep a fixed light or dark mode.</p>
            </div>
            <div class="segmented-control ${ui.segmented}" role="group" aria-label="Theme">
              ${deps.themeOptions
                .map((option) =>
                  settingButton(
                    "theme",
                    option.value,
                    option.label,
                    state.theme,
                    deps,
                  ),
                )
                .join("")}
            </div>
          </div>
          <div class="setting-group ${ui.settingGroup}">
            <div class="setting-copy">
              <h3 class="${ui.settingTitle}">Color palette</h3>
              <p class="${ui.settingDescription}">Applies a matched light and dark palette across the app, Markdown, and syntax highlighting.</p>
            </div>
            ${colorThemeSelect(state.colorTheme, deps.colorThemeOptions, deps)}
          </div>
        </div>
      </section>

      <section class="${ui.settingsSection}" aria-labelledby="typography-settings">
        <h2 id="typography-settings" class="${ui.settingsSectionTitle}">Typography</h2>
        <div class="${ui.settingsSectionBody}">
          ${deps.fontOptions
            .map(
              (option) => `
          <div class="setting-group ${ui.settingGroup}">
            <div class="setting-copy">
              <h3 class="${ui.settingTitle}">${option.title}</h3>
              <p class="${ui.settingDescription}">${option.description}</p>
            </div>
            ${fontInput(
              option.kind,
              option.value,
              option.placeholder,
              option.label,
              deps,
            )}
          </div>`,
            )
            .join("")}
        </div>
      </section>

      <section class="${ui.settingsSection}" aria-labelledby="workspace-settings">
        <h2 id="workspace-settings" class="${ui.settingsSectionTitle}">Workspace</h2>
        <div class="${ui.settingsSectionBody}">
          <div class="setting-group ${ui.settingGroup}">
            <div class="setting-copy">
              <h3 class="${ui.settingTitle}">Page width</h3>
              <p class="${ui.settingDescription}">Sets the maximum reading width for Markdown previews while keeping side margins on smaller windows.</p>
            </div>
            ${selectControl(
              "page-width",
              deps.pageWidthOptions,
              state.pageWidth,
              "Page width",
              deps,
            )}
          </div>
        </div>
      </section>

      <section class="${ui.settingsSection}" aria-labelledby="mermaid-settings">
        <h2 id="mermaid-settings" class="${ui.settingsSectionTitle}">Mermaid</h2>
        <div class="${ui.settingsSectionBody}">
          <div class="setting-group mermaid-theme-group ${ui.settingGroup}">
            <div class="setting-copy">
              <h3 class="${ui.settingTitle}">Light theme</h3>
              <p class="${ui.settingDescription}">Used whenever the app appearance is light.</p>
            </div>
            ${settingSelect(
              "mermaid-light",
              deps.lightMermaidThemes,
              state.mermaidLightTheme,
              deps,
            )}
          </div>
          <div class="setting-group mermaid-theme-group ${ui.settingGroup}">
            <div class="setting-copy">
              <h3 class="${ui.settingTitle}">Dark theme</h3>
              <p class="${ui.settingDescription}">Used whenever the app appearance is dark.</p>
            </div>
            ${settingSelect(
              "mermaid-dark",
              deps.darkMermaidThemes,
              state.mermaidDarkTheme,
              deps,
            )}
          </div>
        </div>
      </section>

      <section class="${ui.settingsSection}" aria-labelledby="diagnostics-settings">
        <h2 id="diagnostics-settings" class="${ui.settingsSectionTitle}">Diagnostics</h2>
        <div class="${ui.settingsSectionBody}">
          <div class="setting-group ${ui.settingGroup}">
            <div class="setting-copy">
              <h3 class="${ui.settingTitle}">Copy diagnostics</h3>
              <p class="${ui.settingDescription}">Copies a privacy-safe environment and state summary. Document contents, filenames, and full paths are never included.</p>
            </div>
            <button class="secondary-button ${ui.secondaryButton}" type="button" data-copy-diagnostics>Copy Diagnostics</button>
          </div>
        </div>
      </section>

      <footer class="settings-note ${ui.settingsNote}">
        GFM and Mermaid preview are enabled. Editing and automatic file refresh are not part of this version.
      </footer>
      </div>
    </section>
  `;
}

function commitPreferences(
  deps: SettingsViewDeps,
  currentState: { value: AppState },
  preferences: SettingsPreferencePatch,
): void {
  const nextState = setPreferences(currentState.value, preferences);
  deps.commit(nextState);
  currentState.value = deps.updateState() ?? nextState;
}

export function bindSettings(
  container: HTMLElement,
  deps: SettingsViewDeps,
): void {
  const currentState = { value: deps.state };

  container
    .querySelector<HTMLElement>("[data-copy-diagnostics]")
    ?.addEventListener("click", () => {
      void deps.copy();
    });

  container.querySelectorAll<HTMLElement>("[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      const previousMermaidTheme = deps.activeMermaidTheme();
      deps.capture();
      commitPreferences(deps, currentState, {
        theme: button.dataset.theme as ThemeMode,
      });
      deps.render();
      deps.persist();
      const nextMermaidTheme = deps.activeMermaidTheme();
      if (nextMermaidTheme !== previousMermaidTheme) {
        void deps.rerenderMermaidTheme(nextMermaidTheme);
      }
    });
  });

  container
    .querySelectorAll<HTMLSelectElement>("[data-color-theme]")
    .forEach((select) => {
      select.addEventListener("change", () => {
        deps.capture();
        commitPreferences(deps, currentState, {
          colorTheme: select.value as ColorTheme,
        });
        deps.applyTheme();
        deps.persist();
        void deps.rerenderMermaidTheme(
          deps.activeMermaidTheme(),
          currentState.value.colorTheme,
        );
      });
    });

  container
    .querySelectorAll<HTMLSelectElement>("[data-mermaid-light]")
    .forEach((select) => {
      select.addEventListener("change", () => {
        const mermaidLightTheme = select.value as MermaidLightTheme;
        if (mermaidLightTheme === currentState.value.mermaidLightTheme) return;
        deps.capture();
        commitPreferences(deps, currentState, { mermaidLightTheme });
        deps.render();
        deps.persist();
        if (deps.resolveAppearance() === "light") {
          void deps.rerenderMermaidTheme(mermaidLightTheme);
        }
      });
    });

  container
    .querySelectorAll<HTMLSelectElement>("[data-mermaid-dark]")
    .forEach((select) => {
      select.addEventListener("change", () => {
        const mermaidDarkTheme = select.value as MermaidDarkTheme;
        if (mermaidDarkTheme === currentState.value.mermaidDarkTheme) return;
        deps.capture();
        commitPreferences(deps, currentState, { mermaidDarkTheme });
        deps.render();
        deps.persist();
        if (deps.resolveAppearance() === "dark") {
          void deps.rerenderMermaidTheme(mermaidDarkTheme);
        }
      });
    });

  container
    .querySelectorAll<HTMLInputElement>("[data-text-font]")
    .forEach((input) => {
      input.addEventListener("input", () => {
        commitPreferences(deps, currentState, { textFont: input.value.trim() });
        deps.applyFonts();
        deps.persist();
      });
    });

  container
    .querySelectorAll<HTMLInputElement>("[data-code-font]")
    .forEach((input) => {
      input.addEventListener("input", () => {
        commitPreferences(deps, currentState, { codeFont: input.value.trim() });
        deps.applyFonts();
        deps.persist();
      });
    });

  container
    .querySelectorAll<HTMLSelectElement>("[data-page-width]")
    .forEach((select) => {
      select.addEventListener("change", () => {
        commitPreferences(deps, currentState, {
          pageWidth: select.value as PageWidth,
        });
        deps.render();
        deps.persist();
      });
    });
}

export function renderSettings(
  container: HTMLElement,
  deps: SettingsViewDeps,
): void {
  container.innerHTML = renderSettingsMarkup(deps);
  bindSettings(container, deps);
}
