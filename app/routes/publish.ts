import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { publishStoryline, publishPlot, getEthBalance, getCreationFee, estimatePublishCost, uploadCoverImage, uploadPlotImage, updateStoryline } from "../lib/publish";
import { keccak256, toBytes } from "viem";
import { listAgentWallets, getBaseAddress } from "../../lib/ows/wallet";
import path from "path";
import { STORIES_DIR } from "../lib/paths";
import { readCutsFile } from "../lib/cuts";
import { checkMarkdownReadiness } from "../lib/cartoon-readiness";
import { readStoryMeta } from "./stories";
import { sniffImageType, findStaleAssetPaths } from "../lib/clean-image-sync";
import { isValidImageAsset } from "../lib/image-asset-validate";
import { extractOgTitle, leadingTitleSegment } from "../lib/public-title";
import { canonicalizeGenre, GENRES } from "../../lib/genres";

/**
 * Resolve a request's genre to a canonical PlotLink value (#412). Returns the
 * canonical string for a valid/aliased genre, `undefined` for an absent/blank
 * genre (no metadata change), or an `{ error }` for a non-empty genre that can't
 * be mapped — so the route fails locally with a clear message instead of letting
 * PlotLink reject it and leave the public story UNCATEGORIZED.
 */
function resolveGenre(input: string | undefined): { genre?: string } | { error: string } {
  if (!input || !input.trim()) return { genre: undefined };
  const canonical = canonicalizeGenre(input);
  if (!canonical) {
    return { error: `Invalid genre "${input}". Use one of: ${GENRES.join(", ")}.` };
  }
  return { genre: canonical };
}

/**
 * Validate that an uploaded image's actual magic bytes match its claimed
 * WebP/JPEG MIME type, so a renamed PNG/text file labeled image/webp cannot be
 * forwarded to the plotlink backend. Mirrors the byte check the cartoon
 * clean-image upload uses (#266). Returns a user-facing error string, or null
 * when the bytes are valid.
 */
async function imageBytesError(file: File): Promise<string | null> {
  const expected = file.type === "image/webp" ? "webp" : "jpeg";
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (sniffImageType(bytes) !== expected) {
    return "File content is not a valid WebP/JPEG image (bytes do not match the image type)";
  }
  return null;
}

const publish = new Hono();

/** GET /api/publish/preflight — check if publishing is possible */
publish.get("/preflight", async (c) => {
  try {
    // Check wallet
    const wallets = listAgentWallets();
    const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
    if (!wallet) {
      return c.json({ ready: false, error: "No OWS wallet found" });
    }

    const address = getBaseAddress(wallet);
    if (!address) {
      return c.json({ ready: false, error: "No EVM address on wallet" });
    }

    const balance = await getEthBalance(address);

    // The MCV2 Bond creation fee is a plain contract read and is the only hard
    // on-chain cost we can always count on. Read it independently of gas
    // estimation: a flaky gas estimate must not masquerade as an unreadable-chain
    // failure. If the fee itself cannot be read, the RPC/contract config is
    // genuinely broken — that is a real blocker.
    let creationFee: bigint;
    try {
      creationFee = await getCreationFee();
    } catch {
      return c.json({
        ready: false,
        address,
        ethBalance: balance.toString(),
        error: "Could not read creation fee — check RPC and contract config",
      });
    }

    // Gas estimation is best-effort. PlotLink owns Filebase/IPFS server-side and
    // OWS uploads images/content through the PlotLink API, so there is NO local
    // Filebase env requirement to gate on (#287). And gas estimation simulates
    // createStoryline with dummy content the contract can reject — which is why
    // the real #211 pilot publish succeeded while this estimate failed. So a
    // failed estimate is a warning, not an absolute publish blocker.
    let totalCost: bigint | null = null;
    let estimateWarning: string | null = null;
    try {
      const dummyCid = "QmDummy";
      const dummyHash = keccak256(toBytes("estimation"));
      const estimate = await estimatePublishCost(address, "Test", dummyCid, dummyHash);
      totalCost = estimate.totalCost;
    } catch {
      estimateWarning =
        "Could not estimate gas; using the creation fee as the minimum required balance — actual publish may still succeed";
    }

    // Require enough ETH for at least the creation fee; when a full gas estimate
    // is available, require that instead. Never block solely on a missing
    // estimate — but a genuinely insufficient balance is still a real blocker.
    const requiredBalance = totalCost ?? creationFee;
    const hasEnoughEth = balance >= requiredBalance;

    return c.json({
      ready: hasEnoughEth,
      address,
      ethBalance: balance.toString(),
      creationFee: creationFee.toString(),
      requiredBalance: requiredBalance.toString(),
      hasEnoughEth,
      estimationFailed: totalCost === null,
      estimateWarning,
      error: !hasEnoughEth
        ? `Insufficient ETH. Need at least ~${(Number(requiredBalance) / 1e18).toFixed(6)} ETH (creation fee${totalCost !== null ? " + gas" : ""})`
        : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Preflight check failed";
    return c.json({ ready: false, error: message });
  }
});

/**
 * GET /api/publish/public-title — read the INDEXED public title from PlotLink
 * after a publish (#379). There is no public JSON read endpoint, so this fetches
 * the rendered public page server-side (no CORS) and extracts its og:title:
 *   - genesis/storyline (`/story/<id>`)      → { storylineTitle }
 *   - plot (`/story/<id>/<plotIndex>`)       → { plotTitle } (leading title segment)
 * `fetched:false` when the page is unreachable / has no title, so the caller
 * treats it as inconclusive rather than a false pass. The client then runs the
 * pure title verifier on the result.
 */
publish.get("/public-title", async (c) => {
  const storylineId = c.req.query("storylineId");
  const plotIndex = c.req.query("plotIndex");
  if (!storylineId || !/^\d+$/.test(storylineId)) {
    return c.json({ ok: false, error: "Valid storylineId required" }, 400);
  }
  const isPlot = plotIndex != null && plotIndex !== "" && /^\d+$/.test(plotIndex);
  const PLOTLINK_URL = process.env.NEXT_PUBLIC_APP_URL || "https://plotlink.xyz";
  const url = isPlot
    ? `${PLOTLINK_URL}/story/${storylineId}/${plotIndex}`
    : `${PLOTLINK_URL}/story/${storylineId}`;
  const storylineUrl = `${PLOTLINK_URL}/story/${storylineId}`;

  try {
    if (!isPlot) {
      const res = await fetch(url);
      if (!res.ok) return c.json({ ok: true, fetched: false });
      const og = extractOgTitle(await res.text());
      if (!og) return c.json({ ok: true, fetched: false });
      return c.json({ ok: true, fetched: true, storylineTitle: og });
    }

    const plotRes = await fetch(url);
    if (!plotRes.ok) return c.json({ ok: true, fetched: false });
    const plotOg = extractOgTitle(await plotRes.text());
    if (!plotOg) return c.json({ ok: true, fetched: false });
    let storylineOg: string | null = null;
    try {
      const storylineRes = await fetch(storylineUrl);
      storylineOg = storylineRes.ok ? extractOgTitle(await storylineRes.text()) : null;
    } catch {
      // Best-effort read only. If the storyline page fetch rejects, keep the
      // successful plot-page title and fall back to last-segment stripping.
      storylineOg = null;
    }
    return c.json({ ok: true, fetched: true, plotTitle: leadingTitleSegment(plotOg, storylineOg) });
  } catch {
    // Network/parse failure → inconclusive; never block on a flaky read.
    return c.json({ ok: true, fetched: false });
  }
});

/** POST /api/publish/file — publish a story file on-chain (streams progress) */
publish.post("/file", async (c) => {
  const body = await c.req.json<{
    storyName: string;
    fileName: string;
    title: string;
    content: string;
    genre?: string;
    language?: string;
    isNsfw?: boolean;
    storylineId?: number;
    contentType?: string;
  }>();

  if (!body.title || !body.content) {
    return c.json({ error: "title and content required" }, 400);
  }

  // Canonicalize the genre up-front (#412) so it's the canonical PlotLink value in
  // the content metadata, and a non-mappable genre fails here with a clear message
  // instead of after the on-chain publish.
  const genreResult = resolveGenre(body.genre);
  if ("error" in genreResult) {
    return c.json({ error: genreResult.error }, 400);
  }
  const canonicalGenre = genreResult.genre;

  // Enforce character limits
  const isGenesis = body.fileName === "genesis.md";
  const isPlot = /^plot-\d+\.md$/.test(body.fileName);
  const charLimit = (isGenesis || isPlot) ? 10000 : null;
  if (charLimit && body.content.length > charLimit) {
    return c.json({
      error: `Content exceeds ${charLimit.toLocaleString()} character limit (${body.content.length.toLocaleString()} chars). Reduce content before publishing.`,
    }, 400);
  }

  // Cartoon plot readiness — block invalid/incomplete publish markdown.
  // Derive cartoon status from server-side .story.json metadata (NOT the
  // request body) so a direct API caller cannot bypass by omitting/faking
  // contentType.
  if (isPlot) {
    const storyDir = path.join(STORIES_DIR, body.storyName);
    const isCartoon = readStoryMeta(storyDir).contentType === "cartoon";
    if (isCartoon) {
      const plotFile = body.fileName.replace(/\.md$/, "");
      let cutsFile;
      try {
        cutsFile = readCutsFile(storyDir, plotFile);
      } catch (err) {
        return c.json({ error: `Cannot publish: ${(err as Error).message}` }, 400);
      }
      if (!cutsFile) {
        return c.json({ error: `Cannot publish: ${plotFile}.cuts.json not found. Generate cuts and upload final images first.` }, 400);
      }

      // Block on stale recorded asset paths — a cut whose cleanImagePath /
      // finalImagePath points to a missing/invalid local file is not actually
      // ready, and the generic markdown issues would obscure why (#302). Skip
      // already-uploaded cuts: their content is on IPFS (uploadedUrl), so a
      // missing LOCAL asset must not block re-publish.
      const stale = findStaleAssetPaths(
        cutsFile.cuts,
        (rel) => isValidImageAsset(storyDir, rel),
      ).filter((issue) => {
        const cut = cutsFile.cuts.find((ct) => ct.id === issue.cutId);
        return !cut?.uploadedUrl;
      });
      if (stale.length > 0) {
        const messages = stale.map((s) => s.message);
        return c.json(
          { error: `Cartoon plot not ready to publish: ${messages.join("; ")}`, issues: messages },
          400,
        );
      }

      const { ready, issues } = checkMarkdownReadiness(body.content, cutsFile.cuts);
      if (!ready) {
        return c.json({ error: `Cartoon plot not ready to publish: ${issues.join("; ")}`, issues }, 400);
      }
    }
  }

  // Get wallet
  let wallets;
  try {
    wallets = listAgentWallets();
  } catch (err) {
    console.error("[publish/file] listAgentWallets error:", err);
    return c.json({ error: `OWS wallet error: ${err instanceof Error ? err.message : String(err)}` }, 500);
  }
  const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
  if (!wallet) return c.json({ error: "No OWS wallet" }, 400);

  console.log("[publish/file] Starting publish for", body.storyName, body.fileName, "wallet:", wallet.name);

  // Determine if this is genesis (createStoryline) or plot (chainPlot)
  // isPlot already defined above from validation

  return streamSSE(c, async (stream) => {
    try {
      let result;
      if (isPlot && body.storylineId) {
        // Chain plot to existing storyline
        result = await publishPlot(
          wallet.name,
          body.storylineId,
          body.title,
          body.content,
          canonicalGenre,
          async (progress) => {
            await stream.writeSSE({ data: JSON.stringify(progress) });
          },
          body.language,
        );
      } else {
        // Create new storyline (genesis or first file)
        result = await publishStoryline(
          wallet.name,
          body.title,
          body.content,
          canonicalGenre,
          async (progress) => {
            await stream.writeSSE({ data: JSON.stringify(progress) });
          },
          body.language,
          body.isNsfw,
          body.contentType,
        );
      }

      await stream.writeSSE({
        data: JSON.stringify({
          step: "done",
          txHash: result.txHash,
          storylineId: result.storylineId,
          plotIndex: result.plotIndex,
          contentCid: result.contentCid,
          gasCost: result.gasCost,
          indexError: result.indexError,
        }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Publish failed";
      await stream.writeSSE({
        data: JSON.stringify({ step: "error", message, error: message }),
      });
    }
  });
});

/** POST /api/publish/retry-index — retry indexing for a published file */
publish.post("/retry-index", async (c) => {
  const body = await c.req.json<{
    storyName: string;
    fileName: string;
    txHash: string;
    content: string;
    storylineId?: number;
  }>();

  if (!body.txHash || !body.content) {
    return c.json({ error: "txHash and content required" }, 400);
  }

  const PLOTLINK_URL = process.env.NEXT_PUBLIC_APP_URL || "https://plotlink.xyz";
  const isPlot = /^plot-\d+\.md$/.test(body.fileName);
  const endpoint = isPlot ? "plot" : "storyline";
  const indexBody = isPlot
    ? { txHash: body.txHash, content: body.content }
    : { txHash: body.txHash, content: body.content, genre: undefined };

  try {
    const indexRes = await fetch(`${PLOTLINK_URL}/api/index/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(indexBody),
    });
    const indexData = await indexRes.json().catch(() => ({})) as Record<string, string>;
    if (!indexRes.ok || indexData.error) {
      const error = indexData.error || `Indexing failed: HTTP ${indexRes.status}`;
      return c.json({ ok: false, error });
    }
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Indexing request failed";
    return c.json({ ok: false, error: message });
  }
});

/** POST /api/publish/upload-cover — upload cover image with wallet signature */
publish.post("/upload-cover", async (c) => {
  try {
    const wallets = listAgentWallets();
    const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
    if (!wallet) return c.json({ error: "No OWS wallet" }, 400);

    const address = getBaseAddress(wallet);
    if (!address) return c.json({ error: "No EVM address on wallet" }, 400);

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return c.json({ error: "No image file provided" }, 400);
    }

    // Validate file size (1MB max)
    if (file.size > 1024 * 1024) {
      return c.json({ error: "Image exceeds 1MB limit" }, 400);
    }

    // Validate file type — only WebP and JPEG accepted by the plotlink server
    const allowedTypes = ["image/webp", "image/jpeg"];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: "Only WebP and JPEG images are accepted" }, 400);
    }

    const bytesError = await imageBytesError(file);
    if (bytesError) return c.json({ error: bytesError }, 400);

    const cid = await uploadCoverImage(wallet.name, address as `0x${string}`, file);
    return c.json({ cid });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Cover upload failed";
    return c.json({ error: message }, 500);
  }
});

/** POST /api/publish/upload-plot-image — upload plot illustration with wallet signature */
publish.post("/upload-plot-image", async (c) => {
  try {
    const wallets = listAgentWallets();
    const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
    if (!wallet) return c.json({ error: "No OWS wallet" }, 400);

    const address = getBaseAddress(wallet);
    if (!address) return c.json({ error: "No EVM address on wallet" }, 400);

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return c.json({ error: "No image file provided" }, 400);
    }

    // Validate file size (1MB max)
    if (file.size > 1024 * 1024) {
      return c.json({ error: "Image exceeds 1MB limit" }, 400);
    }

    // Validate file type — only WebP and JPEG accepted by the plotlink server
    const allowedTypes = ["image/webp", "image/jpeg"];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: "Only WebP and JPEG images are accepted" }, 400);
    }

    const result = await uploadPlotImage(wallet.name, address as `0x${string}`, file);
    return c.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Plot image upload failed";
    return c.json({ error: message }, 500);
  }
});

/** POST /api/publish/update-storyline — update storyline metadata with wallet signature */
publish.post("/update-storyline", async (c) => {
  try {
    const wallets = listAgentWallets();
    const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
    if (!wallet) return c.json({ error: "No OWS wallet" }, 400);

    const address = getBaseAddress(wallet);
    if (!address) return c.json({ error: "No EVM address on wallet" }, 400);

    const body = await c.req.json<{
      storylineId: number;
      coverCid?: string | null;
      genre?: string;
      language?: string;
      isNsfw?: boolean;
    }>();

    if (!body.storylineId) {
      return c.json({ error: "storylineId required" }, 400);
    }

    // Canonicalize the genre before the signed on-chain metadata update so a
    // natural label (e.g. "Sci-Fi") becomes "Science Fiction" rather than being
    // rejected by PlotLink and leaving the public story UNCATEGORIZED (#412).
    const genreResult = resolveGenre(body.genre);
    if ("error" in genreResult) {
      return c.json({ error: genreResult.error }, 400);
    }

    await updateStoryline(
      wallet.name,
      address as `0x${string}`,
      body.storylineId,
      {
        coverCid: body.coverCid,
        genre: genreResult.genre,
        language: body.language,
        isNsfw: body.isNsfw,
      },
    );

    return c.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Update failed";
    return c.json({ error: message }, 500);
  }
});

export { publish as publishRoutes };
