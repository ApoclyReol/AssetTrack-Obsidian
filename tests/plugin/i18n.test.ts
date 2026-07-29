import { describe, expect, it } from "vitest";
import { localeFromLanguage } from "../../src/i18n";

describe("locale selection", () => {
  it.each(["zh", "zh-CN", "zh-TW", "ZH-hant"])(
    "uses Chinese for %s",
    (language) => {
      expect(localeFromLanguage(language)).toBe("zh-CN");
    }
  );

  it.each(["en", "en-US", "fr", ""])(
    "falls back to English for %s",
    (language) => {
      expect(localeFromLanguage(language)).toBe("en");
    }
  );
});
