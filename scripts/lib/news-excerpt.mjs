// Shared across all news scrapers (F1, F2, F3, FE, IndyCar): fetches a
// single article URL and pulls a readable excerpt out of it via Readability,
// plus the low-content filter used to drop promo stubs / paywalled snippets.
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

const DEFAULT_UA = "Mozilla/5.0 (compatible; racing-news/1.0)";

// Drops "label" headlines like "QUALIFYING: …", "GALLERY: …", "TEAM RADIO: …".
// Requires 4+ characters before the colon so real prefixes like "F1:", "F2:",
// "FIA:" and "FE:" are kept.
const LABEL_PREFIX_RE = /^[A-Z][A-Z0-9 &'’\-\/!?.,()]{3,}:/;

export function isLabelledTitle(title) {
  return !!title && LABEL_PREFIX_RE.test(title.trim());
}

export function isLowContent(excerpt, minLength = 300) {
  if (!excerpt) return true;
  return excerpt.trim().length < minLength;
}

const CHROME_LINE_RES = [
  /^F1 Store\b/i, /^RACE TICKETS\b/i, /^Download the F1 calendar$/i,
  /^Never miss a thing from the Formula 1 season/i,
  /^\[Article continues below\]$/i, /^©\s/,
  /^(Find out more|READ MORE|YouTube)$/i,
  /^(GEN4|WATCH|TICKETS|HIGHLIGHTS|CALENDAR|UNMISSABLE|FOLLOW|HOSPITALITY):/,
  /^(Featured|Driver News|Team News)$/,
  /^(\d+ (DAY|HOUR|WEEK)S? AGO|[A-Z]{3} \d{1,2}, \d{4})$/,
];
const TAIL_CUT_RES = [
  /^(Next Up|Related Articles|More news)$/i,
  /^\d+ (DAY|HOUR|WEEK)S? AGO\s•\s/,
];

export function stripChrome(paragraphs) {
  const out = [];
  for (const p of paragraphs) {
    if (TAIL_CUT_RES.some((re) => re.test(p))) break;
    if (p.length < 200 && CHROME_LINE_RES.some((re) => re.test(p))) continue;
    out.push(p);
  }
  return out;
}

// Returns { excerpt, html } — html is the raw page source in case a caller
// also needs to pull other metadata (e.g. a publish date) out of it without
// fetching the page twice.
export async function fetchExcerpt(url, { userAgent = DEFAULT_UA } = {}) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": userAgent } });
    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (!article || !article.content) return { excerpt: null, html };

    const markedHtml = article.content
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n\n");

    const textDom = new JSDOM(`<div>${markedHtml}</div>`);
    const paragraphs = stripChrome(textDom.window.document.body.textContent
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean));

    return { excerpt: paragraphs.length ? paragraphs.join("\n\n") : null, html };
  } catch (e) {
    console.error(`  ⚠ excerpt fetch failed for ${url}: ${e.message}`);
    return { excerpt: null, html: null };
  }
}
