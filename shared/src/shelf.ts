import { z } from "zod";

export const priorities = ["none", "high", "top"] as const;
export const PrioritySchema = z.enum(priorities);
export type Priority = z.infer<typeof PrioritySchema>;

export function cleanPriority(value: unknown): Priority {
  return value === "high" || value === "top" ? value : "none";
}

/** Top sorts before high, and high before none. */
export function priorityRank(priority: Priority): number {
  if (priority === "top") return 0;
  if (priority === "high") return 1;
  return 2;
}

/** Readings that are not books. Workbooks are exercise sheets accepted from search. */
export const articleKinds = ["article", "workbook"] as const;
export const ArticleKindSchema = z.enum(articleKinds);
export type ArticleKind = z.infer<typeof ArticleKindSchema>;

export const articleStatuses = ["not_started", "reading", "completed"] as const;
export const ArticleStatusSchema = z.enum(articleStatuses);
export type ArticleStatus = z.infer<typeof ArticleStatusSchema>;

export const ArticleSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  kind: ArticleKindSchema,
  note: z.string().nullable(),
  libraryFilename: z.string().nullable(),
  externalUrl: z.string().nullable(),
  sourceHost: z.string().nullable(),
  pagePosition: z.number().int().min(1),
  pageCount: z.number().int().nullable(),
  progressPercent: z.number().int().min(0).max(100),
  status: ArticleStatusSchema,
  /** Same category id a book stores in identifiers.category. Null until assigned. */
  category: z.string().nullable(),
  priority: PrioritySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Article = z.infer<typeof ArticleSchema>;

export const CourseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  url: z.string(),
  note: z.string().nullable(),
  lessonsConfirmed: z.boolean(),
  /** Same category id a book stores in identifiers.category. Null until assigned. */
  category: z.string().nullable(),
  priority: PrioritySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Course = z.infer<typeof CourseSchema>;

export const CourseLessonSchema = z.object({
  id: z.string().uuid(),
  courseId: z.string().uuid(),
  position: z.number().int(),
  title: z.string(),
  done: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CourseLesson = z.infer<typeof CourseLessonSchema>;

export const workshopColumns = ["todo", "in_progress", "test", "done"] as const;
export const WorkshopColumnSchema = z.enum(workshopColumns);
export type WorkshopColumn = z.infer<typeof WorkshopColumnSchema>;

export const WORKSHOP_COLUMN_LABELS: Record<WorkshopColumn, string> = {
  todo: "TODO",
  in_progress: "In progress",
  test: "Test",
  done: "Done",
};

export const WorkshopProjectSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  priority: PrioritySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkshopProject = z.infer<typeof WorkshopProjectSchema>;

export const WorkshopCardSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  column: WorkshopColumnSchema,
  title: z.string(),
  detail: z.string().nullable(),
  position: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkshopCard = z.infer<typeof WorkshopCardSchema>;

/** Cards the model may propose. Invalid shapes are rejected before anything is stored. */
export const WorkshopPlanSchema = z.object({
  cards: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(140),
        detail: z.string().trim().max(2000).optional().default(""),
        column: WorkshopColumnSchema.optional().default("todo"),
      }),
    )
    .min(1)
    .max(12),
});
export type WorkshopPlan = z.infer<typeof WorkshopPlanSchema>;

export const suggestionStatuses = ["active", "accepted", "rejected"] as const;
export const SuggestionStatusSchema = z.enum(suggestionStatuses);

export const ExerciseSuggestionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  url: z.string(),
  sourceHost: z.string(),
  reason: z.string(),
  matchedTitle: z.string().nullable(),
  status: SuggestionStatusSchema,
  articleId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type ExerciseSuggestion = z.infer<typeof ExerciseSuggestionSchema>;

export const IslandMarkerSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["article", "workbook", "course"]),
  title: z.string(),
  progress: z.number().min(0).max(1),
  href: z.string(),
});
export type IslandMarker = z.infer<typeof IslandMarkerSchema>;

export const ActiveCourseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  url: z.string(),
  doneCount: z.number().int(),
  lessonCount: z.number().int(),
  href: z.string(),
  others: z.number().int(),
});
export type ActiveCourse = z.infer<typeof ActiveCourseSchema>;

const SKIP_TITLE =
  /^(home|menu|login|log in|sign in|sign up|search|navigation|skip to content|cookie|privacy|contact|next|previous)$/i;

/** One lesson title per line. Bullets and numbers are stripped. Nothing is invented. */
export function parseLessonList(text: string): string[] {
  const titles: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cleaned = line
      .replace(/^\s*(?:[-*•]+|\d+[.)]|lecture\s+\d+[:.)]?|week\s+\d+[:.)]?)\s*/i, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length < 2 || cleaned.length > 180) continue;
    if (SKIP_TITLE.test(cleaned)) continue;
    if (titles.some((title) => title.toLowerCase() === cleaned.toLowerCase())) continue;
    titles.push(cleaned);
    if (titles.length >= 80) break;
  }
  return titles;
}

/** Public Udemy course slug, from `/course/:slug`. Null for any other URL. */
export function udemyCourseSlug(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "udemy.com") return null;
  const match = parsed.pathname.match(/^\/course\/([^/]+)\/?/);
  if (!match) return null;
  let slug = match[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    return null;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/.test(slug)) return null;
  return slug;
}

/** Section titles from Udemy's public curriculum pages. Lectures and practice items are ignored. */
export function udemySectionTitles(pages: unknown[]): string[] {
  const titles: string[] = [];
  for (const page of pages) {
    const results = (page as { results?: unknown })?.results;
    if (!Array.isArray(results)) continue;
    for (const item of results) {
      if (!item || typeof item !== "object") continue;
      const row = item as { _class?: unknown; title?: unknown };
      if (row._class !== "chapter") continue;
      const title = String(row.title ?? "").replace(/\s+/g, " ").trim();
      if (title.length < 2 || title.length > 180) continue;
      if (titles.some((existing) => existing.toLowerCase() === title.toLowerCase())) continue;
      titles.push(title);
      if (titles.length >= 80) return titles;
    }
  }
  return titles;
}

export type CourseraTarget = { kind: "specialization" | "course"; slug: string };

/** A Coursera specialization, professional certificate, or course. Null for any other URL. */
export function courseraTarget(url: string): CourseraTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "coursera.org") return null;
  const specialization = parsed.pathname.match(/^\/(?:specializations|professional-certificates)\/([^/]+)/);
  const course = parsed.pathname.match(/^\/learn\/([^/]+)/);
  const raw = specialization?.[1] ?? course?.[1];
  if (!raw) return null;
  let slug = raw;
  try {
    slug = decodeURIComponent(slug);
  } catch {
    return null;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/.test(slug)) return null;
  return { kind: specialization ? "specialization" : "course", slug };
}

/**
 * MIT OpenCourseWare lecture-notes page for a course.
 * A course home is rewritten to `/pages/lecture-notes/`. A notes URL is kept.
 */
export function ocwLectureNotesUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "ocw.mit.edu") return null;
  const course = parsed.pathname.match(/^\/courses\/([a-z0-9][a-z0-9-]{2,160})(?:\/|$)/i);
  if (!course) return null;
  return `https://ocw.mit.edu/courses/${course[1]}/pages/lecture-notes/`;
}

/** True when a pasted link can load a public section list. */
export function hasPublicSyllabus(url: string): boolean {
  return udemyCourseSlug(url) != null || courseraTarget(url) != null || ocwLectureNotesUrl(url) != null;
}

/** Course titles for a specialization, in the published courseIds order. */
export function courseraCourseTitles(ids: string[], courses: unknown[]): string[] {
  const byId = new Map<string, string>();
  for (const item of courses) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; name?: unknown };
    const id = String(row.id ?? "");
    const name = String(row.name ?? "").replace(/\s+/g, " ").trim();
    if (!id || name.length < 2 || name.length > 180) continue;
    byId.set(id, name);
  }
  const titles: string[] = [];
  for (const id of ids) {
    const name = byId.get(id);
    if (!name || titles.some((existing) => existing.toLowerCase() === name.toLowerCase())) continue;
    titles.push(name);
    if (titles.length >= 80) break;
  }
  return titles;
}

/** Module titles for one Coursera course. Individual lectures are ignored. */
export function courseraModuleTitles(modules: unknown[]): string[] {
  const titles: string[] = [];
  for (const item of modules) {
    if (!item || typeof item !== "object") continue;
    const name = String((item as { name?: unknown }).name ?? "").replace(/\s+/g, " ").trim();
    if (name.length < 2 || name.length > 180) continue;
    if (titles.some((existing) => existing.toLowerCase() === name.toLowerCase())) continue;
    titles.push(name);
    if (titles.length >= 80) break;
  }
  return titles;
}

export function lessonTitlesFromHtml(html: string): { titles: string[]; reason: string | null } {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const titles: string[] = [];
  const pattern = /<(h[1-3]|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutScripts))) {
    const inner = decodeHtml(match[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (inner.length < 3 || inner.length > 160) continue;
    if (SKIP_TITLE.test(inner)) continue;
    if (/sign in|log in|subscribe|cookie policy/i.test(inner)) continue;
    if (titles.some((title) => title.toLowerCase() === inner.toLowerCase())) continue;
    titles.push(inner);
    if (titles.length >= 40) break;
  }
  if (titles.length < 2) {
    return {
      titles: [],
      reason: "This page did not expose a heading list that looks like a syllabus. Paste the lesson titles instead.",
    };
  }
  return { titles, reason: null };
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, "-");
}

/** Lecture topics from an OCW notes table. PDF links are dropped. */
export function ocwLectureTitles(html: string): string[] {
  const section = html.match(/id="course-content-section"([\s\S]*?)<\/main>/i)?.[1] ?? html;
  const titles: string[] = [];
  const rows = section.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
      decodeHtml(match[1].replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (cells.length < 2) continue;
    const number = cells[0].replace(/\s+/g, "");
    const topic = cells[cells.length - 1]
      .replace(/\s*\(\s*PDF\s*\)\s*$/i, "")
      .replace(/\s+PDF\s*$/i, "")
      .trim();
    if (topic.length < 2 || topic.length > 180) continue;
    if (/^(topics?|lec\.?\s*#?)$/i.test(topic)) continue;
    const title = /^\d+[a-z]?$/i.test(number) ? `${number}. ${topic}` : topic;
    if (titles.some((existing) => existing.toLowerCase() === title.toLowerCase())) continue;
    titles.push(title);
    if (titles.length >= 80) break;
  }
  return titles;
}

export function isPdfLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

export function isUniversityHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (name.endsWith(".edu")) return true;
  if (/\.edu\.[a-z]{2}$/.test(name)) return true;
  if (/\.ac\.[a-z]{2}$/.test(name)) return true;
  if (/(^|\.)uni-[a-z0-9-]+\./.test(name)) return true;
  return false;
}

export type ExerciseHit = { title: string; url: string; snippet?: string };

export type RankedExercise = {
  title: string;
  url: string;
  sourceHost: string;
  university: boolean;
  reason: string;
  matchedTitle: string | null;
};

export function exerciseHitsFromJson(body: unknown): ExerciseHit[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  const list = Array.isArray(body) ? body : (record.items ?? record.results);
  if (!Array.isArray(list)) return [];
  const hits: ExerciseHit[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = String(row.title ?? row.name ?? "").trim();
    const url = String(row.url ?? row.link ?? "").trim();
    if (!title || !url) continue;
    const snippet = row.snippet ?? row.description;
    hits.push({ title, url, snippet: typeof snippet === "string" ? snippet : undefined });
  }
  return hits;
}

/** Keep public PDF links. University hosts sort first. Titles come only from the response. */
export function rankExerciseHits(hits: ExerciseHit[], finishedTitles: string[]): RankedExercise[] {
  const ranked: RankedExercise[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (!isPdfLink(hit.url)) continue;
    let parsed: URL;
    try {
      parsed = new URL(hit.url);
    } catch {
      continue;
    }
    if (seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    const matched = matchedFinishedTitle(hit, finishedTitles);
    const host = parsed.host;
    ranked.push({
      title: hit.title.trim().slice(0, 180),
      url: parsed.href,
      sourceHost: host,
      university: isUniversityHost(host),
      matchedTitle: matched,
      reason: matched ? `Matched “${matched}” on ${host}` : `PDF on ${host}`,
    });
  }
  ranked.sort((a, b) => Number(b.university) - Number(a.university));
  return ranked.slice(0, 24);
}

function matchedFinishedTitle(hit: ExerciseHit, titles: string[]): string | null {
  const hay = `${hit.title} ${hit.url} ${hit.snippet ?? ""}`.toLowerCase();
  return titles.find((title) => title.trim().length > 3 && hay.includes(title.trim().toLowerCase().slice(0, 48))) ?? null;
}

const READING_BOILERPLATE =
  /^(introduction|chapter outline|chapter review|chapter summary|section summary|review questions|summary|preface|foreword|overview|table of contents|contents|index|appendix|references|bibliography|key terms|key equations|conceptual questions|further reading|problems|exercises|problem set|problems\s*(?:&|and)\s*exercises|blank page|about openstax|about the authors?|about this book|answer key|solutions|glossary|acknowledg(?:e)?ments|copyright|title page|cover)$/i;

const UNIVERSITY_SITE_QUERY = "(site:.edu OR site:.ac.uk OR site:.edu.au OR site:.ac.nz OR site:.ac.za OR site:.edu.sg)";

type ReadingTopic = { chapter: number | null; heading: boolean; topic: string | null };

function readingTopic(title: string): ReadingTopic {
  const text = title.trim();
  const chapterHeading = text.match(/^chapter\s+(\d+)\s*[:.\-–—]?\s*(.*)$/i);
  if (chapterHeading) {
    return { chapter: Number(chapterHeading[1]), heading: true, topic: cleanTopic(chapterHeading[2] ?? "") };
  }
  const section = text.match(/^(\d+)\.\d+(?:\.\d+)*\s*[:.\-–—]?\s+(.+)$/);
  if (section) return { chapter: Number(section[1]), heading: false, topic: cleanTopic(section[2] ?? "") };
  const numbered = text.match(/^\d+\s*[:.\-–—]\s+(.+)$/);
  if (numbered) return { chapter: null, heading: false, topic: cleanTopic(numbered[1] ?? "") };
  const lecture = text.match(/^(?:lecture|week|section|part|unit)\s+\d+\s*[:.\-–—]?\s*(.*)$/i);
  if (lecture) return { chapter: null, heading: false, topic: cleanTopic(lecture[1] ?? "") };
  return { chapter: null, heading: false, topic: cleanTopic(text) };
}

function cleanTopic(value: string): string | null {
  const topic = value.trim().replace(/\s+/g, " ").replace(/"/g, "");
  if (topic.length < 3 || READING_BOILERPLATE.test(topic)) return null;
  return topic;
}

const TOPIC_STOP = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "for", "to", "with", "from", "by", "as", "at", "into",
  "along", "using", "based", "via", "its", "their", "between", "through", "about", "over", "under", "per",
  "vs", "versus", "system", "systems", "theory", "method", "methods", "analysis", "application",
  "applications", "principle", "principles", "fundamental", "fundamentals", "introduction", "basic",
  "basics", "advanced", "general", "overview", "review", "note", "notes", "chapter", "section", "part",
  "unit", "model", "models", "filter", "filters", "equation", "equations", "formula", "formulas",
  "function", "functions", "problem", "problems",
]);

export const EXERCISE_SEARCH_QUERY_CAP = 8;

export type SearchReading = { title: string; resource?: string; parentTitle?: string | null };

/** Chapter headings replace their numbered sections. Outlines and reviews are not topics. */
export function resourceTopics(titles: string[]): string[] {
  const parsed = titles.map((title) => readingTopic(title));
  const chapterTopic = new Map<number, string>();
  for (const item of parsed) {
    if (item.heading && item.chapter != null && item.topic && !chapterTopic.has(item.chapter)) {
      chapterTopic.set(item.chapter, item.topic);
    }
  }
  const topics: string[] = [];
  const seenChapters = new Set<number>();
  const seenTopics = new Set<string>();
  for (const item of parsed) {
    if (item.chapter != null && chapterTopic.has(item.chapter)) {
      if (seenChapters.has(item.chapter)) continue;
      seenChapters.add(item.chapter);
      const topic = chapterTopic.get(item.chapter)!;
      if (seenTopics.has(topic.toLowerCase())) continue;
      seenTopics.add(topic.toLowerCase());
      topics.push(topic);
      continue;
    }
    if (!item.topic || seenTopics.has(item.topic.toLowerCase())) continue;
    seenTopics.add(item.topic.toLowerCase());
    topics.push(item.topic);
  }
  return topics;
}

function stemTopicWord(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (
    word.length > 4 &&
    word.endsWith("s") &&
    !word.endsWith("ss") &&
    !word.endsWith("us") &&
    !word.endsWith("is") &&
    !word.endsWith("ics")
  ) {
    return word.slice(0, -1);
  }
  return word;
}

function contentTokens(topic: string): string[] {
  const tokens: string[] = [];
  for (const word of topic.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")) {
    if (word.length < 3 || TOPIC_STOP.has(word)) continue;
    const stem = stemTopicWord(word);
    if (!tokens.includes(stem)) tokens.push(stem);
  }
  return tokens;
}

function headWord(topic: string, stem: string): string {
  for (const word of topic.split(/\s+/)) {
    const bare = word.replace(/[^A-Za-z0-9-]/g, "");
    if (bare && stemTopicWord(bare.toLowerCase()) === stem) return bare;
  }
  return topic;
}

/** Group phrases that name the same subject. A shorter title wins over its longer variants. */
export function clusterTopics(topics: string[]): string[] {
  const clusters: { label: string; tokens: string[]; head: string }[] = [];
  for (const topic of topics) {
    const tokens = contentTokens(topic);
    if (!tokens.length) continue;
    const head = tokens[tokens.length - 1]!;
    const match = clusters.find((cluster) => {
      const known = new Set(cluster.tokens);
      const shared = tokens.filter((token) => known.has(token));
      if (!shared.length) return false;
      const smaller = Math.min(tokens.length, cluster.tokens.length);
      const subset = shared.length === smaller;
      const sameHead = head === cluster.head && head.length >= 5;
      const overlap = shared.length >= 2 && shared.length / smaller >= 0.5;
      return subset || sameHead || overlap;
    });
    if (!match) {
      clusters.push({ label: topic, tokens, head });
      continue;
    }
    for (const token of tokens) if (!match.tokens.includes(token)) match.tokens.push(token);
    const labelTokens = contentTokens(match.label);
    const labelSet = new Set(labelTokens);
    const incomingSet = new Set(tokens);
    const incomingSubset = tokens.every((token) => labelSet.has(token));
    const labelSubset = labelTokens.every((token) => incomingSet.has(token));
    if (incomingSubset && tokens.length < labelTokens.length) match.label = topic;
    else if (!incomingSubset && !labelSubset && head === match.head && head.length >= 5) {
      match.label = headWord(topic, head);
    }
  }
  return clusters.map((cluster) => cluster.label);
}

export function searchTopicsFromReadings(readings: SearchReading[]): string[] {
  const byResource = new Map<string, SearchReading[]>();
  const order: string[] = [];
  for (const reading of readings) {
    const key = reading.resource ?? "";
    if (!byResource.has(key)) {
      byResource.set(key, []);
      order.push(key);
    }
    byResource.get(key)!.push(reading);
  }
  const topics: string[] = [];
  for (const key of order) {
    const synthesized = byResource.get(key)!.map((reading) => {
      const parent = reading.parentTitle ? readingTopic(reading.parentTitle).topic : null;
      return parent ?? reading.title;
    });
    topics.push(...resourceTopics(synthesized));
  }
  return clusterTopics(topics).slice(0, EXERCISE_SEARCH_QUERY_CAP);
}

export function searchTopicsFromTitles(titles: string[]): string[] {
  return searchTopicsFromReadings(titles.map((title) => ({ title })));
}

export function googleQueryForTopic(topic: string): string {
  const clean = topic.replace(/"/g, "");
  const quoted = /\s/.test(clean) ? `"${clean}"` : clean;
  return `${quoted} (exercises OR "problem set" OR homework) filetype:pdf ${UNIVERSITY_SITE_QUERY}`;
}

export function searchQueriesFromReadings(readings: SearchReading[]): string[] {
  return searchTopicsFromReadings(readings).map(googleQueryForTopic);
}

export function searchQueriesFromTitles(titles: string[]): string[] {
  return searchTopicsFromTitles(titles).map(googleQueryForTopic);
}

export const EXERCISE_SEARCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function searchIsDue(lastAt: string | null, now = Date.now()): boolean {
  if (!lastAt) return true;
  const then = Date.parse(lastAt);
  if (!Number.isFinite(then)) return true;
  return now - then >= EXERCISE_SEARCH_INTERVAL_MS;
}

export function lessonProgress(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, done / total));
}

export const fieldKinds = ["book", "article", "course", "workshop"] as const;
export const FieldKindSchema = z.enum(fieldKinds);
export type FieldKind = z.infer<typeof FieldKindSchema>;

export const FieldResourceSchema = z.object({
  id: z.string().uuid(),
  kind: FieldKindSchema,
  title: z.string(),
  category: z.string().nullable(),
  href: z.string(),
  priority: PrioritySchema,
  /** 0–1 per chapter, lesson, or workshop task. An article is one segment. */
  segments: z.array(z.number().min(0).max(1)),
});
export type FieldResource = z.infer<typeof FieldResourceSchema>;

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** One segment per chapter. A book with no outline yet is one segment from its growth. */
export function bookSegments(chapters: { progressPercent: number }[], growth: number): number[] {
  if (!chapters.length) return [clampUnit(growth)];
  return chapters.map((chapter) => clampUnit(chapter.progressPercent / 100));
}

/** One segment per lesson. No lessons means no segments yet. */
export function courseSegments(lessons: { done: boolean }[]): number[] {
  return lessons.map((lesson) => (lesson.done ? 1 : 0));
}

export function articleSegments(progressPercent: number): number[] {
  return [clampUnit(progressPercent / 100)];
}

/** One segment per task. Only a task in Done is filled. */
export function workshopSegments(cards: { column: string }[]): number[] {
  return cards.map((card) => (card.column === "done" ? 1 : 0));
}

/** Whole segments only. A chapter or lesson still in progress is not finished. */
export function finishedSegmentCount(segments: number[]): number {
  return segments.filter((fill) => fill >= 1).length;
}

/** Share of segments that are done, including a partial segment. Rounded for the printed percent. */
export function sharePercent(segments: number[]): number {
  if (!segments.length) return 0;
  const done = segments.reduce((sum, fill) => sum + fill, 0);
  return Math.round((done / segments.length) * 100);
}

export function fieldFigure(kind: FieldKind, segments: number[]): string {
  if (kind === "article") return `${Math.round((segments[0] ?? 0) * 100)}%`;
  return `${finishedSegmentCount(segments)}/${segments.length}`;
}

export const EXERCISE_SEARCH_UNCONFIGURED =
  "Exercise search needs EXERCISE_SEARCH_ENDPOINT and EXERCISE_SEARCH_API_KEY in .env on this Mac. Nothing is searched until both are set, and no results are invented in their place.";
