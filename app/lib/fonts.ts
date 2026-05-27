export interface FontEntry {
  family: string;
  googleFontsId: string;
  license: string;
  licenseUrl: string;
  category: "body" | "display";
  weights: number[];
  languages: string[];
}

export const FONT_REGISTRY: FontEntry[] = [
  {
    family: "Noto Sans",
    googleFontsId: "Noto+Sans",
    license: "OFL-1.1",
    licenseUrl: "https://fonts.google.com/noto/specimen/Noto+Sans/about",
    category: "body",
    weights: [400, 500, 700],
    languages: ["English", "Spanish", "French", "Portuguese", "Russian", "Others"],
  },
  {
    family: "Noto Sans KR",
    googleFontsId: "Noto+Sans+KR",
    license: "OFL-1.1",
    licenseUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+KR/about",
    category: "body",
    weights: [400, 500, 700],
    languages: ["Korean"],
  },
  {
    family: "Noto Sans JP",
    googleFontsId: "Noto+Sans+JP",
    license: "OFL-1.1",
    licenseUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+JP/about",
    category: "body",
    weights: [400, 500, 700],
    languages: ["Japanese"],
  },
  {
    family: "Noto Sans SC",
    googleFontsId: "Noto+Sans+SC",
    license: "OFL-1.1",
    licenseUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+SC/about",
    category: "body",
    weights: [400, 500, 700],
    languages: ["Chinese"],
  },
  {
    family: "Noto Sans Devanagari",
    googleFontsId: "Noto+Sans+Devanagari",
    license: "OFL-1.1",
    licenseUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari/about",
    category: "body",
    weights: [400, 500, 700],
    languages: ["Hindi"],
  },
  {
    family: "Noto Naskh Arabic",
    googleFontsId: "Noto+Naskh+Arabic",
    license: "OFL-1.1",
    licenseUrl: "https://fonts.google.com/noto/specimen/Noto+Naskh+Arabic/about",
    category: "body",
    weights: [400, 500, 700],
    languages: ["Arabic"],
  },
  {
    family: "Bangers",
    googleFontsId: "Bangers",
    license: "OFL-1.1",
    licenseUrl: "https://fonts.google.com/specimen/Bangers/about",
    category: "display",
    weights: [400],
    languages: [],
  },
];

export const FONT_FALLBACK_STACK = "system-ui, sans-serif";

const defaultFont = FONT_REGISTRY.find((f) => f.family === "Noto Sans")!;
const displayFont = FONT_REGISTRY.find((f) => f.category === "display")!;

export function getDefaultFont(language: string): FontEntry {
  const match = FONT_REGISTRY.find(
    (f) => f.category === "body" && f.languages.includes(language),
  );
  return match || defaultFont;
}

export function getDisplayFont(): FontEntry {
  return displayFont;
}

export function getFontCdnUrl(font: FontEntry): string {
  const weights = font.weights.join(";");
  return `https://fonts.googleapis.com/css2?family=${font.googleFontsId}:wght@${weights}&display=swap`;
}

export function getFontFamily(font: FontEntry): string {
  return `"${font.family}", ${FONT_FALLBACK_STACK}`;
}

export const LANGUAGE_FONT_SAMPLES: Record<string, { text: string; font: string }> = {
  English: { text: "The quick brown fox jumps", font: "Noto Sans" },
  Korean: { text: "한국어 샘플 텍스트", font: "Noto Sans KR" },
  Japanese: { text: "日本語のサンプル", font: "Noto Sans JP" },
  Chinese: { text: "中文示例文本", font: "Noto Sans SC" },
  Hindi: { text: "हिंदी नमूना पाठ", font: "Noto Sans Devanagari" },
  Arabic: { text: "نص عربي نموذجي", font: "Noto Naskh Arabic" },
};
