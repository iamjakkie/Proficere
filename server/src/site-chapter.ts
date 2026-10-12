import { AppError, hasProse } from "@progress-island/shared";

const FETCH_LIMIT = 12;
const HTML_LIMIT = 1_500_000;

export type SiteLink = { text: string; url: string };

/** Compare a chapter title with a link that may use LaTeX for Greek letters. */
export function sectionMatchKey(value: string): string {
  const mapped = value
    .replace(/\\\(|\\\)|\\\[|\\\]/g, " ")
    .replace(/\\alpha/gi, "α")
    .replace(/\\beta/gi, "β")
    .replace(/\\gamma/gi, "γ")
    .replace(/[αΑ]/g, "a")
    .replace(/[βΒ]/g, "b")
    .replace(/[γΓ]/g, "g");
  return mapped.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function findSectionLink(links: SiteLink[], title: string): SiteLink | undefined {
  const key = sectionMatchKey(title);
  if (key.length < 3) return undefined;
  return links.find((link) => sectionMatchKey(link.text) === key);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => String.fromCodePoint(parseInt(digits, 16)));
}

function withoutChrome(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ");
}

/** Keep headings and paragraphs. Navigation and scripts stay out of the chapter text. */
export function articleText(html: string): string {
  const stripped = withoutChrome(html);
  const parts: string[] = [];
  const blocks = /<(h[1-4]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of stripped.matchAll(blocks)) {
    const text = decodeEntities(match[2].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (text.length >= 2) parts.push(text);
  }
  return parts.join("\n");
}

export function linksFromHtml(html: string, baseUrl: string): SiteLink[] {
  const links: SiteLink[] = [];
  const anchors = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchors)) {
    const text = decodeEntities(match[2].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    let url: URL;
    try {
      url = new URL(match[1], baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    url.hash = "";
    links.push({ text, url: url.toString() });
  }
  return links;
}

function isCrawlTarget(url: URL, catalog: URL): boolean {
  if (url.host !== catalog.host) return false;
  if (url.pathname.toLowerCase() === catalog.pathname.toLowerCase()) return false;
  const path = url.pathname.toLowerCase();
  if (["book", "contact", "privacy", "policy", "accessibility", "cookie"].some((part) => path.includes(part))) {
    return false;
  }
  if (/^\/(cn|de|jp|es|pt|vi)\//i.test(url.pathname)) return false;
  if (/_(cn|de|jp|es|pt|vi)\.html$/i.test(path)) return false;
  return path.endsWith(".html");
}

async function readHtml(url: string, catalogHost: string): Promise<{ html: string; finalUrl: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "text/html",
        "User-Agent": "Mozilla/5.0 (compatible; ProgressIsland/0.1)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError(
      "Could not open the linked site. Check the connection and try again.",
      "site_fetch",
      502,
    );
  }
  if (!response.ok) {
    throw new AppError(
      "The linked site did not return this section. Nothing was sent to the model.",
      "site_fetch",
      502,
    );
  }
  const finalUrl = new URL(response.url);
  if (finalUrl.host !== catalogHost) {
    throw new AppError("The linked page left the original site.", "site_fetch", 502);
  }
  const html = await response.text();
  if (html.length > HTML_LIMIT) {
    throw new AppError("The linked page was too large to read.", "site_fetch", 502);
  }
  return { html, finalUrl: response.url };
}

/**
 * Find the section page linked from a catalog page and return its prose.
 * One extra hop covers sections that are linked from a sibling page, not the catalog itself.
 */
export async function fetchSectionFromSite(
  catalogUrl: string,
  title: string,
): Promise<{ url: string; text: string }> {
  let catalog: URL;
  try {
    catalog = new URL(catalogUrl);
  } catch {
    throw new AppError("This book has no usable site link.", "site_fetch", 400);
  }
  const first = await readHtml(catalog.toString(), catalog.host);
  const queue: { html: string; finalUrl: string }[] = [first];
  const seen = new Set<string>([new URL(first.finalUrl).pathname]);
  let fetched = 0;

  while (queue.length > 0) {
    const page = queue.shift()!;
    const links = linksFromHtml(page.html, page.finalUrl);
    const match = findSectionLink(links, title);
    if (match) {
      const matched = new URL(match.url);
      const html =
        matched.pathname === new URL(page.finalUrl).pathname
          ? page.html
          : (await readHtml(match.url, catalog.host)).html;
      const text = articleText(html);
      if (!hasProse(text)) {
        throw new AppError(
          "The linked page did not contain this section’s prose. Nothing was sent to the model.",
          "missing_source",
          400,
        );
      }
      return { url: match.url, text };
    }
    if (fetched >= FETCH_LIMIT) continue;
    for (const link of links) {
      let url: URL;
      try {
        url = new URL(link.url);
      } catch {
        continue;
      }
      if (!isCrawlTarget(url, catalog) || seen.has(url.pathname)) continue;
      seen.add(url.pathname);
      fetched += 1;
      try {
        queue.push(await readHtml(url.toString(), catalog.host));
      } catch {
        // A side page can 404 without blocking the section that is linked elsewhere.
      }
      if (fetched >= FETCH_LIMIT) break;
    }
  }

  throw new AppError(
    `“${title}” is not linked from the saved site, so there is no section text to review yet.`,
    "missing_source",
    400,
  );
}
