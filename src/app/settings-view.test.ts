// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_STATE } from "../state";
import type { AppState } from "../types";
import {
  renderSettings,
  renderSettingsMarkup,
  type SettingsViewDeps,
} from "./settings-view";

const ui = {
  settingsPage: "settings-page-ui",
  settingsContent: "settings-content-ui",
  settingsHeader: "settings-header-ui",
  settingsEyebrow: "settings-eyebrow-ui",
  settingsHeading: "settings-heading-ui",
  settingsCopy: "settings-copy-ui",
  settingsSection: "settings-section-ui",
  settingsSectionTitle: "settings-section-title-ui",
  settingsSectionBody: "settings-section-body-ui",
  settingGroup: "setting-group-ui",
  settingTitle: "setting-title-ui",
  settingDescription: "setting-description-ui",
  segmented: "segmented-ui",
  segmentedButton: "segmented-button-ui",
  selectWrapper: "select-wrapper-ui",
  select: "select-ui",
  selectIcon: "select-icon-ui",
  fontInput: "font-input-ui",
  settingsNote: "settings-note-ui",
  secondaryButton: "secondary-button-ui",
} as const;

function makeDeps(initialState: AppState = { ...DEFAULT_STATE }) {
  let currentState = initialState;
  const callbacks = {
    copy: vi.fn(),
    capture: vi.fn(),
    commit: vi.fn((nextState: AppState) => {
      currentState = nextState;
    }),
    updateState: vi.fn(() => currentState),
    render: vi.fn(),
    persist: vi.fn(),
    applyTheme: vi.fn(),
    applyFonts: vi.fn(),
    activeMermaidTheme: vi.fn(() =>
      currentState.theme === "dark"
        ? currentState.mermaidDarkTheme
        : currentState.mermaidLightTheme,
    ),
    resolveAppearance: vi.fn(() =>
      currentState.theme === "dark" ? "dark" : "light",
    ),
    rerenderMermaidTheme: vi.fn(),
  };
  const deps: SettingsViewDeps = {
    state: initialState,
    ui,
    themeOptions: [
      { value: "system", label: "System" },
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ],
    colorThemeOptions: [
      { value: "default", label: "Default", description: "Neutral blue" },
      { value: "nord", label: "Nord", description: "Cool Arctic" },
    ],
    lightMermaidThemes: ["default", "forest", "neo"],
    darkMermaidThemes: ["dark", "neo-dark"],
    fontOptions: [
      {
        kind: "text-font",
        title: "Text font",
        description: "Used for Markdown prose.",
        value: initialState.textFont,
        placeholder: "e.g. Georgia",
        label: "Text font",
      },
      {
        kind: "code-font",
        title: "Code font",
        description: "Used for code and Mermaid source.",
        value: initialState.codeFont,
        placeholder: "e.g. Menlo, monospace",
        label: "Code font",
      },
    ],
    pageWidthOptions: [
      { value: "default", label: "Default (860px)" },
      { value: "wide", label: "Wide (1040px)" },
    ],
    escapeAttribute: (value) =>
      value
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;"),
    icon: (name) => `<svg data-icon="${name}"></svg>`,
    ...callbacks,
  };
  return { deps, callbacks, getState: () => currentState };
}

describe("settings view", () => {
  it("renders the settings markup from injected classes and options", () => {
    const state = {
      ...DEFAULT_STATE,
      theme: "dark" as const,
      colorTheme: "nord" as const,
      textFont: 'A"B',
    };
    const { deps } = makeDeps(state);
    const markup = renderSettingsMarkup(deps);

    expect(markup).toContain('class="settings-page settings-page-ui"');
    expect(markup).toContain("Reading settings");
    expect(markup).toContain('data-theme="dark"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('value="A&quot;B"');
    expect(markup).toContain('value="nord" selected');
    expect(markup).toContain("Cool Arctic");
    expect(markup).toContain('data-page-width');
    expect(markup).toContain('data-copy-diagnostics');
    expect(markup).toContain('<svg data-icon="chevron-down"></svg>');
  });

  it("binds all settings controls through injected callbacks", () => {
    const { deps, callbacks, getState } = makeDeps();
    const host = document.createElement("div");
    renderSettings(host, deps);
    document.body.append(host);

    host.querySelector<HTMLButtonElement>('[data-theme="dark"]')!.click();
    expect(callbacks.capture).toHaveBeenCalledOnce();
    expect(getState().theme).toBe("dark");
    expect(callbacks.render).toHaveBeenCalledOnce();
    expect(callbacks.persist).toHaveBeenCalledOnce();
    expect(callbacks.rerenderMermaidTheme).toHaveBeenCalledWith("dark");

    const colorTheme = host.querySelector<HTMLSelectElement>("[data-color-theme]")!;
    colorTheme.value = "nord";
    colorTheme.dispatchEvent(new Event("change", { bubbles: true }));
    expect(getState().colorTheme).toBe("nord");
    expect(callbacks.applyTheme).toHaveBeenCalledOnce();
    expect(callbacks.rerenderMermaidTheme).toHaveBeenLastCalledWith("dark", "nord");

    host.querySelector<HTMLButtonElement>('[data-theme="light"]')!.click();
    expect(getState().theme).toBe("light");

    const lightTheme = host.querySelector<HTMLSelectElement>("[data-mermaid-light]")!;
    lightTheme.value = "forest";
    lightTheme.dispatchEvent(new Event("change", { bubbles: true }));
    expect(getState().mermaidLightTheme).toBe("forest");
    expect(callbacks.rerenderMermaidTheme).toHaveBeenLastCalledWith("forest");

    host.querySelector<HTMLButtonElement>('[data-theme="dark"]')!.click();
    const darkTheme = host.querySelector<HTMLSelectElement>("[data-mermaid-dark]")!;
    darkTheme.value = "neo-dark";
    darkTheme.dispatchEvent(new Event("change", { bubbles: true }));
    expect(getState().mermaidDarkTheme).toBe("neo-dark");
    expect(callbacks.rerenderMermaidTheme).toHaveBeenLastCalledWith("neo-dark");

    const textFont = host.querySelector<HTMLInputElement>("[data-text-font]")!;
    textFont.value = "  Georgia, serif  ";
    textFont.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getState().textFont).toBe("Georgia, serif");
    expect(callbacks.applyFonts).toHaveBeenCalledOnce();

    const codeFont = host.querySelector<HTMLInputElement>("[data-code-font]")!;
    codeFont.value = "Menlo";
    codeFont.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getState().codeFont).toBe("Menlo");
    expect(callbacks.applyFonts).toHaveBeenCalledTimes(2);

    const pageWidth = host.querySelector<HTMLSelectElement>("[data-page-width]")!;
    pageWidth.value = "wide";
    pageWidth.dispatchEvent(new Event("change", { bubbles: true }));
    expect(getState().pageWidth).toBe("wide");

    host.querySelector<HTMLElement>("[data-copy-diagnostics]")!.click();
    expect(callbacks.copy).toHaveBeenCalledOnce();
  });
});
