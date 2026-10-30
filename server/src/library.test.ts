import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { openDatabase } from "./db.js";
import { resolveInsideLibrary, saveLibraryFolder } from "./library.js";
import { setSetting } from "./store.js";

function tempDb() {
  const file = path.join(os.tmpdir(), `pi-lib-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const db = openDatabase(file);
  return {
    db,
    cleanup() {
      db.close();
      fs.rmSync(file, { force: true });
    },
  };
}

describe("pdf library folder", () => {
  const handles: { cleanup: () => void }[] = [];
  const dirs: string[] = [];
  afterEach(() => {
    while (handles.length) handles.pop()?.cleanup();
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it("lists PDFs in a chosen folder and rejects paths outside it", async () => {
    const h = tempDb();
    handles.push(h);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-books-"));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, "Probabilistic Robotics.pdf"), "not-a-real-pdf");
    fs.mkdirSync(path.join(dir, "nested"));
    fs.writeFileSync(path.join(dir, "nested", "notes.pdf"), "also-not");
    const described = saveLibraryFolder(h.db, dir);
    expect(described.files.map((file) => file.name).sort()).toEqual([
      "Probabilistic Robotics.pdf",
      "nested/notes.pdf",
    ]);
    expect(() => resolveInsideLibrary(dir, "../secret.pdf")).toThrow(/outside the PDF library/);
    const app = createApp(h.db);
    const created = await request(app).post("/api/books").send({ title: "Probabilistic Robotics" });
    const attached = await request(app)
      .put(`/api/books/${created.body.book.id}/library`)
      .send({ filename: "Probabilistic Robotics.pdf" })
      .expect(200);
    expect(attached.body.book.libraryFilename).toBe("Probabilistic Robotics.pdf");
    const suggested = await request(app)
      .get("/api/library")
      .query({ match: "Probabilistic Robotics" })
      .expect(200);
    expect(suggested.body.suggested[0].name).toBe("Probabilistic Robotics.pdf");
    fs.writeFileSync(
      path.join(dir, "Exercises in Numerical Linear Algebra and Matrix.pdf"),
      "not-a-real-pdf",
    );
    fs.writeFileSync(path.join(dir, "Numerical Linear Algebra.pdf"), "not-a-real-pdf");
    const algebra = await request(app)
      .get("/api/library")
      .query({ match: "Numerical Linear Algebra" })
      .expect(200);
    expect(algebra.body.suggested.map((file: { name: string }) => file.name)).toEqual([
      "Numerical Linear Algebra.pdf",
    ]);
    const pdf = await request(app).get(`/api/books/${created.body.book.id}/pdf`).expect(200);
    expect(pdf.headers["content-type"]).toMatch(/pdf/);
    expect(pdf.headers["accept-ranges"]).toBe("bytes");
    expect(pdf.body.toString()).toContain("not-a-real-pdf");
    const chapters = await request(app)
      .post(`/api/books/${created.body.book.id}/import/library`)
      .expect(400);
    expect(chapters.body.error).toMatch(/Could not read|malformed|initialize PDF/i);
    const partial = await request(app)
      .get(`/api/books/${created.body.book.id}/pdf`)
      .set("Range", "bytes=0-3")
      .expect(206);
    expect(partial.body.toString()).toBe("not-");
    const bare = await request(app).post("/api/books").send({ title: "No File Yet" });
    await request(app).get(`/api/books/${bare.body.book.id}/pdf`).expect(404);
  });
});

describe("reading progress from the viewer", () => {
  const handles: { cleanup: () => void }[] = [];
  afterEach(() => {
    while (handles.length) handles.pop()?.cleanup();
  });

  it("updates the open chapter and can be undone as one reading", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    const created = await request(app).post("/api/books").send({ title: "Reading Notes" });
    const id = created.body.book.id as string;
    const saved = await request(app)
      .post(`/api/books/${id}/chapters/confirm`)
      .send({
        outline: [
          { number: null, title: "One", pdfPageStart: 1, pdfPageEnd: 2 },
          { number: null, title: "Two", pdfPageStart: 3, pdfPageEnd: 4 },
        ],
      })
      .expect(200);
    const firstId = saved.body.chapters[0].id as string;
    const opened = await request(app).post(`/api/books/${id}/reading`).send({ page: 1, pageCount: 4 }).expect(200);
    expect(opened.body.chapters[0].progressPercent).toBe(50);
    expect(opened.body.chapters[1].progressPercent).toBe(0);
    const finished = await request(app).post(`/api/books/${id}/reading`).send({ page: 2, pageCount: 4 }).expect(200);
    expect(finished.body.chapters[0]).toMatchObject({ progressPercent: 100, status: "completed" });
    expect(finished.body.chapters[1].progressPercent).toBe(0);
    const jumped = await request(app).post(`/api/books/${id}/reading`).send({ page: 4, pageCount: 4 }).expect(200);
    expect(jumped.body.chapters[0]).toMatchObject({ progressPercent: 100, status: "completed" });
    expect(jumped.body.chapters[1]).toMatchObject({ progressPercent: 100, status: "completed" });
    expect(jumped.body.examGate).toBeNull();
    const undone = await request(app).post(`/api/chapters/${firstId}/undo`).expect(200);
    expect(undone.body.chapter.progressPercent).toBe(0);
    await request(app).post(`/api/books/${id}/reading`).send({ page: 9, pageCount: 4 }).expect(400);
  });

  it("blocks a later chapter until an earlier exam is passed", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    const created = await request(app).post("/api/books").send({ title: "Exam Gate" });
    const id = created.body.book.id as string;
    const saved = await request(app)
      .post(`/api/books/${id}/chapters/confirm`)
      .send({
        outline: [
          { number: null, title: "One", pdfPageStart: 1, pdfPageEnd: 1 },
          { number: null, title: "Two", pdfPageStart: 2, pdfPageEnd: 2 },
        ],
      })
      .expect(200);
    const firstId = saved.body.chapters[0].id as string;
    const secondId = saved.body.chapters[1].id as string;
    const now = new Date().toISOString();
    h.db.prepare(
      `INSERT INTO projects (id, batch_id, proposal_id, status, brief_json, dismiss_reason, created_at, updated_at)
       VALUES ('proj', NULL, 'p', 'active', '{}', NULL, ?, ?)`,
    ).run(now, now);
    h.db.prepare(
      `INSERT INTO project_versions
       (id, project_id, version_number, brief_json, plan_json, source_snapshot_json, assessment_mode, created_at)
       VALUES ('ver', 'proj', 1, ?, '{}', '[]', 'objective', ?)`,
    ).run(JSON.stringify({ sources: [{ chapterId: firstId }] }), now);
    await request(app).patch(`/api/chapters/${firstId}`).send({ progressPercent: 100 }).expect(200);
    await request(app).patch(`/api/chapters/${secondId}`).send({ progressPercent: 50 }).expect(200);
    const blocked = await request(app).patch(`/api/chapters/${secondId}`).send({ progressPercent: 100 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("exam_required");
    expect(blocked.body.error).toBe("Pass the exam for “One” before marking a later chapter done.");
    h.db.prepare(
      `INSERT INTO project_reviews
       (id, submission_id, version_id, objective_json, questions_json, label, created_at, passed)
       VALUES ('rev', 'sub', 'ver', '[]', '[]', 'passed', ?, 1)`,
    ).run(now);
    const opened = await request(app).patch(`/api/chapters/${secondId}`).send({ progressPercent: 100 }).expect(200);
    expect(opened.body.chapter.status).toBe("completed");
  });

  it("keeps reading when the milestone exam cannot be created", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    const created = await request(app).post("/api/books").send({ title: "Openers" });
    const id = created.body.book.id as string;
    const saved = await request(app)
      .post(`/api/books/${id}/chapters/confirm`)
      .send({
        outline: [
          { number: null, title: "Chapter 1 Motion", pdfPageStart: 1, pdfPageEnd: 1 },
          { number: null, title: "1.1 Speed", pdfPageStart: 1, pdfPageEnd: 2 },
          { number: null, title: "Chapter 2 Forces", pdfPageStart: 3, pdfPageEnd: 3 },
          { number: null, title: "2.1 Mass", pdfPageStart: 3, pdfPageEnd: 4 },
        ],
      })
      .expect(200);
    const firstId = saved.body.chapters[0].id as string;
    const sectionId = saved.body.chapters[1].id as string;
    const held = await request(app).post(`/api/books/${id}/reading`).send({ page: 4, pageCount: 4 }).expect(200);
    expect(held.body.examGate).toMatchObject({ chapterId: firstId, projectId: null });
    expect(held.body.examNotice).toBeNull();
    expect(held.body.chapters[2].progressPercent).toBe(0);
    setSetting(h.db, `exam_unavailable:${firstId}`, "The model did not return a usable project suggestion.");
    const released = await request(app).post(`/api/books/${id}/reading`).send({ page: 4, pageCount: 4 }).expect(200);
    expect(released.body.examGate).toBeNull();
    expect(released.body.examNotice).toMatchObject({
      chapterId: firstId,
      message: "The model did not return a usable project suggestion.",
    });
    expect(released.body.chapters[2]).toMatchObject({ progressPercent: 100, status: "completed" });
    expect(released.body.chapters[3]).toMatchObject({ progressPercent: 100, status: "completed" });
    const now = new Date().toISOString();
    h.db.prepare(
      `INSERT INTO projects (id, batch_id, proposal_id, status, brief_json, dismiss_reason, created_at, updated_at)
       VALUES ('section-exam', NULL, 'p', 'active', '{}', NULL, ?, ?)`,
    ).run(now, now);
    h.db.prepare(
      `INSERT INTO project_versions
       (id, project_id, version_number, brief_json, plan_json, source_snapshot_json, assessment_mode, created_at)
       VALUES ('section-ver', 'section-exam', 1, ?, '{}', '[]', 'objective', ?)`,
    ).run(JSON.stringify({ sources: [{ chapterId: sectionId }] }), now);
    const linked = await request(app).post(`/api/books/${id}/reading`).send({ page: 4, pageCount: 4 }).expect(200);
    expect(linked.body.examNotice).toBeNull();
    expect(linked.body.examGate).toMatchObject({ chapterId: firstId, projectId: "section-exam" });
  });

  it("completes front matter while reading and waits at the next chapter", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    const created = await request(app).post("/api/books").send({ title: "Numbered" });
    const id = created.body.book.id as string;
    const saved = await request(app)
      .post(`/api/books/${id}/chapters/confirm`)
      .send({
        outline: [
          { number: null, title: "Preface", pdfPageStart: 1, pdfPageEnd: 1 },
          { number: null, title: "Chapter 1 Introduction", pdfPageStart: 2, pdfPageEnd: 2 },
          { number: null, title: "1.1 Concepts", pdfPageStart: 2, pdfPageEnd: 3 },
          { number: null, title: "Chapter 2 Frames", pdfPageStart: 4, pdfPageEnd: 4 },
        ],
      })
      .expect(200);
    const inside = await request(app).post(`/api/books/${id}/reading`).send({ page: 3, pageCount: 4 }).expect(200);
    expect(inside.body.chapters.map((chapter: { title: string; progressPercent: number }) => [chapter.title, chapter.progressPercent])).toEqual([
      ["Preface", 100],
      ["Chapter 1 Introduction", 100],
      ["1.1 Concepts", 100],
      ["Chapter 2 Frames", 0],
    ]);
    expect(inside.body.examGate).toBeNull();
    const held = await request(app).post(`/api/books/${id}/reading`).send({ page: 4, pageCount: 4 }).expect(200);
    expect(held.body.chapters[3].progressPercent).toBe(0);
    expect(held.body.examGate).toMatchObject({
      chapterId: saved.body.chapters[1].id,
      title: "Chapter 1 Introduction",
      resumePage: 3,
    });
  });

  it("skips an exam and continues into the next chapter", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    const created = await request(app).post("/api/books").send({ title: "Skippable" });
    const id = created.body.book.id as string;
    const saved = await request(app)
      .post(`/api/books/${id}/chapters/confirm`)
      .send({
        outline: [
          { number: null, title: "Chapter 1 Introduction", pdfPageStart: 1, pdfPageEnd: 1 },
          { number: null, title: "1.1 Concepts", pdfPageStart: 1, pdfPageEnd: 2 },
          { number: null, title: "Chapter 2 Frames", pdfPageStart: 3, pdfPageEnd: 3 },
        ],
      })
      .expect(200);
    const firstId = saved.body.chapters[0].id as string;
    const secondId = saved.body.chapters[2].id as string;
    const now = new Date().toISOString();
    h.db.prepare(
      `INSERT INTO projects (id, batch_id, proposal_id, status, brief_json, dismiss_reason, created_at, updated_at)
       VALUES ('proj', NULL, 'p', 'active', '{}', NULL, ?, ?)`,
    ).run(now, now);
    h.db.prepare(
      `INSERT INTO project_versions
       (id, project_id, version_number, brief_json, plan_json, source_snapshot_json, assessment_mode, created_at)
       VALUES ('ver', 'proj', 1, ?, '{}', '[]', 'objective', ?)`,
    ).run(JSON.stringify({ sources: [{ chapterId: firstId }] }), now);
    const held = await request(app).post(`/api/books/${id}/reading`).send({ page: 3, pageCount: 3 }).expect(200);
    expect(held.body.examGate).toMatchObject({ chapterId: firstId });
    expect(held.body.chapters[2].progressPercent).toBe(0);
    const blocked = await request(app).patch(`/api/chapters/${secondId}`).send({ progressPercent: 100 });
    expect(blocked.status).toBe(409);
    const skipped = await request(app)
      .post(`/api/books/${id}/reading/skip`)
      .send({ chapterId: firstId, page: 3, pageCount: 3 })
      .expect(200);
    expect(skipped.body.examGate).toBeNull();
    expect(skipped.body.chapters[2]).toMatchObject({ progressPercent: 100, status: "completed" });
    const again = await request(app).post(`/api/books/${id}/reading`).send({ page: 3, pageCount: 3 }).expect(200);
    expect(again.body.examGate).toBeNull();
  });

  it("grows a book that has no chapter page spans from the furthest opened page", async () => {
    const h = tempDb();
    handles.push(h);
    const app = createApp(h.db);
    const created = await request(app).post("/api/books").send({ title: "Unread Spine" });
    const id = created.body.book.id as string;
    const read = await request(app).post(`/api/books/${id}/reading`).send({ page: 2, pageCount: 10 }).expect(200);
    expect(read.body.book.identifiers.readPdfPage).toBe("2");
    const dash = await request(app).get("/api/dashboard").expect(200);
    const tree = dash.body.trees.find((item: { bookId: string }) => item.bookId === id);
    expect(tree.growth).toBeCloseTo(0.2);
    const back = await request(app).post(`/api/books/${id}/reading`).send({ page: 1, pageCount: 10 }).expect(200);
    expect(back.body.book.identifiers.readPdfPage).toBe("2");
    expect(back.body.book.identifiers.lastPdfPage).toBe("1");
  });
});
