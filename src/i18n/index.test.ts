import { describe, expect, it } from "vitest";

import {
  CHINESE_MESSAGES,
  ENGLISH_MESSAGES,
  createTranslator,
  resolveUiLocale,
} from "./index";

describe("i18n", () => {
  it("has complete Simplified Chinese key parity with English", () => {
    expect(Object.keys(CHINESE_MESSAGES).sort()).toEqual(
      Object.keys(ENGLISH_MESSAGES).sort(),
    );
  });

  it("resolves system languages in preferred order without converting Traditional Chinese", () => {
    expect(resolveUiLocale("en", ["zh-CN"])).toBe("en");
    expect(resolveUiLocale("zh-Hans", ["en-US"])).toBe("zh-Hans");
    expect(resolveUiLocale("system", ["en-US", "zh-CN"])).toBe("en");
    expect(resolveUiLocale("system", ["zh-Hant", "zh-CN"])).toBe("zh-Hans");
    expect(resolveUiLocale("system", ["zh-TW", "fr"])).toBe("en");
    expect(resolveUiLocale("system", ["zh", "en"])).toBe("zh-Hans");
    expect(resolveUiLocale("system", ["fr-FR"])).toBe("en");
  });

  it("falls back per key to English for a sparse catalog", () => {
    const translator = createTranslator("zh-Hans", {
      "zh-Hans": { "chrome.settings": "设置覆盖" },
    });
    expect(translator.t("chrome.settings")).toBe("设置覆盖");
    const sparse = createTranslator("zh-Hans", {
      "zh-Hans": { "chrome.settings": undefined },
    });
    expect(sparse.t("tab.close")).toBe(CHINESE_MESSAGES["tab.close"]);
    const englishFallback = createTranslator("en", {
      en: { "tab.close": undefined },
    });
    expect(englishFallback.t("tab.close")).toBe(ENGLISH_MESSAGES["tab.close"]);
  });

  it("interpolates values without HTML escaping and rejects missing or unknown placeholders", () => {
    const translator = createTranslator("en");
    expect(translator.t("find.count", { current: 2, total: 5 })).toBe("2 of 5");
    expect(translator.t("tab.actions", { name: "<script>" })).toBe(
      "<script> actions",
    );
    expect(() => translator.t("find.count", { current: 1 })).toThrow(
      /Missing interpolation value "total"/,
    );
    expect(() =>
      translator.t("find.count", { current: 1, total: 2, extra: 3 }),
    ).toThrow(/Unknown interpolation placeholder "extra"/);
  });
});
