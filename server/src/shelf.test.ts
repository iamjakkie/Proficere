import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { FIXTURE_SOURCE } from "@progress-island/shared";
import { createApp } from "./app.js";
import { openDatabase } from "./db.js";
import { maybeSearch } from "./exercise-search.js";
import { fieldResources } from "./field.js";
import {
  confirmLessons,
  createArticle,
  createCourse,
  createWorkshopCard,
  createWorkshopProject,
  setArticleCategory,
  setCourseCategory,
  setExerciseSearchLastAt,
  setExerciseSearchOptIn,
  setLessonDone,
  setWorkshopPriority,
  storeExerciseHits,
  updateWorkshopCard,
} from "./shelf-store.js";
import {
  confirmChapters,
  createBook,
  exportBackup,
  getChapter,
  insertSource,
  islandState,
  listChapters,
  listRewards,
  localOrEmptyOutline,
  removeCategory,
  restoreBackup,
  updateChapter,
} from "./store.js";

function tempDb() {
  const file = path.join(os.tmpdir(), `pi-shelf-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const db = openDatabase(file);
  return {
    db,
    file,
    cleanup() {
      db.close();
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
    },
  };
}

describe("articles, courses, workshop, and exercise suggestions", () => {
  const handles: { cleanup: () => void }[] = [];
  afterEach(() => {
    while (handles.length) handles.pop()?.cleanup();
  });

  it("keeps books, chapters, progress, reviews, and rewards in a backup that also has the new tables", () => {
    const source = tempDb();
    const restored = tempDb();
    handles.push(source, restored);
    const book = createBook(source.db, { title: "Backup Book", author: "Ada" });
    const document = insertSource(source.db, {
      bookId: book.id,
      provenanceType: "pasted",
      provenanceLabel: "Extracted from pasted text",
      text: FIXTURE_SOURCE,
    });
    confirmChapters(source.db, book.id, document.id, localOrEmptyOutline(FIXTURE_SOURCE), false);
    const chapter = listChapters(source.db, book.id)[0];
    expect(chapter).toBeTruthy();
    updateChapter(source.db, chapter!.id, { progressPercent: 100 });
    const article = createArticle(source.db, { title: "A note on filters" });
    const course = createCourse(source.db, { title: "Public course", url: "https://example.edu/course" });
    confirmLessons(source.db, course.id, ["Lesson one"]);
    const project = createWorkshopProject(source.db, { title: "Filter bench", category: "Signals", tags: ["kalman"] });
    const card = createWorkshopCard(source.db, project.id, { title: "Write the sketch", column: "todo" });
    updateWorkshopCard(source.db, card.id, { column: "done" });
    storeExerciseHits(
      source.db,
      ["Dead reckoning"],
      [{ title: "Sheet", url: "https://ocw.mit.edu/sheet.pdf" }],
    );

    const backup = exportBackup(source.db);
    expect(backup.payload.articles).toHaveLength(1);
    expect(backup.payload.courses).toHaveLength(1);
    expect(backup.payload.course_lessons).toHaveLength(1);
    expect(backup.payload.workshop_cards).toHaveLength(1);
    expect(backup.payload.exercise_suggestions).toHaveLength(1);
    expect(backup.payload.books).toHaveLength(1);
    expect(backup.payload.chapters.length).toBeGreaterThan(0);

    restoreBackup(restored.db, backup);
    expect(islandState(restored.db)).toEqual(islandState(source.db));
    expect(listRewards(restored.db)).toEqual(listRewards(source.db));
    expect(getChapter(restored.db, chapter!.id).status).toBe("completed");
    expect(exportBackup(restored.db).payload.articles).toEqual(backup.payload.articles);
    expect(exportBackup(restored.db).payload.books).toHaveLength(1);

    const legacy = { ...backup, payload: { ...backup.payload } };
    delete legacy.payload.articles;
    delete legacy.payload.courses;
    delete legacy.payload.course_lessons;
    delete legacy.payload.workshop_projects;
    delete legacy.payload.workshop_cards;
    delete legacy.payload.exercise_suggestions;
    restoreBackup(source.db, legacy);
    expect(getChapter(source.db, chapter!.id).title).toBe(chapter!.title);
    expect(exportBackup(source.db).payload.articles).toHaveLength(0);
    expect(listRewards(source.db).length).toBeGreaterThan(0);
    void article;
  });

  it("persists course lesson done and still-here", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    const created = await request(app)
      .post("/api/courses")
      .send({ title: "Estimation", url: "https://example.edu/estimation" })
      .expect(201);
    const courseId = created.body.course.id as string;
    const confirmed = await request(app)
      .post(`/api/courses/${courseId}/lessons/confirm`)
      .send({ titles: ["Kalman filter", "Smoothing"] })
      .expect(200);
    const first = confirmed.body.lessons[0];
    expect(first.done).toBe(false);
    const done = await request(app)
      .patch(`/api/courses/${courseId}/lessons/${first.id}`)
      .send({ done: true })
      .expect(200);
    expect(done.body.lesson.done).toBe(true);
    const again = await request(app).get(`/api/courses/${courseId}`).expect(200);
    expect(again.body.lessons[0].done).toBe(true);
    expect(again.body.lessons[1].done).toBe(false);
    const back = await request(app)
      .patch(`/api/courses/${courseId}/lessons/${first.id}`)
      .send({ done: false })
      .expect(200);
    expect(back.body.lesson.done).toBe(false);
    await request(app).delete(`/api/courses/${courseId}`).expect(200);
    await request(app).get(`/api/courses/${courseId}`).expect(404);
    const left = h.db.prepare("SELECT COUNT(*) AS n FROM course_lessons WHERE course_id = ?").get(courseId) as {
      n: number;
    };
    expect(left.n).toBe(0);
    const list = await request(app).get("/api/courses").expect(200);
    expect(list.body.courses).toHaveLength(0);
  });

  it("moves a workshop card between columns", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    const created = await request(app)
      .post("/api/workshop/projects")
      .send({ title: "Bench", category: "Flight", tags: ["imu"] })
      .expect(201);
    const projectId = created.body.project.id as string;
    const card = await request(app)
      .post(`/api/workshop/projects/${projectId}/cards`)
      .send({ title: "Log a run", detail: "One flight" })
      .expect(201);
    expect(card.body.card.column).toBe("todo");
    const moved = await request(app)
      .patch(`/api/workshop/cards/${card.body.card.id}`)
      .send({ column: "done" })
      .expect(200);
    expect(moved.body.card.column).toBe("done");
    const board = await request(app).get(`/api/workshop/projects/${projectId}`).expect(200);
    expect(board.body.cards).toHaveLength(1);
    expect(board.body.cards[0].column).toBe("done");
    const other = await request(app).post("/api/workshop/projects").send({ title: "Other" }).expect(201);
    const otherBoard = await request(app).get(`/api/workshop/projects/${other.body.project.id}`).expect(200);
    expect(otherBoard.body.cards).toHaveLength(0);
  });

  it("accepts a suggestion onto the workbook shelf and drops a rejection from the active list", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    storeExerciseHits(
      h.db,
      ["Dead reckoning"],
      [
        { title: "Problem set", url: "https://ocw.mit.edu/ps1.pdf", snippet: "Dead reckoning" },
        { title: "Not a pdf", url: "https://ocw.mit.edu/course" },
      ],
    );
    const listed = await request(app).get("/api/exercise-search").expect(200);
    expect(listed.body.configured).toBe(false);
    expect(listed.body.message).toMatch(/EXERCISE_SEARCH_API_KEY/);
    expect(listed.body.suggestions).toHaveLength(1);
    const suggestion = listed.body.suggestions[0];
    const accepted = await request(app).post(`/api/exercise-suggestions/${suggestion.id}/accept`).expect(200);
    expect(accepted.body.article.kind).toBe("workbook");
    expect(accepted.body.article.externalUrl).toBe("https://ocw.mit.edu/ps1.pdf");
    const after = await request(app).get("/api/exercise-search").expect(200);
    expect(after.body.suggestions).toHaveLength(0);
    const articles = await request(app).get("/api/articles").expect(200);
    expect(articles.body.articles.some((item: { kind: string }) => item.kind === "workbook")).toBe(true);

    storeExerciseHits(h.db, ["Smoothing"], [{ title: "Another", url: "https://www.cam.ac.uk/sheet.pdf" }]);
    const next = await request(app).get("/api/exercise-search").expect(200);
    await request(app).post(`/api/exercise-suggestions/${next.body.suggestions[0].id}/reject`).expect(200);
    const gone = await request(app).get("/api/exercise-search").expect(200);
    expect(gone.body.suggestions).toHaveLength(0);
  });

  it("does not search when no key is configured and does not invent suggestions", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    const denied = await request(app).post("/api/exercise-search").send({ consent: true }).expect(400);
    expect(denied.body.error).toMatch(/EXERCISE_SEARCH_API_KEY/);
    expect((await request(app).get("/api/exercise-search")).body.suggestions).toEqual([]);
  });

  it("skips a due search until a day has passed, then stores only PDF hits", async () => {
    const h = tempDb();
    handles.push(h);
    const course = createCourse(h.db, { title: "Filters", url: "https://example.edu/filters" });
    const lessons = confirmLessons(h.db, course.id, ["Kalman filter"]);
    setLessonDone(h.db, course.id, lessons[0]!.id, true);
    setExerciseSearchOptIn(h.db);
    setExerciseSearchLastAt(h.db, new Date().toISOString());
    let calls = 0;
    const skipped = await maybeSearch(h.db, {
      endpoint: "https://search.example.test/v1",
      apiKey: "test-key",
      fetchImpl: async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
      },
    });
    expect(skipped.reason).toBe("interval");
    expect(calls).toBe(0);

    const ran = await maybeSearch(h.db, {
      force: true,
      endpoint: "https://search.example.test/v1",
      apiKey: "test-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            items: [
              { title: "University sheet", url: "https://web.mit.edu/hw.pdf" },
              { title: "Homepage", url: "https://web.mit.edu/course" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    expect(ran.ran).toBe(true);
    expect(ran.added).toBe(1);
    const state = await request(createApp(h.db)).get("/api/exercise-search");
    expect(state.body.suggestions[0].url).toBe("https://web.mit.edu/hw.pdf");
    expect(state.body.suggestions[0].sourceHost).toBe("web.mit.edu");
  });

  it("builds the home field from books, articles, and courses without touching other shelves", async () => {
    const h = tempDb();
    handles.push(h);
    const book = createBook(h.db, { title: "Field Book", author: "Ada" });
    const document = insertSource(h.db, {
      bookId: book.id,
      provenanceType: "pasted",
      provenanceLabel: "Extracted from pasted text",
      text: FIXTURE_SOURCE,
    });
    confirmChapters(h.db, book.id, document.id, localOrEmptyOutline(FIXTURE_SOURCE), false);
    const chapters = listChapters(h.db, book.id);
    expect(chapters.length).toBeGreaterThan(1);
    updateChapter(h.db, chapters[0]!.id, { progressPercent: 100 });
    updateChapter(h.db, chapters[1]!.id, { progressPercent: 40 });
    const article = createArticle(h.db, { title: "Field note" });
    const sheet = createArticle(h.db, { title: "Exercise sheet", kind: "workbook" });
    const app = createApp(h.db);
    const assigned = await request(app)
      .put(`/api/articles/${article.id}/category`)
      .send({ category: "navigation" })
      .expect(200);
    expect(assigned.body.article.category).toBe("navigation");
    const course = createCourse(h.db, { title: "Field course", url: "https://example.edu/field" });
    const lessons = confirmLessons(h.db, course.id, ["One", "Two"]);
    setLessonDone(h.db, course.id, lessons[0]!.id, true);
    setCourseCategory(h.db, course.id, "estimation");
    const project = createWorkshopProject(h.db, { title: "Bench", category: "navigation", priority: "top" });
    createWorkshopCard(h.db, project.id, { title: "Wire the imu" });
    const finished = createWorkshopCard(h.db, project.id, { title: "Log a run" });
    updateWorkshopCard(h.db, finished.id, { column: "done" });
    const uncategorized = createWorkshopProject(h.db, { title: "Not on the field" });
    expect(setWorkshopPriority(h.db, uncategorized.id, "high").priority).toBe("high");

    const field = fieldResources(h.db);
    expect(field.map((item) => item.kind).sort()).toEqual(["article", "book", "course", "workshop", "workshop"]);
    const bookRow = field.find((item) => item.id === book.id);
    expect(bookRow?.segments[0]).toBe(1);
    expect(bookRow?.segments[1]).toBe(0.4);
    expect(bookRow?.href).toBe(`/books/${book.id}`);
    expect(field.find((item) => item.id === article.id)).toMatchObject({
      kind: "article",
      category: "navigation",
      segments: [0],
      href: `/articles/${article.id}`,
    });
    expect(field.find((item) => item.id === course.id)?.segments).toEqual([1, 0]);
    expect(field.find((item) => item.id === project.id)).toMatchObject({
      kind: "workshop",
      category: "navigation",
      priority: "top",
      segments: [0, 1],
      href: `/workshop/${project.id}`,
    });
    expect(field.find((item) => item.id === uncategorized.id)?.category).toBeNull();
    expect(field.find((item) => item.id === book.id)?.priority).toBe("none");
    expect(field.some((item) => item.id === sheet.id)).toBe(false);

    const dashboard = await request(app).get("/api/dashboard").expect(200);
    expect(dashboard.body.field).toHaveLength(5);

    removeCategory(h.db, "navigation");
    expect(fieldResources(h.db).find((item) => item.id === article.id)?.category).toBeNull();
    await request(app).put(`/api/articles/${article.id}/category`).send({ category: "missing" }).expect(400);
  });
});
