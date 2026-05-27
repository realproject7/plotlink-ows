import fs from "fs";
import path from "path";

export const SHOT_TYPES = ["wide", "medium", "close-up", "extreme-close-up"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

export interface CutDialogue {
  speaker: string;
  text: string;
}

export interface Cut {
  id: number;
  shotType: ShotType;
  description: string;
  characters: string[];
  dialogue: CutDialogue[];
  narration: string;
  sfx: string;
  cleanImagePath: string | null;
  finalImagePath: string | null;
  exportedAt: string | null;
  uploadedCid: string | null;
  uploadedUrl: string | null;
}

export interface CutsFile {
  version: 1;
  plotFile: string;
  cuts: Cut[];
}

export function createDefaultCut(id: number, plotFile: string): Cut {
  const padded = String(id).padStart(2, "0");
  return {
    id,
    shotType: "medium",
    description: "",
    characters: [],
    dialogue: [],
    narration: "",
    sfx: "",
    cleanImagePath: `assets/${plotFile}/cut-${padded}-clean.webp`,
    finalImagePath: null,
    exportedAt: null,
    uploadedCid: null,
    uploadedUrl: null,
  };
}

export function createCutsFile(plotFile: string, cutCount = 1): CutsFile {
  const cuts = Array.from({ length: cutCount }, (_, i) => createDefaultCut(i + 1, plotFile));
  return { version: 1, plotFile, cuts };
}

function cutsFilePath(storyDir: string, plotFile: string): string {
  return path.join(storyDir, `${plotFile}.cuts.json`);
}

export function readCutsFile(storyDir: string, plotFile: string): CutsFile | null {
  const filePath = cutsFilePath(storyDir, plotFile);
  if (!fs.existsSync(filePath)) return null;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(`Cannot read ${plotFile}.cuts.json: ${(err as Error).message}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${plotFile}.cuts.json contains invalid JSON`);
  }

  const validation = validateCutsFile(data);
  if (!validation.valid) {
    throw new Error(`${plotFile}.cuts.json is invalid: ${validation.error}`);
  }

  return data as CutsFile;
}

export function writeCutsFile(storyDir: string, plotFile: string, cutsFile: CutsFile): void {
  const filePath = cutsFilePath(storyDir, plotFile);
  fs.writeFileSync(filePath, JSON.stringify(cutsFile, null, 2) + "\n");
}

export function validateCutsFile(data: unknown): { valid: boolean; error?: string } {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { valid: false, error: "Must be a JSON object" };
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) {
    return { valid: false, error: "Unsupported version (expected 1)" };
  }

  if (typeof obj.plotFile !== "string" || !obj.plotFile) {
    return { valid: false, error: "Missing or invalid plotFile" };
  }

  if (!Array.isArray(obj.cuts)) {
    return { valid: false, error: "cuts must be an array" };
  }

  const validShots = new Set<string>(SHOT_TYPES);

  for (let i = 0; i < obj.cuts.length; i++) {
    const cut = obj.cuts[i] as Record<string, unknown>;
    if (typeof cut !== "object" || cut === null) {
      return { valid: false, error: `Cut ${i} is not an object` };
    }
    if (typeof cut.id !== "number") {
      return { valid: false, error: `Cut ${i} missing numeric id` };
    }
    if (typeof cut.shotType !== "string" || !validShots.has(cut.shotType)) {
      return { valid: false, error: `Cut ${i} has invalid shotType` };
    }
    if (typeof cut.description !== "string") {
      return { valid: false, error: `Cut ${i} missing description` };
    }
    if (!Array.isArray(cut.characters)) {
      return { valid: false, error: `Cut ${i} characters must be an array` };
    }
    if (!Array.isArray(cut.dialogue)) {
      return { valid: false, error: `Cut ${i} dialogue must be an array` };
    }
    for (let j = 0; j < (cut.dialogue as unknown[]).length; j++) {
      const d = (cut.dialogue as Record<string, unknown>[])[j];
      if (typeof d !== "object" || d === null || typeof d.speaker !== "string" || typeof d.text !== "string") {
        return { valid: false, error: `Cut ${i} dialogue[${j}] must have speaker and text strings` };
      }
    }
    if (typeof cut.narration !== "string") {
      return { valid: false, error: `Cut ${i} missing narration` };
    }
    if (typeof cut.sfx !== "string") {
      return { valid: false, error: `Cut ${i} missing sfx` };
    }
    const nullableStrings = ["cleanImagePath", "finalImagePath", "exportedAt", "uploadedCid", "uploadedUrl"] as const;
    for (const field of nullableStrings) {
      if (cut[field] !== null && typeof cut[field] !== "string") {
        return { valid: false, error: `Cut ${i} ${field} must be a string or null` };
      }
    }
  }

  return { valid: true };
}
