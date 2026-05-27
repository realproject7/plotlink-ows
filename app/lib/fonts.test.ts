import { describe, it, expect } from "vitest";
import {
  FONT_REGISTRY,
  getDefaultFont,
  getDisplayFont,
  getFontCdnUrl,
  getFontFamily,
  FONT_FALLBACK_STACK,
  LANGUAGE_FONT_SAMPLES,
} from "./fonts";

describe("FONT_REGISTRY", () => {
  it("every font has license and licenseUrl", () => {
    for (const font of FONT_REGISTRY) {
      expect(font.license).toBeTruthy();
      expect(font.licenseUrl).toMatch(/^https:\/\//);
    }
  });

  it("every font has at least one weight", () => {
    for (const font of FONT_REGISTRY) {
      expect(font.weights.length).toBeGreaterThan(0);
    }
  });

  it("contains both body and display categories", () => {
    expect(FONT_REGISTRY.some((f) => f.category === "body")).toBe(true);
    expect(FONT_REGISTRY.some((f) => f.category === "display")).toBe(true);
  });
});

describe("getDefaultFont", () => {
  it("returns Noto Sans for English", () => {
    expect(getDefaultFont("English").family).toBe("Noto Sans");
  });

  it("returns Noto Sans KR for Korean", () => {
    expect(getDefaultFont("Korean").family).toBe("Noto Sans KR");
  });

  it("returns Noto Sans JP for Japanese", () => {
    expect(getDefaultFont("Japanese").family).toBe("Noto Sans JP");
  });

  it("returns Noto Sans SC for Chinese", () => {
    expect(getDefaultFont("Chinese").family).toBe("Noto Sans SC");
  });

  it("returns Noto Sans Devanagari for Hindi", () => {
    expect(getDefaultFont("Hindi").family).toBe("Noto Sans Devanagari");
  });

  it("returns Noto Naskh Arabic for Arabic", () => {
    expect(getDefaultFont("Arabic").family).toBe("Noto Naskh Arabic");
  });

  it("returns Noto Sans for unknown language", () => {
    expect(getDefaultFont("Klingon").family).toBe("Noto Sans");
  });

  it("returns Noto Sans for Russian", () => {
    expect(getDefaultFont("Russian").family).toBe("Noto Sans");
  });
});

describe("getDisplayFont", () => {
  it("returns Bangers", () => {
    expect(getDisplayFont().family).toBe("Bangers");
    expect(getDisplayFont().category).toBe("display");
  });
});

describe("getFontCdnUrl", () => {
  it("returns valid Google Fonts URL", () => {
    const url = getFontCdnUrl(getDefaultFont("English"));
    expect(url).toContain("fonts.googleapis.com/css2");
    expect(url).toContain("Noto+Sans");
    expect(url).toContain("wght@");
  });

  it("includes all weights", () => {
    const font = getDefaultFont("Korean");
    const url = getFontCdnUrl(font);
    expect(url).toContain("400;500;700");
  });
});

describe("getFontFamily", () => {
  it("returns quoted family with fallback stack", () => {
    const result = getFontFamily(getDefaultFont("English"));
    expect(result).toBe(`"Noto Sans", ${FONT_FALLBACK_STACK}`);
  });
});

describe("LANGUAGE_FONT_SAMPLES", () => {
  it("has sample text for English", () => {
    expect(LANGUAGE_FONT_SAMPLES.English.text).toBeTruthy();
    expect(LANGUAGE_FONT_SAMPLES.English.font).toBe("Noto Sans");
  });

  it("has sample text for Korean", () => {
    expect(LANGUAGE_FONT_SAMPLES.Korean.text).toMatch(/[가-힯]/);
    expect(LANGUAGE_FONT_SAMPLES.Korean.font).toBe("Noto Sans KR");
  });

  it("has sample text for Japanese", () => {
    expect(LANGUAGE_FONT_SAMPLES.Japanese.text).toMatch(/[぀-ヿ一-鿿]/);
    expect(LANGUAGE_FONT_SAMPLES.Japanese.font).toBe("Noto Sans JP");
  });

  it("has sample text for Chinese", () => {
    expect(LANGUAGE_FONT_SAMPLES.Chinese.text).toMatch(/[一-鿿]/);
    expect(LANGUAGE_FONT_SAMPLES.Chinese.font).toBe("Noto Sans SC");
  });

  it("has sample text for Hindi", () => {
    expect(LANGUAGE_FONT_SAMPLES.Hindi.text).toMatch(/[ऀ-ॿ]/);
    expect(LANGUAGE_FONT_SAMPLES.Hindi.font).toBe("Noto Sans Devanagari");
  });

  it("has sample text for Arabic", () => {
    expect(LANGUAGE_FONT_SAMPLES.Arabic.text).toMatch(/[؀-ۿ]/);
    expect(LANGUAGE_FONT_SAMPLES.Arabic.font).toBe("Noto Naskh Arabic");
  });

  it("each sample font matches getDefaultFont", () => {
    for (const [lang, sample] of Object.entries(LANGUAGE_FONT_SAMPLES)) {
      expect(getDefaultFont(lang).family).toBe(sample.font);
    }
  });
});
