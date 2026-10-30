import { describe, expect, it } from "vitest";
import {
  articleSegments,
  bookSegments,
  courseSegments,
  exerciseHitsFromJson,
  fieldFigure,
  finishedSegmentCount,
  isPdfLink,
  isUniversityHost,
  lessonTitlesFromHtml,
  parseLessonList,
  rankExerciseHits,
  searchIsDue,
  searchQueryFromTitles,
  sharePercent,
  WorkshopPlanSchema,
} from "./shelf.js";

describe("shelf helpers", () => {
  it("parses a pasted lesson list without inventing lines", () => {
    expect(parseLessonList("1. Vectors\n- Matrices\n\nHome\n")).toEqual(["Vectors", "Matrices"]);
    expect(parseLessonList("")).toEqual([]);
  });

  it("reads headings from a public syllabus and rejects a page that has none", () => {
    const html = "<html><body><h2>Week 1: Kinematics</h2><ul><li>Lecture 2: Forces</li><li>Sign in</li></ul></body></html>";
    expect(lessonTitlesFromHtml(html).titles).toEqual(["Week 1: Kinematics", "Lecture 2: Forces"]);
    expect(lessonTitlesFromHtml("<html><body><p>Welcome</p></body></html>").reason).toMatch(/did not expose/i);
  });

  it("keeps university PDF links and drops pages that are not PDFs", () => {
    expect(isPdfLink("https://ocw.mit.edu/notes.pdf")).toBe(true);
    expect(isPdfLink("https://example.com/course")).toBe(false);
    expect(isUniversityHost("web.mit.edu")).toBe(true);
    expect(isUniversityHost("udemy.com")).toBe(false);
    const ranked = rankExerciseHits(
      [
        { title: "Blog", url: "https://example.com/post" },
        { title: "HW", url: "https://dept.example.edu/hw.pdf", snippet: "Kalman filters" },
        { title: "Notes", url: "https://files.example.org/sheet.pdf" },
      ],
      ["Kalman filters"],
    );
    expect(ranked.map((item) => item.url)).toEqual([
      "https://dept.example.edu/hw.pdf",
      "https://files.example.org/sheet.pdf",
    ]);
    expect(ranked[0]?.matchedTitle).toBe("Kalman filters");
    expect(ranked[0]?.university).toBe(true);
  });

  it("does not invent hits from an empty or unexpected payload", () => {
    expect(exerciseHitsFromJson({})).toEqual([]);
    expect(exerciseHitsFromJson({ items: [{ title: "Only a title" }] })).toEqual([]);
    expect(searchQueryFromTitles([])).toBe("");
    expect(searchQueryFromTitles(["Estimation"])).toBe("Estimation exercise pdf");
  });

  it("treats a search as due once a day has passed", () => {
    const now = Date.parse("2026-10-30T12:00:00.000Z");
    expect(searchIsDue(null, now)).toBe(true);
    expect(searchIsDue("2026-10-30T06:00:00.000Z", now)).toBe(false);
    expect(searchIsDue("2026-10-29T11:00:00.000Z", now)).toBe(true);
  });

  it("counts finished chapters and lessons, and a percent for an article", () => {
    expect(bookSegments([], 0.4)).toEqual([0.4]);
    const chapters = bookSegments([{ progressPercent: 100 }, { progressPercent: 50 }, { progressPercent: 0 }], 0);
    expect(chapters).toEqual([1, 0.5, 0]);
    expect(finishedSegmentCount(chapters)).toBe(1);
    expect(fieldFigure("book", chapters)).toBe("1/3");
    expect(courseSegments([{ done: true }, { done: false }])).toEqual([1, 0]);
    expect(fieldFigure("course", courseSegments([{ done: true }, { done: false }]))).toBe("1/2");
    expect(fieldFigure("course", [])).toBe("0/0");
    expect(articleSegments(40)).toEqual([0.4]);
    expect(fieldFigure("article", articleSegments(40))).toBe("40%");
    expect(sharePercent([1, 0.5, 0, 0.4])).toBe(48);
    expect(sharePercent([])).toBe(0);
  });

  it("rejects a workshop plan that is not a card list", () => {
    expect(WorkshopPlanSchema.safeParse({ cards: [] }).success).toBe(false);
    expect(WorkshopPlanSchema.safeParse({ cards: [{ title: "Sketch the board" }] }).success).toBe(true);
    expect(WorkshopPlanSchema.safeParse({ cards: [{ title: "X", column: "archived" }] }).success).toBe(false);
  });
});
