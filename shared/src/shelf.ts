import { z } from "zod";

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
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
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
  return ranked.slice(0, 8);
}

function matchedFinishedTitle(hit: ExerciseHit, titles: string[]): string | null {
  const hay = `${hit.title} ${hit.url} ${hit.snippet ?? ""}`.toLowerCase();
  return titles.find((title) => title.trim().length > 3 && hay.includes(title.trim().toLowerCase().slice(0, 48))) ?? null;
}

export function searchQueryFromTitles(titles: string[]): string {
  const parts: string[] = [];
  let length = 0;
  for (const title of titles.slice(0, 12)) {
    const piece = title.trim();
    if (!piece) continue;
    if (length + piece.length > 400) break;
    parts.push(piece);
    length += piece.length + 4;
  }
  if (!parts.length) return "";
  return `${parts.join(" OR ")} exercise pdf`;
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

export const EXERCISE_SEARCH_UNCONFIGURED =
  "Exercise search needs EXERCISE_SEARCH_ENDPOINT and EXERCISE_SEARCH_API_KEY in .env on this Mac. Nothing is searched until both are set, and no results are invented in their place.";
