import { PlotLink } from "./sdk/index.js";
import type { PlotLinkConfig } from "./sdk/index.js";
import { loadConfig } from "./config.js";

/**
 * Build a PlotLink SDK client from CLI config.
 *
 * @param options.ipfs - Whether IPFS (Filebase) credentials are required.
 *   Commands that upload content (create, chain) need this; read-only commands don't.
 */
export function buildClient(options: { ipfs: boolean }): PlotLink {
  const cfg = loadConfig();

  const config: PlotLinkConfig = {
    privateKey: cfg.privateKey,
    rpcUrl: cfg.rpcUrl,
    chainId: cfg.chainId,
  };

  if (options.ipfs) {
    if (!cfg.filebaseAccessKey || !cfg.filebaseSecretKey || !cfg.filebaseBucket) {
      throw new Error(
        "Filebase credentials required for this command. " +
          "Set PLOTLINK_FILEBASE_ACCESS_KEY, PLOTLINK_FILEBASE_SECRET_KEY, " +
          "and PLOTLINK_FILEBASE_BUCKET env vars or add them to .plotlinkrc",
      );
    }
    config.filebase = {
      accessKey: cfg.filebaseAccessKey,
      secretKey: cfg.filebaseSecretKey,
      bucket: cfg.filebaseBucket,
    };
  }

  return new PlotLink(config);
}
