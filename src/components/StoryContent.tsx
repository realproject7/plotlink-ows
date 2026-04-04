"use client";

import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

/**
 * Sanitization schema — fiction-focused Markdown only.
 * No images, tables, or code blocks.
 */
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    "p",
    "strong",
    "em",
    "del",
    "h1",
    "h2",
    "h3",
    "blockquote",
    "hr",
    "ul",
    "ol",
    "li",
    "br",
    "code",
  ],
  attributes: {},
};

/**
 * Renders story content as Markdown with fiction-focused styling.
 * Plain text stories render correctly (plain text is valid Markdown).
 */
export function StoryContent({ content }: { content: string }) {
  return (
    <div className="ruled-paper story-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Write/Preview toggle for story editing forms.
 */
export function WritePreviewToggle({
  activeTab,
  onTabChange,
}: {
  activeTab: "write" | "preview";
  onTabChange: (tab: "write" | "preview") => void;
}) {
  return (
    <div className="mb-2 flex gap-1 border-b border-[var(--border)] pb-1">
      <button
        type="button"
        onClick={() => onTabChange("write")}
        className={`rounded-t px-3 py-1 text-xs font-medium transition-colors ${
          activeTab === "write"
            ? "bg-accent/15 text-accent"
            : "text-muted hover:text-foreground"
        }`}
      >
        Write
      </button>
      <button
        type="button"
        onClick={() => onTabChange("preview")}
        className={`rounded-t px-3 py-1 text-xs font-medium transition-colors ${
          activeTab === "preview"
            ? "bg-accent/15 text-accent"
            : "text-muted hover:text-foreground"
        }`}
      >
        Preview
      </button>
    </div>
  );
}

/**
 * Preview pane that matches story page rendering.
 */
export function ContentPreview({ content }: { content: string }) {
  if (!content.trim()) {
    return (
      <div className="ruled-paper text-muted min-h-[336px] text-sm italic">
        Nothing to preview
      </div>
    );
  }
  return (
    <div className="min-h-[336px]">
      <StoryContent content={content} />
    </div>
  );
}
