import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { openDatabase } from "./db.js";
import { resolveInsideLibrary, saveLibraryFolder } from "./library.js";

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
    expect(jumped.body.chapters[1]).toMatchObject({ progressPercent: 100, status: "completed" });
    const undone = await request(app).post(`/api/chapters/${firstId}/undo`).expect(200);
    expect(undone.body.chapter.progressPercent).toBe(0);
    await request(app).post(`/api/books/${id}/reading`).send({ page: 9, pageCount: 4 }).expect(400);
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
