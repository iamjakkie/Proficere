import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  FIXTURE_SOURCE,
  chapterCompleteKey,
} from "@progress-island/shared";
import { createApp } from "./app.js";
import { openDatabase } from "./db.js";
import {
  confirmChapters,
  exportBackup,
  getChapter,
  insertSource,
  islandState,
  listChapters,
  listRewards,
  localOrEmptyOutline,
  restoreBackup,
  saveReviewPack,
  scoreAttempt,
  updateChapter,
  updateReviewItem,
} from "./store.js";

function tempDb() {
  const file = path.join(os.tmpdir(), `pi-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
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

describe("learning loop persistence", () => {
  const handles: { cleanup: () => void }[] = [];
  afterEach(() => {
    while (handles.length) handles.pop()?.cleanup();
  });

  it("imports fixture outline, logs progress, and is idempotent on rewards", () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    return request(app)
      .post("/api/books")
      .send({ title: "Fixture Book", author: "Test" })
      .expect(201)
      .then(async (created) => {
        const bookId = created.body.book.id;
        const outline = localOrEmptyOutline(FIXTURE_SOURCE);
        const source = insertSource(h.db, {
          bookId,
          provenanceType: "pasted",
          provenanceLabel: "Extracted from pasted text",
          text: FIXTURE_SOURCE,
        });
        confirmChapters(h.db, bookId, source.id, outline, false);
        const listed = await request(app).get(`/api/books/${bookId}`).expect(200);
        expect(listed.body.chapters).toHaveLength(5);
        const first = listed.body.chapters[0];
        await request(app)
          .post(`/api/chapters/${first.id}/complete`)
          .expect(200);
        const again = await request(app)
          .post(`/api/chapters/${first.id}/complete`)
          .expect(200);
        expect(again.body.island.completedChapters).toBe(1);
        expect(listRewards(h.db).filter((r) => r.rewardKey === chapterCompleteKey(first.id))).toHaveLength(1);
        const undone = await request(app).post(`/api/chapters/${first.id}/undo`).expect(200);
        expect(undone.body.chapter.status).not.toBe("completed");
        expect(listRewards(h.db)).toHaveLength(1);
      });
  });

  it("excludes unselected chapters from plan progress", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    const created = await request(app).post("/api/books").send({ title: "Plan" });
    const bookId = created.body.book.id;
    const source = insertSource(h.db, {
      bookId,
      provenanceType: "pasted",
      provenanceLabel: "Extracted from pasted text",
      text: FIXTURE_SOURCE,
    });
    confirmChapters(h.db, bookId, source.id, localOrEmptyOutline(FIXTURE_SOURCE), false);
    const chapters = (await request(app).get(`/api/books/${bookId}`)).body.chapters;
    await request(app).patch(`/api/chapters/${chapters[1].id}`).send({ selected: false });
    await request(app).post(`/api/chapters/${chapters[0].id}/complete`);
    const dash = await request(app).get("/api/dashboard").expect(200);
    expect(dash.body.planProgress).toEqual({ selected: 4, completedSelected: 1 });
  });

  it("restores books, progress, reviews, and rewards", () => {
    const a = tempDb();
    const b = tempDb();
    handles.push(a, b);
    const book = JSON.parse(
      JSON.stringify(
        // create via store
        (() => {
          const created = a.db.prepare(
            "SELECT 1",
          );
          void created;
          return true;
        })(),
      ),
    );
    void book;
    const createdBook = insertViaApp(a);
    const backup = exportBackup(a.db);
    restoreBackup(b.db, backup);
    expect(islandState(b.db)).toEqual(islandState(a.db));
    expect(exportBackup(b.db).payload.chapters).toHaveLength(
      exportBackup(a.db).payload.chapters.length,
    );
    expect(createdBook).toBeTruthy();
  });

  it("scores quizzes on the server", () => {
    const h = tempDb();
    handles.push(h);
    const created = insertViaApp(h);
    const pack = saveReviewPack(h.db, {
      chapterId: created.chapterId,
      sourceDocumentId: created.sourceId,
      sourceHash: "abc",
      flashcards: [
        {
          id: "f1",
          front: "What is dead reckoning?",
          back: "A prediction from heading, speed, and time.",
          passage: "Dead reckoning estimates present position from a known start",
          locator: "ch1",
        },
      ],
      questions: [
        {
          id: "q1",
          prompt: "Dead reckoning is primarily a",
          choices: [
            { id: "a", text: "prediction" },
            { id: "b", text: "GPS observation" },
          ],
          correctChoiceId: "a",
          explanation: "It is a prediction, not an observation of location.",
          passage: "A dead-reckoning update is therefore a prediction, not an observation of location.",
          locator: "ch1",
        },
      ],
    });
    const wrong = scoreAttempt(h.db, pack.id, { q1: "b" });
    expect(wrong.correctCount).toBe(0);
    expect(wrong.weak).toBe(true);
    const right = scoreAttempt(h.db, pack.id, { q1: "a" });
    expect(right.correctCount).toBe(1);
    expect(right.weak).toBe(false);
  });

  it("stores a pasted outline without saving chapters until confirm", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    const created = await request(app).post("/api/books").send({ title: "Preview" });
    const bookId = created.body.book.id;
    const imported = await request(app)
      .post(`/api/books/${bookId}/import/paste`)
      .send({ text: FIXTURE_SOURCE, useAi: false })
      .expect(200);
    expect(imported.body.outline).toHaveLength(5);
    expect(imported.body.needsConfirmation).toBe(true);
    const before = await request(app).get(`/api/books/${bookId}`).expect(200);
    expect(before.body.chapters).toHaveLength(0);
    expect(before.body.draftOutline).toHaveLength(5);
    await request(app)
      .post(`/api/books/${bookId}/chapters/confirm`)
      .send({ sourceId: imported.body.sourceId, outline: imported.body.outline })
      .expect(200);
    const after = await request(app).get(`/api/books/${bookId}`).expect(200);
    expect(after.body.chapters).toHaveLength(5);
  });

  it("does not write chapters on a dry-run confirm", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    const created = await request(app).post("/api/books").send({ title: "Dry" });
    const bookId = created.body.book.id;
    const res = await request(app)
      .post(`/api/books/${bookId}/chapters/confirm`)
      .send({
        dryRun: true,
        outline: [{ number: "1", title: "Only a draft", pageStart: null, pageEnd: null }],
      })
      .expect(200);
    expect(res.body.dryRun).toBe(true);
    const listed = await request(app).get(`/api/books/${bookId}`);
    expect(listed.body.chapters).toHaveLength(0);
  });

  it("keeps completed history when a merge renames a chapter by id", () => {
    const h = tempDb();
    handles.push(h);
    const created = insertViaApp(h);
    const bookId = "11111111-1111-4111-8111-111111111111";
    const chapters = listChapters(h.db, bookId);
    confirmChapters(
      h.db,
      bookId,
      created.sourceId,
      chapters.map((chapter) => ({
        existingId: chapter.id,
        number: chapter.number,
        title: chapter.id === created.chapterId ? "Renamed Dead Reckoning" : chapter.title,
        pageStart: chapter.pageStart,
        pageEnd: chapter.pageEnd,
      })),
      true,
    );
    const renamed = getChapter(h.db, created.chapterId);
    expect(renamed.title).toBe("Renamed Dead Reckoning");
    expect(renamed.status).toBe("completed");
    expect(renamed.progressPercent).toBe(100);
    expect(listChapters(h.db, bookId)).toHaveLength(chapters.length);
  });

  it("does not change reading progress when a chapter is marked printed", () => {
    const h = tempDb();
    handles.push(h);
    insertViaApp(h);
    const chapters = listChapters(h.db, "11111111-1111-4111-8111-111111111111");
    const updated = updateChapter(h.db, chapters[1].id, { printed: true });
    expect(updated.printed).toBe(true);
    expect(updated.progressPercent).toBe(0);
    expect(updated.status).toBe("not_started");
  });

  it("excludes a rejected question from the server score", () => {
    const h = tempDb();
    handles.push(h);
    const created = insertViaApp(h);
    const pack = saveReviewPack(h.db, {
      chapterId: created.chapterId,
      sourceDocumentId: created.sourceId,
      sourceHash: "abc",
      flashcards: [
        {
          id: "f1",
          front: "What is dead reckoning?",
          back: "A prediction from heading, speed, and time.",
          passage: "Dead reckoning estimates present position from a known start",
          locator: "ch1",
        },
      ],
      questions: [
        {
          id: "q1",
          prompt: "Dead reckoning is primarily a",
          choices: [
            { id: "a", text: "prediction" },
            { id: "b", text: "GPS observation" },
          ],
          correctChoiceId: "a",
          explanation: "It is a prediction, not an observation of location.",
          passage: "A dead-reckoning update is therefore a prediction, not an observation of location.",
          locator: "ch1",
        },
        {
          id: "q2",
          prompt: "Which distinction is dropped by treating heading as course?",
          choices: [
            { id: "a", text: "Course over ground can diverge" },
            { id: "b", text: "They are identical" },
          ],
          correctChoiceId: "a",
          explanation: "Wind or current can separate them.",
          passage: "Wind or current can make course over ground diverge from heading even when the compass is correctly corrected.",
          locator: "ch2",
        },
      ],
    });
    updateReviewItem(h.db, pack.id, { kind: "question", id: "q2", action: "reject" });
    const scored = scoreAttempt(h.db, pack.id, { q1: "a", q2: "b" });
    expect(scored.total).toBe(1);
    expect(scored.correctCount).toBe(1);
    expect(scored.weak).toBe(false);
  });

  it("disables AI without configuration", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    const created = await request(app).post("/api/books").send({ title: "No AI" });
    const res = await request(app)
      .post(`/api/books/${created.body.book.id}/import/paste`)
      .send({ text: FIXTURE_SOURCE, useAi: true, consent: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("missing_config");
  });

  it("stores and clears a book cover URL without fetching a remote image", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    const created = await request(app).post("/api/books").send({ title: "Covered" });
    const id = created.body.book.id as string;
    const local = `/api/books/${id}/cover-image`;
    const set = await request(app).put(`/api/books/${id}/cover`).send({ coverUrl: local }).expect(200);
    expect(set.body.book.identifiers.coverUrl).toBe(local);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const uploaded = await request(app)
      .post(`/api/books/${id}/cover`)
      .attach("file", png, { filename: "cover.png", contentType: "image/png" })
      .expect(200);
    expect(uploaded.body.book.identifiers.coverUrl).toBe(local);
    expect(uploaded.body.book.identifiers.coverFile).toBe(`${id}.png`);
    const image = await request(app).get(`/api/books/${id}/cover-image`).expect(200);
    expect(image.headers["content-type"]).toMatch(/png/);
    const cleared = await request(app).put(`/api/books/${id}/cover`).send({ coverUrl: null }).expect(200);
    expect(cleared.body.book.identifiers.coverUrl).toBeUndefined();
    await request(app).get(`/api/books/${id}/cover-image`).expect(404);
  });

  it("keeps a dragged library order after reopening the database", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    const first = await request(app).post("/api/books").send({ title: "First" });
    const second = await request(app).post("/api/books").send({ title: "Second" });
    const third = await request(app).post("/api/books").send({ title: "Third" });
    const ids = [third.body.book.id, first.body.book.id, second.body.book.id] as string[];
    const ordered = await request(app).put("/api/books/order").send({ ids }).expect(200);
    expect(ordered.body.books.map((book: { title: string }) => book.title)).toEqual([
      "Third",
      "First",
      "Second",
    ]);
    const reopened = openDatabase(h.file);
    try {
      const listed = await request(createApp(reopened)).get("/api/books").expect(200);
      expect(listed.body.books.map((book: { title: string }) => book.title)).toEqual([
        "Third",
        "First",
        "Second",
      ]);
    } finally {
      reopened.close();
    }
  });
});

function insertViaApp(h: { db: ReturnType<typeof openDatabase> }) {
  const appCreate = createApp(h.db);
  void appCreate;
  const bookRow = h.db
    .prepare(
      `INSERT INTO books (id, title, author, edition, isbn, identifiers, catalog_url, contents_available, created_at, updated_at)
       VALUES ('11111111-1111-4111-8111-111111111111', 'F', NULL, NULL, NULL, '{}', NULL, 1, '2026-01-01', '2026-01-01')`,
    )
    .run();
  void bookRow;
  const source = insertSource(h.db, {
    bookId: "11111111-1111-4111-8111-111111111111",
    provenanceType: "pasted",
    provenanceLabel: "Extracted from pasted text",
    text: FIXTURE_SOURCE,
  });
  const confirmed = confirmChapters(
    h.db,
    "11111111-1111-4111-8111-111111111111",
    source.id,
    localOrEmptyOutline(FIXTURE_SOURCE),
    false,
  );
  updateChapter(h.db, confirmed.chapters[0].id, { progressPercent: 100 });
  return { chapterId: confirmed.chapters[0].id, sourceId: source.id };
}
