import { describe, expect, it } from "vitest";
import { readingPace, readingTraction, weekProgress } from "./week.js";

const now = new Date("2026-11-16T18:00:00.000Z");

describe("last seven days", () => {
  it("counts how far each book moved, and ignores a page already passed", () => {
    const week = weekProgress(
      [
        { at: "2026-11-09T10:00:00.000Z", bookId: "a", page: 20 },
        { at: "2026-11-12T10:00:00.000Z", bookId: "a", page: 10 },
        { at: "2026-11-12T12:00:00.000Z", bookId: "a", page: 35 },
        { at: "2026-11-16T09:00:00.000Z", bookId: "b", page: 4 },
      ],
      [{ at: "2026-11-14T08:00:00.000Z", passed: true }, { at: "2026-11-01T08:00:00.000Z", passed: true }],
      now,
    );
    expect(week.pages).toBe(19);
    expect(week.days.map((day) => day.pages)).toEqual([0, 0, 15, 0, 0, 0, 4]);
    expect(week.activeDays).toBe(3);
    expect(week.exams).toBe(1);
    expect(week.passed).toBe(1);
    const traction = readingTraction(
      [
        { at: "2026-11-09T10:00:00.000Z", bookId: "a", page: 20 },
        { at: "2026-11-12T10:00:00.000Z", bookId: "a", page: 10 },
        { at: "2026-11-12T12:00:00.000Z", bookId: "a", page: 35 },
        { at: "2026-11-16T09:00:00.000Z", bookId: "b", page: 4 },
      ],
      [{ at: "2026-11-14T08:00:00.000Z", passed: true }, { at: "2026-11-01T08:00:00.000Z", passed: true }],
      now,
    );
    expect(traction.week.pages).toBe(week.pages);
    expect(traction.previousWeek.pages).toBe(20);
    expect(traction.previousWeek.activeDays).toBe(1);
    expect(traction.month.pages).toBe(39);
    expect(traction.previousMonth.pages).toBe(0);
  });

  it("tracks four weeks of the books that moved, and keeps scored exams", () => {
    const pace = readingPace(
      [
        { at: "2026-10-01T10:00:00.000Z", bookId: "old", title: "Old", page: 40 },
        { at: "2026-11-10T10:00:00.000Z", bookId: "a", title: "Physics", page: 10 },
        { at: "2026-11-12T10:00:00.000Z", bookId: "a", title: "Physics", page: 25 },
        { at: "2026-10-01T10:00:00.000Z", bookId: "c", title: "Mechanics", page: 100 },
        { at: "2026-11-11T10:00:00.000Z", bookId: "c", title: "Mechanics", page: 110 },
        { at: "2026-11-16T10:00:00.000Z", bookId: "b", title: "Algebra", page: 4 },
      ],
      [
        { at: "2026-11-05T10:00:00.000Z", grade: "9/10" },
        { at: "2026-11-14T10:00:00.000Z", grade: "6/10" },
        { at: "2026-10-13T10:00:00.000Z", grade: "A" },
      ],
      now,
    );
    expect(pace.books.map((book) => book.title)).toEqual(["Physics", "Mechanics", "Algebra"]);
    expect(pace.books[0]?.gained).toBe(25);
    expect(pace.books[0]?.points.at(-1)).toBe(25);
    expect(pace.books[0]?.points[pace.days.findIndex((day) => day.date === "2026-11-10")]).toBe(10);
    expect(pace.books[1]?.gained).toBe(10);
    expect(pace.books[1]?.points[0]).toBe(100);
    expect(pace.books[1]?.points.at(-1)).toBe(110);
    expect(pace.scores).toEqual([
      { date: "2026-11-05", score: 9, total: 10 },
      { date: "2026-11-14", score: 6, total: 10 },
    ]);
    expect(pace.days.filter((day) => day.active).length).toBe(6);
  });

  it("is a quiet week when nothing happened", () => {
    const week = weekProgress([], [], now);
    expect(week.pages).toBe(0);
    expect(week.activeDays).toBe(0);
    expect(week.exams).toBe(0);
    expect(week.days).toHaveLength(7);
  });
});
