import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { summarizeCartoonMarkdown, PROSE_PREVIEW_LIMIT } from "../lib/cartoon-publish-summary";
import type { CartoonReadinessStage } from "@app-lib/cartoon-readiness";

/** Custom sanitizer matching plotlink.xyz — allows img with src, alt, title. */
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: ["src", "alt", "title"],
  },
};

const STAGE_LABEL: Record<CartoonReadinessStage, string> = {
  "not-started": "Not started — plan the cuts",
  planning: "Planning — prepare the episode for publish",
  "awaiting-upload": "Awaiting image uploads",
  error: "Not publishable",
  ready: "Ready to publish",
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

  return (
    <div className="h-full overflow-y-auto" data-testid="cartoon-publish-preview">
      {/* Compact pre-publish content summary */}
      <div
        className="px-4 py-2 border-b border-border text-[10px] text-muted flex flex-wrap gap-x-4 gap-y-1"
        data-testid="cartoon-publish-summary"
      >
        <span>{summary.imageCount} image{summary.imageCount === 1 ? "" : "s"}</span>
        <span>{summary.charCount.toLocaleString()} / 10,000 chars</span>
        <span>Readiness: {stage ? STAGE_LABEL[stage] : "—"}</span>
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
