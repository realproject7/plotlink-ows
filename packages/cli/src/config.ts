import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

/**
 * Resolved configuration for the CLI.
 * Loaded from environment variables, falling back to `.plotlinkrc` in cwd or home dir.
 */
export interface CliConfig {
  privateKey: string;
  rpcUrl: string;
  chainId?: number;
  filebaseAccessKey?: string;
  filebaseSecretKey?: string;
  filebaseBucket?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

/**
 * Load CLI config by merging env vars over `.plotlinkrc` values.
 *
 * Priority (highest first):
 *   1. Environment variables (PLOTLINK_PRIVATE_KEY, PLOTLINK_RPC_URL, etc.)
 *   2. `.plotlinkrc` JSON file in cwd
 *   3. `.plotlinkrc` JSON file in home dir
 */
export function loadConfig(): CliConfig {
  const rc = loadRcFile();

  const privateKey = env("PLOTLINK_PRIVATE_KEY") ?? rc.privateKey;
  const rpcUrl = env("PLOTLINK_RPC_URL") ?? rc.rpcUrl;

  if (!privateKey) {
    throw new Error(
      "Missing private key. Set PLOTLINK_PRIVATE_KEY env var or add \"privateKey\" to .plotlinkrc",
    );
  }
  if (!rpcUrl) {
    throw new Error(
      "Missing RPC URL. Set PLOTLINK_RPC_URL env var or add \"rpcUrl\" to .plotlinkrc",
    );
  }

  const chainIdRaw = env("PLOTLINK_CHAIN_ID") ?? rc.chainId;
  const chainId = chainIdRaw ? Number(chainIdRaw) : undefined;

  return {
    privateKey,
    rpcUrl,
    chainId,
    filebaseAccessKey: env("PLOTLINK_FILEBASE_ACCESS_KEY") ?? rc.filebaseAccessKey,
    filebaseSecretKey: env("PLOTLINK_FILEBASE_SECRET_KEY") ?? rc.filebaseSecretKey,
    filebaseBucket: env("PLOTLINK_FILEBASE_BUCKET") ?? rc.filebaseBucket,
    supabaseUrl: env("PLOTLINK_SUPABASE_URL") ?? rc.supabaseUrl,
    supabaseAnonKey: env("PLOTLINK_SUPABASE_ANON_KEY") ?? rc.supabaseAnonKey,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function env(name: string): string | undefined {
  const val = process.env[name];
  return val && val.trim().length > 0 ? val.trim() : undefined;
}

interface RcData {
  privateKey?: string;
  rpcUrl?: string;
  chainId?: string;
  filebaseAccessKey?: string;
  filebaseSecretKey?: string;
  filebaseBucket?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

function loadRcFile(): RcData {
  const candidates = [
    resolve(process.cwd(), ".plotlinkrc"),
    resolve(homedir(), ".plotlinkrc"),
  ];

  for (const filepath of candidates) {
    if (existsSync(filepath)) {
      const raw = readFileSync(filepath, "utf-8");
      try {
        const parsed = JSON.parse(raw) as RcData;
        console.warn(
          "WARNING: Loading keys from .plotlinkrc — ensure this file is in .gitignore and never committed.",
        );
        return parsed;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error parsing .plotlinkrc: ${message}. Check your JSON syntax.`);
      }
    }
  }

  return {};
}
