import os from "os";
import path from "path";
import fs from "fs";

/** All user state lives in ~/.plotlink-ows/ — survives npx reinstalls */
export const CONFIG_DIR = path.join(os.homedir(), ".plotlink-ows");
export const ENV_FILE = path.join(CONFIG_DIR, ".env");
// Ensure config dir exists on import
fs.mkdirSync(CONFIG_DIR, { recursive: true });
