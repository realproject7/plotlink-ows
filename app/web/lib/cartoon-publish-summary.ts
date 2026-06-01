// Pre-publish summary of cartoon publish markdown (#289).
//
// The OWS publish preview must show exactly what PlotLink will render — image
// blocks plus ANY non-image prose actually present in the markdown — separate
// from the cuts.json planning inspector. This helper derives a compact summary
// (image count, char count, and the non-image prose that would be published) so
// the operator can see at a glance whether planning/placeholder text leaked into
// the immutable markdown (the failure mode behind #286).

export interface CartoonMarkdownSummary {
  imageCount: number;
  charCount: number;
  /** Visible non-image, non-marker text that would be published as prose. */
  nonImageProse: string;
  /** First 200 chars of nonImageProse, for a compact pre-publish summary. */
  nonImageProsePreview: string;
}

const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

/** Length of the non-image prose excerpt surfaced in the pre-publish summary. */
export const PROSE_PREVIEW_LIMIT = 200;

export function summarizeCartoonMarkdown(markdown: string): CartoonMarkdownSummary {
  const imageCount = (markdown.match(IMAGE_RE) || []).length;
  const charCount = markdown.length;

  // Strip ows:cartoon-cut markers (HTML comments) and image references; whatever
  // remains is text that PlotLink would publish verbatim around the images.
  const nonImageProse = markdown
    .replace(HTML_COMMENT_RE, " ")
    .replace(IMAGE_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    imageCount,
    charCount,
    nonImageProse,
    nonImageProsePreview: nonImageProse.slice(0, PROSE_PREVIEW_LIMIT),
  };
}
