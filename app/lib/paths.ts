import os from "os";
import path from "path";
import fs from "fs";

/** All user state lives in ~/.plotlink-ows/ — survives npx reinstalls */
export const CONFIG_DIR = path.join(os.homedir(), ".plotlink-ows");
export const ENV_FILE = path.join(CONFIG_DIR, ".env");
export const STORIES_DIR = path.join(CONFIG_DIR, "stories");
export const DATA_DIR = path.join(CONFIG_DIR, "data");
export const DB_PATH = path.join(DATA_DIR, "local.db");
export const DATABASE_URL = `file:${DB_PATH}`;

// Ensure persistent directories exist on import
fs.mkdirSync(CONFIG_DIR, { recursive: true });
fs.mkdirSync(STORIES_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
