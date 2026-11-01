import { v4 as uuid } from "uuid";
import {
  AppError,
  cleanPriority,
  lessonProgress,
  rankExerciseHits,
  type ActiveCourse,
  type Article,
  type ArticleKind,
  type ArticleStatus,
  type Course,
  type CourseLesson,
  type ExerciseHit,
  type Priority,
  type SearchReading,
  type ExerciseSuggestion,
  type IslandMarker,
  type WorkshopCard,
  type WorkshopColumn,
  type WorkshopProject,
} from "@progress-island/shared";
import type { Db } from "./db.js";
import { describeLibrary, resolveInsideLibrary } from "./library.js";
import { getSetting, listCategories, nowIso, setSetting } from "./store.js";

const OPT_IN_KEY = "exercise_search_opt_in";
const LAST_SEARCH_KEY = "exercise_search_last_at";

function articleStatus(percent: number, page: number): ArticleStatus {
  if (percent >= 100) return "completed";
  if (page > 1 || percent > 0) return "reading";
  return "not_started";
}

function mapArticle(row: Record<string, unknown>): Article {
  return {
    id: String(row.id),
    title: String(row.title),
    kind: row.kind === "workbook" ? "workbook" : "article",
    note: (row.note as string | null) ?? null,
    libraryFilename: (row.library_filename as string | null) ?? null,
    externalUrl: (row.external_url as string | null) ?? null,
    sourceHost: (row.source_host as string | null) ?? null,
    pagePosition: Number(row.page_position) || 1,
    pageCount: row.page_count == null ? null : Number(row.page_count),
    progressPercent: Number(row.progress_percent) || 0,
    status: (row.status as ArticleStatus) ?? "not_started",
    category: cleanAssignedCategory(row.category),
    priority: cleanPriority(row.priority),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapCourse(row: Record<string, unknown>): Course {
  return {
    id: String(row.id),
    title: String(row.title),
    url: String(row.url),
    note: (row.note as string | null) ?? null,
    lessonsConfirmed: Boolean(row.lessons_confirmed),
    category: cleanAssignedCategory(row.category),
    priority: cleanPriority(row.priority),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function cleanAssignedCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function mapLesson(row: Record<string, unknown>): CourseLesson {
  return {
    id: String(row.id),
    courseId: String(row.course_id),
    position: Number(row.position) || 0,
    title: String(row.title),
    done: Boolean(row.done),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapProject(row: Record<string, unknown>): WorkshopProject {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(String(row.tags_json ?? "[]"));
    if (Array.isArray(parsed)) tags = parsed.map((tag) => String(tag)).filter(Boolean);
  } catch {
    tags = [];
  }
  return {
    id: String(row.id),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    tags,
    priority: cleanPriority(row.priority),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapCard(row: Record<string, unknown>): WorkshopCard {
  const column = String(row.column_key);
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    column: column === "in_progress" || column === "test" || column === "done" ? column : "todo",
    title: String(row.title),
    detail: (row.detail as string | null) ?? null,
    position: Number(row.position) || 0,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSuggestion(row: Record<string, unknown>): ExerciseSuggestion {
  const status = String(row.status);
  return {
    id: String(row.id),
    title: String(row.title),
    url: String(row.url),
    sourceHost: String(row.source_host),
    reason: String(row.reason),
    matchedTitle: (row.matched_title as string | null) ?? null,
    status: status === "accepted" || status === "rejected" ? status : "active",
    articleId: (row.article_id as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export function listArticles(db: Db): Article[] {
  return (db.prepare("SELECT * FROM articles ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map(
    mapArticle,
  );
}

export function getArticle(db: Db, id: string): Article {
  const row = db.prepare("SELECT * FROM articles WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new AppError("Article not found.", "not_found", 404);
  return mapArticle(row);
}

export function createArticle(
  db: Db,
  input: {
    title: string;
    kind?: ArticleKind;
    note?: string | null;
    externalUrl?: string | null;
    sourceHost?: string | null;
    libraryFilename?: string | null;
  },
): Article {
  const title = input.title.trim();
  if (!title) throw new AppError("An article needs a title.", "validation", 400);
  const id = uuid();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO articles (
      id, title, kind, note, library_filename, external_url, source_host,
      page_position, page_count, progress_percent, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, 0, 'not_started', ?, ?)`,
  ).run(
    id,
    title,
    input.kind === "workbook" ? "workbook" : "article",
    input.note?.trim() || null,
    input.libraryFilename ?? null,
    input.externalUrl ?? null,
    input.sourceHost ?? null,
    ts,
    ts,
  );
  return getArticle(db, id);
}

export function updateArticle(
  db: Db,
  id: string,
  patch: { title?: string; note?: string | null; status?: ArticleStatus },
): Article {
  const current = getArticle(db, id);
  const title = patch.title?.trim() || current.title;
  const note = patch.note === undefined ? current.note : patch.note?.trim() || null;
  let status = patch.status ?? current.status;
  let progress = current.progressPercent;
  if (patch.status === "completed") progress = 100;
  if (patch.status === "reading" && progress === 0) progress = 1;
  if (patch.status === "not_started") progress = 0;
  db.prepare(
    "UPDATE articles SET title = ?, note = ?, status = ?, progress_percent = ?, updated_at = ? WHERE id = ?",
  ).run(title, note, status, progress, nowIso(), id);
  return getArticle(db, id);
}

export function attachArticlePdf(db: Db, id: string, filename: string | null): Article {
  getArticle(db, id);
  if (filename) articlePdfPath(db, filename);
  db.prepare("UPDATE articles SET library_filename = ?, updated_at = ? WHERE id = ?").run(filename, nowIso(), id);
  return getArticle(db, id);
}

export function articlePdfPath(db: Db, filename: string): string {
  const described = describeLibrary(db);
  if (!described.configured || !described.path) {
    throw new AppError(
      "Set a PDF library folder in Settings before attaching an article.",
      "library_unconfigured",
      400,
    );
  }
  if (described.error) throw new AppError(described.error, "library_path", 400);
  return resolveInsideLibrary(described.path, filename);
}

export function articlePdfFile(db: Db, id: string): string {
  const article = getArticle(db, id);
  if (!article.libraryFilename) {
    throw new AppError("No PDF is attached to this article.", "library_file", 404);
  }
  return articlePdfPath(db, article.libraryFilename);
}

/** Furthest page wins, the same way a book remembers how far you opened it. */
export function recordArticleReading(db: Db, id: string, page: number, pageCount: number): Article {
  const current = getArticle(db, id);
  const furthest = Math.max(current.pagePosition, page);
  const percent = Math.min(100, Math.round((furthest / pageCount) * 100));
  const status = articleStatus(percent, furthest);
  db.prepare(
    `UPDATE articles
     SET page_position = ?, page_count = ?, progress_percent = ?, status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(furthest, pageCount, percent, status, nowIso(), id);
  return getArticle(db, id);
}

export function setArticleCategory(db: Db, id: string, category: string | null): Article {
  getArticle(db, id);
  const value = requireKnownCategory(db, category);
  db.prepare("UPDATE articles SET category = ?, updated_at = ? WHERE id = ?").run(value, nowIso(), id);
  return getArticle(db, id);
}

export function listCourses(db: Db): Course[] {
  return (db.prepare("SELECT * FROM courses ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map(
    mapCourse,
  );
}

export function getCourse(db: Db, id: string): Course {
  const row = db.prepare("SELECT * FROM courses WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new AppError("Course not found.", "not_found", 404);
  return mapCourse(row);
}

export function deleteCourse(db: Db, id: string): void {
  getCourse(db, id);
  const remove = db.transaction(() => {
    db.prepare("DELETE FROM course_lessons WHERE course_id = ?").run(id);
    db.prepare("DELETE FROM courses WHERE id = ?").run(id);
  });
  remove();
}

export function setArticlePriority(db: Db, id: string, priority: Priority): Article {
  getArticle(db, id);
  db.prepare("UPDATE articles SET priority = ?, updated_at = ? WHERE id = ?").run(priority, nowIso(), id);
  return getArticle(db, id);
}

export function setCourseCategory(db: Db, id: string, category: string | null): Course {
  getCourse(db, id);
  const value = requireKnownCategory(db, category);
  db.prepare("UPDATE courses SET category = ?, updated_at = ? WHERE id = ?").run(value, nowIso(), id);
  return getCourse(db, id);
}

export function setCoursePriority(db: Db, id: string, priority: Priority): Course {
  getCourse(db, id);
  db.prepare("UPDATE courses SET priority = ?, updated_at = ? WHERE id = ?").run(priority, nowIso(), id);
  return getCourse(db, id);
}

function requireKnownCategory(db: Db, category: string | null): string | null {
  const value = category?.trim() || null;
  if (value && !listCategories(db).some((item) => item.id === value)) {
    throw new AppError("Unknown category.", "category", 400);
  }
  return value;
}

export function listLessons(db: Db, courseId: string): CourseLesson[] {
  return (
    db.prepare("SELECT * FROM course_lessons WHERE course_id = ? ORDER BY position ASC, created_at ASC").all(courseId) as Record<
      string,
      unknown
    >[]
  ).map(mapLesson);
}

export function createCourse(db: Db, input: { title: string; url: string; note?: string | null }): Course {
  const title = input.title.trim();
  const url = input.url.trim();
  if (!title) throw new AppError("A course needs a title.", "validation", 400);
  assertCourseUrl(url);
  const id = uuid();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO courses (id, title, url, note, lessons_confirmed, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, title, url, input.note?.trim() || null, ts, ts);
  return getCourse(db, id);
}

export function assertCourseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("Enter an http or https course URL.", "invalid_url", 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError("Enter an http or https course URL.", "invalid_url", 400);
  }
}

export function confirmLessons(db: Db, courseId: string, titles: string[]): CourseLesson[] {
  getCourse(db, courseId);
  const cleaned = titles.map((title) => title.trim()).filter((title) => title.length > 0);
  if (!cleaned.length) throw new AppError("Confirm at least one lesson title.", "validation", 400);
  const existing = listLessons(db, courseId);
  const doneByTitle = new Map(existing.map((lesson) => [lesson.title.toLowerCase(), lesson.done]));
  const ts = nowIso();
  const write = db.transaction(() => {
    db.prepare("DELETE FROM course_lessons WHERE course_id = ?").run(courseId);
    const insert = db.prepare(
      `INSERT INTO course_lessons (id, course_id, position, title, done, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    cleaned.forEach((title, index) => {
      insert.run(uuid(), courseId, index, title, doneByTitle.get(title.toLowerCase()) ? 1 : 0, ts, ts);
    });
    db.prepare("UPDATE courses SET lessons_confirmed = 1, updated_at = ? WHERE id = ?").run(ts, courseId);
  });
  write();
  return listLessons(db, courseId);
}

export function setLessonDone(db: Db, courseId: string, lessonId: string, done: boolean): CourseLesson {
  const lesson = db
    .prepare("SELECT * FROM course_lessons WHERE id = ? AND course_id = ?")
    .get(lessonId, courseId) as Record<string, unknown> | undefined;
  if (!lesson) throw new AppError("Lesson not found.", "not_found", 404);
  const ts = nowIso();
  db.prepare("UPDATE course_lessons SET done = ?, updated_at = ? WHERE id = ?").run(done ? 1 : 0, ts, lessonId);
  db.prepare("UPDATE courses SET updated_at = ? WHERE id = ?").run(ts, courseId);
  return mapLesson(
    db.prepare("SELECT * FROM course_lessons WHERE id = ?").get(lessonId) as Record<string, unknown>,
  );
}

export function setWorkshopPriority(db: Db, id: string, priority: Priority): WorkshopProject {
  getWorkshopProject(db, id);
  db.prepare("UPDATE workshop_projects SET priority = ?, updated_at = ? WHERE id = ?").run(priority, nowIso(), id);
  return getWorkshopProject(db, id);
}

export function listWorkshopProjects(db: Db): WorkshopProject[] {
  return (
    db.prepare("SELECT * FROM workshop_projects ORDER BY updated_at DESC").all() as Record<string, unknown>[]
  ).map(mapProject);
}

export function getWorkshopProject(db: Db, id: string): WorkshopProject {
  const row = db.prepare("SELECT * FROM workshop_projects WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new AppError("Project not found.", "not_found", 404);
  return mapProject(row);
}

export function listWorkshopCards(db: Db, projectId: string): WorkshopCard[] {
  getWorkshopProject(db, projectId);
  return (
    db
      .prepare("SELECT * FROM workshop_cards WHERE project_id = ? ORDER BY position ASC, created_at ASC")
      .all(projectId) as Record<string, unknown>[]
  ).map(mapCard);
}

export function createWorkshopProject(
  db: Db,
  input: { title: string; description?: string | null; category?: string | null; tags?: string[]; priority?: Priority },
): WorkshopProject {
  const title = input.title.trim();
  if (!title) throw new AppError("A project needs a title.", "validation", 400);
  const id = uuid();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO workshop_projects (id, title, description, category, tags_json, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    title,
    input.description?.trim() || null,
    cleanCategory(input.category),
    JSON.stringify(cleanTags(input.tags)),
    cleanPriority(input.priority),
    ts,
    ts,
  );
  return getWorkshopProject(db, id);
}

export function updateWorkshopProject(
  db: Db,
  id: string,
  patch: { title?: string; description?: string | null; category?: string | null; tags?: string[] },
): WorkshopProject {
  const current = getWorkshopProject(db, id);
  db.prepare(
    `UPDATE workshop_projects
     SET title = ?, description = ?, category = ?, tags_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.title?.trim() || current.title,
    patch.description === undefined ? current.description : patch.description?.trim() || null,
    patch.category === undefined ? current.category : cleanCategory(patch.category),
    JSON.stringify(patch.tags === undefined ? current.tags : cleanTags(patch.tags)),
    nowIso(),
    id,
  );
  return getWorkshopProject(db, id);
}

function cleanCategory(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed.slice(0, 60) : null;
}

function cleanTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const tag of tags ?? []) {
    const next = tag.trim().slice(0, 40);
    if (!next || seen.has(next.toLowerCase())) continue;
    seen.add(next.toLowerCase());
    cleaned.push(next);
    if (cleaned.length >= 12) break;
  }
  return cleaned;
}

export function createWorkshopCard(
  db: Db,
  projectId: string,
  input: { title: string; detail?: string | null; column?: WorkshopColumn },
): WorkshopCard {
  getWorkshopProject(db, projectId);
  const title = input.title.trim();
  if (!title) throw new AppError("A card needs a title.", "validation", 400);
  const column = input.column ?? "todo";
  const position = nextCardPosition(db, projectId, column);
  const id = uuid();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO workshop_cards (id, project_id, column_key, title, detail, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, column, title, input.detail?.trim() || null, position, ts, ts);
  touchProject(db, projectId);
  return getWorkshopCard(db, id);
}

export function addPlannedCards(
  db: Db,
  projectId: string,
  plan: {
    cards: { title: string; detail?: string | null; column?: WorkshopColumn | null }[];
  },
): WorkshopCard[] {
  getWorkshopProject(db, projectId);
  const created: WorkshopCard[] = [];
  for (const card of plan.cards) {
    created.push(
      createWorkshopCard(db, projectId, {
        title: card.title,
        detail: card.detail,
        column: card.column ?? "todo",
      }),
    );
  }
  return created;
}

function getWorkshopCard(db: Db, id: string): WorkshopCard {
  const row = db.prepare("SELECT * FROM workshop_cards WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new AppError("Card not found.", "not_found", 404);
  return mapCard(row);
}

function nextCardPosition(db: Db, projectId: string, column: WorkshopColumn): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(position), -1) AS n FROM workshop_cards WHERE project_id = ? AND column_key = ?")
    .get(projectId, column) as { n: number };
  return row.n + 1;
}

function touchProject(db: Db, projectId: string): void {
  db.prepare("UPDATE workshop_projects SET updated_at = ? WHERE id = ?").run(nowIso(), projectId);
}

export function updateWorkshopCard(
  db: Db,
  id: string,
  patch: { title?: string; detail?: string | null; column?: WorkshopColumn; position?: number },
): WorkshopCard {
  const current = getWorkshopCard(db, id);
  const column = patch.column ?? current.column;
  const title = patch.title?.trim() || current.title;
  const detail = patch.detail === undefined ? current.detail : patch.detail?.trim() || null;
  const ts = nowIso();
  if (column !== current.column) {
    const position = patch.position ?? nextCardPosition(db, current.projectId, column);
    db.prepare(
      "UPDATE workshop_cards SET title = ?, detail = ?, column_key = ?, position = ?, updated_at = ? WHERE id = ?",
    ).run(title, detail, column, position, ts, id);
  } else {
    db.prepare("UPDATE workshop_cards SET title = ?, detail = ?, updated_at = ? WHERE id = ?").run(
      title,
      detail,
      ts,
      id,
    );
    if (patch.position != null) {
      db.prepare("UPDATE workshop_cards SET position = ? WHERE id = ?").run(patch.position, id);
    }
  }
  touchProject(db, current.projectId);
  return getWorkshopCard(db, id);
}

export function listActiveSuggestions(db: Db): ExerciseSuggestion[] {
  return (
    db
      .prepare("SELECT * FROM exercise_suggestions WHERE status = 'active' ORDER BY created_at DESC")
      .all() as Record<string, unknown>[]
  ).map(mapSuggestion);
}

export function finishedReadings(db: Db): SearchReading[] {
  const chapters = db
    .prepare(
      `SELECT c.title AS title, b.title AS resource, p.title AS parentTitle, c.updated_at AS updated_at
       FROM chapters c
       JOIN books b ON b.id = c.book_id
       LEFT JOIN chapters p ON p.id = c.parent_id
       WHERE c.status = 'completed' AND c.selected = 1
       ORDER BY c.updated_at DESC
       LIMIT 80`,
    )
    .all() as { title: string; resource: string; parentTitle: string | null; updated_at: string }[];
  const lessons = db
    .prepare(
      `SELECT l.title AS title, c.title AS resource, l.updated_at AS updated_at
       FROM course_lessons l
       JOIN courses c ON c.id = l.course_id
       WHERE l.done = 1
       ORDER BY l.updated_at DESC
       LIMIT 80`,
    )
    .all() as { title: string; resource: string; updated_at: string }[];
  return [...chapters, ...lessons.map((lesson) => ({ ...lesson, parentTitle: null }))]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 80)
    .map((row) => ({ title: row.title, resource: row.resource, parentTitle: row.parentTitle }));
}

export function exerciseSearchOptIn(db: Db): string | null {
  return getSetting(db, OPT_IN_KEY);
}

export function exerciseSearchLastAt(db: Db): string | null {
  return getSetting(db, LAST_SEARCH_KEY);
}

export function setExerciseSearchOptIn(db: Db): void {
  if (!getSetting(db, OPT_IN_KEY)) setSetting(db, OPT_IN_KEY, nowIso());
}

export function setExerciseSearchLastAt(db: Db, when = nowIso()): void {
  setSetting(db, LAST_SEARCH_KEY, when);
}

export function storeExerciseHits(db: Db, titles: string[], hits: ExerciseHit[]): ExerciseSuggestion[] {
  const ranked = rankExerciseHits(hits, titles);
  const known = new Set(
    (db.prepare("SELECT url FROM exercise_suggestions").all() as { url: string }[]).map((row) => row.url),
  );
  const ts = nowIso();
  const insert = db.prepare(
    `INSERT INTO exercise_suggestions
      (id, title, url, source_host, reason, matched_title, status, article_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', NULL, ?)`,
  );
  for (const hit of ranked) {
    if (known.has(hit.url)) continue;
    known.add(hit.url);
    insert.run(uuid(), hit.title, hit.url, hit.sourceHost, hit.reason, hit.matchedTitle, ts);
  }
  return listActiveSuggestions(db);
}

export function acceptSuggestion(db: Db, id: string): { suggestion: ExerciseSuggestion; article: Article } {
  const row = db.prepare("SELECT * FROM exercise_suggestions WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new AppError("Suggestion not found.", "not_found", 404);
  const suggestion = mapSuggestion(row);
  if (suggestion.status !== "active") {
    throw new AppError("That suggestion is no longer on the list.", "suggestion_closed", 400);
  }
  const article = createArticle(db, {
    title: suggestion.title,
    kind: "workbook",
    externalUrl: suggestion.url,
    sourceHost: suggestion.sourceHost,
    note: suggestion.reason,
  });
  db.prepare("UPDATE exercise_suggestions SET status = 'accepted', article_id = ? WHERE id = ?").run(article.id, id);
  return {
    suggestion: mapSuggestion(
      db.prepare("SELECT * FROM exercise_suggestions WHERE id = ?").get(id) as Record<string, unknown>,
    ),
    article,
  };
}

export function rejectSuggestion(db: Db, id: string): void {
  const row = db.prepare("SELECT id, status FROM exercise_suggestions WHERE id = ?").get(id) as
    | { id: string; status: string }
    | undefined;
  if (!row) throw new AppError("Suggestion not found.", "not_found", 404);
  db.prepare("UPDATE exercise_suggestions SET status = 'rejected' WHERE id = ?").run(id);
}

export function islandMarkers(db: Db): IslandMarker[] {
  const markers: IslandMarker[] = [];
  for (const article of listArticles(db)) {
    markers.push({
      id: article.id,
      kind: article.kind,
      title: article.title,
      progress: Math.min(1, Math.max(0, article.progressPercent / 100)),
      href: `/articles/${article.id}`,
    });
  }
  for (const course of listCourses(db)) {
    const lessons = listLessons(db, course.id);
    const done = lessons.filter((lesson) => lesson.done).length;
    markers.push({
      id: course.id,
      kind: "course",
      title: course.title,
      progress: lessonProgress(done, lessons.length),
      href: `/courses/${course.id}`,
    });
  }
  return markers;
}

export function activeCourse(db: Db): ActiveCourse | null {
  const open: ActiveCourse[] = [];
  for (const course of listCourses(db)) {
    const lessons = listLessons(db, course.id);
    const done = lessons.filter((lesson) => lesson.done).length;
    if (lessons.length > 0 && done >= lessons.length) continue;
    open.push({
      id: course.id,
      title: course.title,
      url: course.url,
      doneCount: done,
      lessonCount: lessons.length,
      href: `/courses/${course.id}`,
      others: 0,
    });
  }
  const first = open[0];
  if (!first) return null;
  return { ...first, others: Math.max(0, open.length - 1) };
}
