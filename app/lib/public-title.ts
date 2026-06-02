/**
 * Parse the public title PlotLink renders into a story/plot page's metadata
 * (#379). There is no public JSON read endpoint (`/api/storyline/<id>` 404s), so
 * the reliable source for the INDEXED public title is the rendered page's
 * `<meta property="og:title">` (mirrored by `<title> … — PlotLink`):
 *
 *   /story/<id>            → og:title "<storylineTitle>"                (e.g. "genesis")
 *   /story/<id>/<plotIdx>  → og:title "<plotTitle> — <storylineTitle>"  (e.g. "plot-01 — genesis")
 *
 * These helpers are pure so they can be unit-tested against the real page shape;
 * the OWS server does the page fetch (no CORS) in the publish route.
 */

// PlotLink joins title segments with a spaced em dash, and suffixes <title> with
// the site name.
const TITLE_SEP = " — ";
const SITE_SUFFIX = /\s*—\s*PlotLink\s*$/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/g, '"');
}

/**
 * The page's public title text: `og:title` when present, else `<title>` with the
 * " — PlotLink" site suffix stripped. Returns null when neither is present.
 */
export function extractOgTitle(html: string): string | null {
  const og =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*\scontent=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]+\scontent=["']([^"']*)["'][^>]*property=["']og:title["']/i);
  const ogVal = og?.[1]?.trim();
  if (ogVal) return decodeEntities(ogVal);

  const t = html.match(/<title>([^<]*)<\/title>/i);
  const tVal = t?.[1] ? decodeEntities(t[1].trim()).replace(SITE_SUFFIX, "").trim() : "";
  return tVal || null;
}

/**
 * The leading segment of a page title — the PLOT title on a plot page, where
 * og:title is "<plotTitle> — <storylineTitle>". Returns the whole value when
 * there is no separator. Null for empty/missing input.
 */
export function leadingTitleSegment(title: string | null): string | null {
  if (!title) return null;
  const seg = title.split(TITLE_SEP)[0]?.trim();
  return seg || null;
}
