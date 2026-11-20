/** Public lesson titles copied from a course page. Counts that disagree with the page are warnings. */
export type SyllabusItems = {
  titles: string[];
  warnings: string[];
  notes: string[];
};

export const SYLLABUS_ITEM_CAP = 2000;

function clean(value: string): string {
  return decode(value)
    .replace(/\s+/g, " ")
    .trim();
}

function decode(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/&bull;/g, "•")
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

function textOf(html: string): string {
  return clean(html.replace(/<[^>]+>/g, " "));
}

/** Inner HTML of the element that starts at `start`, matching the same tag by depth. */
function elementAt(html: string, start: number): { tag: string; inner: string; end: number } | null {
  const open = /^<([a-z0-9]+)\b[^>]*>/i.exec(html.slice(start));
  if (!open) return null;
  const tag = open[1].toLowerCase();
  const re = new RegExp(`</?${tag}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        return {
          tag,
          inner: html.slice(start + open[0].length, match.index),
          end: match.index + match[0].length,
        };
      }
    } else depth += 1;
  }
  return null;
}

/** Titles of the direct `<li>` children. A title is the first text in the item, not the duration. */
function listItemTitles(ulInner: string): string[] {
  const titles: string[] = [];
  let index = 0;
  while (index < ulInner.length) {
    const open = ulInner.slice(index).search(/<li\b/i);
    if (open < 0) break;
    const at = index + open;
    const item = elementAt(ulInner, at);
    if (!item) break;
    const leading = item.inner.split(/<(?!\/)/)[0] ?? "";
    const title = clean(leading) || textOf(item.inner).split("•")[0].trim();
    if (title) titles.push(title);
    index = item.end;
  }
  return titles;
}

/**
 * Every Coursera item in page order.
 * A group heading is an `<h5>` such as "7 videos • Total 26 minutes", followed by a `<ul>`.
 * The number on that heading is checked against the items found.
 */
export function courseraSyllabus(html: string): SyllabusItems & { title: string } {
  const src = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const title = textOf(src.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const titles: string[] = [];
  const warnings: string[] = [];
  let moduleName = "";
  const heads = /<h3\b[^>]*>|<h5\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = heads.exec(src))) {
    const el = elementAt(src, match.index);
    if (!el) continue;
    heads.lastIndex = el.end;
    if (el.tag === "h3") {
      moduleName = textOf(el.inner);
      continue;
    }
    const label = textOf(el.inner);
    const counted = label.match(/^(\d+)\s+(.+?)(?:\s*[•·|]|$)/);
    if (!counted) continue;
    const expected = Number(counted[1]);
    const ulAt = src.slice(el.end).search(/<ul\b/i);
    if (ulAt < 0) {
      warnings.push(`${moduleName || "Course"} / ${label}: expected ${expected}, found no list`);
      continue;
    }
    const list = elementAt(src, el.end + ulAt);
    const found = list ? listItemTitles(list.inner) : [];
    if (found.length !== expected) {
      warnings.push(`${moduleName || "Course"} / ${label}: expected ${expected}, got ${found.length}`);
    }
    for (const item of found) {
      if (item.length < 1 || item.length > 300) continue;
      titles.push(item);
      if (titles.length >= SYLLABUS_ITEM_CAP) {
        warnings.push("Stopped after 2000 lessons.");
        return { title, titles, warnings, notes: [`${title || "Course"}: ${titles.length} items`] };
      }
    }
  }
  return {
    title,
    titles,
    warnings,
    notes: titles.length ? [`${title || "Course"}: ${titles.length} items`] : [],
  };
}

/** Course pages linked from a Coursera specialization or professional certificate, in page order. */
export function courseraCourseLinks(html: string): string[] {
  const links: string[] = [];
  const anchors = /<a\b[^>]*data-e2e="sdp-course-list-link"[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchors.exec(html))) {
    const href = /\bhref="([^"]+)"/i.exec(match[0])?.[1] ?? "";
    if (!href) continue;
    let absolute: string;
    try {
      const parsed = new URL(href, "https://www.coursera.org");
      parsed.search = "";
      parsed.hash = "";
      absolute = parsed.href.replace(/\/$/, "");
    } catch {
      continue;
    }
    if (!absolute.includes("/learn/")) continue;
    if (!links.includes(absolute)) links.push(absolute);
  }
  return links;
}

/** Udacity nanodegree or course outline from the Next.js page data. */
export function udacityLessonTitles(html: string): SyllabusItems {
  const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!raw) {
    return { titles: [], warnings: ["No __NEXT_DATA__ found; Udacity page structure has changed."], notes: [] };
  }
  let parts: unknown;
  try {
    const props = JSON.parse(raw) as { props?: { pageProps?: { staticProgramOutlineSectionProps?: { parts?: unknown } } } };
    parts = props.props?.pageProps?.staticProgramOutlineSectionProps?.parts;
  } catch {
    return { titles: [], warnings: ["Udacity outline JSON could not be read."], notes: [] };
  }
  if (!Array.isArray(parts) || parts.length === 0) {
    return { titles: [], warnings: ["No program outline found in __NEXT_DATA__."], notes: [] };
  }
  const titles: string[] = [];
  const notes: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const row = part as { title?: unknown; lessons?: unknown };
    const name = clean(String(row.title ?? "Course")) || "Course";
    const lessons = Array.isArray(row.lessons) ? row.lessons : [];
    let count = 0;
    for (const lesson of lessons) {
      if (!lesson || typeof lesson !== "object") continue;
      const title = clean(String((lesson as { title?: unknown }).title ?? ""));
      if (title.length < 2 || title.length > 300) continue;
      titles.push(title);
      count += 1;
      if (titles.length >= SYLLABUS_ITEM_CAP) {
        notes.push(`${name}: ${count} items`);
        return { titles, warnings: ["Stopped after 2000 lessons."], notes };
      }
    }
    notes.push(`${name}: ${count} items`);
  }
  return { titles, warnings: [], notes };
}

/** Crash Course topic videos. `next` is the following page, when the topic is paginated. */
export function crashCourseTitles(html: string): { titles: string[]; next: string | null } {
  const titles: string[] = [];
  const heads = /<h2\b[^>]*class="[^"]*\bfl-post-title\b[^"]*"[^>]*>([\s\S]*?)<\/h2>/gi;
  let match: RegExpExecArray | null;
  while ((match = heads.exec(html))) {
    const title = textOf(match[1]);
    if (title.length < 2 || title.length > 300) continue;
    titles.push(title);
    if (titles.length >= SYLLABUS_ITEM_CAP) break;
  }
  const next =
    html.match(/<a\b[^>]*rel="next"[^>]*href="([^"]+)"/i)?.[1] ??
    html.match(/<link\b[^>]*rel="next"[^>]*href="([^"]+)"/i)?.[1] ??
    html.match(/<a\b[^>]*class="[^"]*\bnext\b[^"]*"[^>]*href="([^"]+)"/i)?.[1] ??
    null;
  return { titles, next };
}

/** Udacity course or nanodegree page. Null for any other URL. */
export function udacityCourseUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "udacity.com") return null;
  if (!/^\/course\/[^/]+/i.test(parsed.pathname)) return null;
  parsed.search = "";
  parsed.hash = "";
  return parsed.href;
}

/** Crash Course topic page. Null for any other URL. */
export function crashCourseTopicUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "thecrashcourse.com") return null;
  if (!/^\/topic\/[^/]+/i.test(parsed.pathname)) return null;
  parsed.search = "";
  parsed.hash = "";
  return parsed.href;
}

const UDEMY_ITEMS = new Set(["lecture", "quiz", "practice"]);

/** Lesson, quiz, and practice titles from Udemy's public curriculum, in page order. */
export function udemyItemTitles(pages: unknown[]): string[] {
  const titles: string[] = [];
  for (const page of pages) {
    const results = (page as { results?: unknown })?.results;
    if (!Array.isArray(results)) continue;
    for (const item of results) {
      if (!item || typeof item !== "object") continue;
      const row = item as { _class?: unknown; title?: unknown };
      if (!UDEMY_ITEMS.has(String(row._class))) continue;
      const title = clean(String(row.title ?? ""));
      if (title.length < 2 || title.length > 300) continue;
      titles.push(title);
      if (titles.length >= SYLLABUS_ITEM_CAP) return titles;
    }
  }
  return titles;
}
