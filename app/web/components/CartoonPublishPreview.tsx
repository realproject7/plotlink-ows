import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { summarizeCartoonMarkdown, PROSE_PREVIEW_LIMIT } from "../lib/cartoon-publish-summary";
import { cartoonPublishVerdict, type CartoonReadinessStage } from "@app-lib/cartoon-readiness";

/** Custom sanitizer matching plotlink.xyz — allows img with src, alt, title. */
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: ["src", "alt", "title"],
  },
};

const VERDICT_TONE: Record<"ok" | "info" | "warning" | "blocker", string> = {
  ok: "border-green-300 bg-green-50 text-green-800",
  info: "border-accent/30 bg-accent/5 text-foreground",
  warning: "border-amber-300 bg-amber-50 text-amber-800",
  blocker: "border-error/30 bg-error/5 text-error",
};

interface CartoonPublishPreviewProps {
  /** The exact plot-NN.md markdown that will be sent to PlotLink. */
  content: string;
  /** Current readiness stage (from classifyCartoonReadiness), if known. */
  stage: CartoonReadinessStage | null;
}

/**
 * Publish Preview: renders EXACTLY the markdown PlotLink will publish (image
 * blocks plus any prose actually in the markdown), with a compact pre-publish
 * summary — image count, char count, readiness, and any non-image prose that
 * will be published. This is deliberately NOT the cuts.json planning view (see
 * CartoonPreview / Cut Inspector); planning prose must not masquerade as publish
 * content (#289).
 */
export function CartoonPublishPreview({ content, stage }: CartoonPublishPreviewProps) {
  const summary = summarizeCartoonMarkdown(content);
  const truncated = summary.nonImageProse.length > PROSE_PREVIEW_LIMIT;
  // Two-axis verdict (#421): "Publish possible?" (hard) vs "Recommended?" (soft),
  // so a placeholder is never shown as simply "Ready to publish".
  const verdict = cartoonPublishVerdict({
    stage,
    imageCount: summary.imageCount,
    hasNonImageProse: summary.nonImageProse.length > 0,
  });

  return (
    <div className="h-full overflow-y-auto" data-testid="cartoon-publish-preview">
      {/* Compact pre-publish content summary */}
      <div
        className="px-4 py-2 border-b border-border text-[10px] text-muted flex flex-wrap items-center gap-x-3 gap-y-1"
        data-testid="cartoon-publish-summary"
      >
        <span>{summary.imageCount} image{summary.imageCount === 1 ? "" : "s"}</span>
        <span>{summary.charCount.toLocaleString()} / 10,000 chars</span>
        <span
          className={`rounded-full px-2 py-0.5 font-medium ${verdict.possible ? "bg-green-100 text-green-800" : "bg-background text-muted"}`}
          data-testid="publish-possible"
        >
          {verdict.possible ? "Publish possible" : "Publish not possible yet"}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 font-medium ${verdict.recommended ? "bg-green-100 text-green-800" : verdict.tone === "warning" ? "bg-amber-100 text-amber-800" : "bg-background text-muted"}`}
          data-testid="publish-recommended"
        >
          {verdict.recommended ? "Recommended" : "Not recommended yet"}
        </span>
      </div>

      {/* Plain-language verdict headline + the single next action (#421), so the
          writer sees what to do instead of decoding validator strings. */}
      <div
        className={`px-4 py-2 border-b text-[11px] ${VERDICT_TONE[verdict.tone]}`}
        data-testid="cartoon-publish-verdict"
      >
        <p className="font-medium">{verdict.headline}</p>
        {verdict.detail && <p className="mt-0.5 opacity-90">{verdict.detail}</p>}
        {verdict.action && <p className="mt-0.5 opacity-90">→ {verdict.action}</p>}
      </div>

      {/* Any non-image text in the markdown WILL be published verbatim. Surface
          it explicitly so leftover planning/placeholder prose can't slip past. */}
      {summary.nonImageProse && (
        <div
          className="px-4 py-2 border-b border-amber-300 bg-amber-50 text-[11px] text-amber-800"
          data-testid="cartoon-nonimage-prose"
        >
          <p className="font-medium">⚠ Non-image text in the published markdown:</p>
          <p className="font-mono mt-1 whitespace-pre-wrap break-words">
            {summary.nonImageProsePreview}{truncated ? "…" : ""}
          </p>
          <p className="mt-1">
            This text publishes verbatim around the comic images. Remove it (or re-run
            “Prepare episode for publish”) if it is planning or placeholder prose.
          </p>
        </div>
      )}

      {/* Exactly what PlotLink renders from the published markdown */}
      <div className="max-w-lg mx-auto px-4 py-6">
        {content.trim() ? (
          <div className="prose max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkBreaks, remarkGfm]}
              rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
            >
              {content}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-muted italic text-sm" data-testid="cartoon-publish-empty">
            No publish markdown yet — build it from the cut plan (Edit → Upload &amp; Prepare for Publish).
          </p>
        )}
      </div>
    </div>
  );
}
