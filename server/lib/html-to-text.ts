import * as cheerio from "cheerio";

/**
 * Reduce a fetched HTML page to the text an AI extraction prompt actually
 * needs. Raw pages are dominated by <script>/<style>/head/nav boilerplate, so
 * truncating raw HTML at N chars usually captures none of the content —
 * and input tokens dominate the Gemini bill. Links are kept inline as
 * "text (href)" because extractors need application/posting URLs.
 */
export function htmlToTextForAI(html: string, maxChars = 12000): string {
  try {
    const $ = cheerio.load(html);
    $("script, style, noscript, svg, iframe, link, meta, header nav, footer").remove();
    // Preserve hrefs the extractors need (posting URLs) inline.
    $("a[href]").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href");
      const text = $el.text().trim();
      if (href && text) $el.replaceWith(`${text} (${href}) `);
    });
    const text = $("body").text().replace(/\s+/g, " ").trim();
    return text.substring(0, maxChars);
  } catch {
    // Fall back to a crude strip rather than sending nothing.
    return html.replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, maxChars);
  }
}
