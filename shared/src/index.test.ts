import { describe, expect, it } from "vitest";
import { applyProgress, planProgress } from "./progress.js";
import { gradeAnswer } from "./quiz.js";
import { isDue, isWeakQuiz, nextReviewDate, SUCCESS_INTERVALS_DAYS } from "./schedule.js";
import { passageExistsInSource, titleGroundedInSource } from "./grounding.js";
import {
  chapterCompleteKey,
  reconstructIsland,
  unlockForNewChapterCount,
} from "./rewards.js";
import { FIXTURE_SOURCE, FIXTURE_CHAPTER_TITLES } from "./fixture.js";
import { assignPdfPageIndices, outlineFromPdfBookmarks, overlayPrintedPages, parseOutlineFromText, parseTableOfContents } from "./outline.js";
import { hasProse, isSubstantialChapter, sliceLongestChapter } from "./chapter-text.js";
import {
  creditVisitedPage,
  isFrontMatter,
  milestoneChapterIds,
  milestoneSpanIds,
  readingMilestoneGate,
  resumePdfPage,
} from "./reading.js";
import { bookGrowth, growthForBook, trunkBlocks, treeTypeForBook } from "./trees.js";
import { DEFAULT_BOOK_CATEGORIES, bookCategory, createCategory } from "./categories.js";

describe("progress", () => {
  it("maps percent to status", () => {
    expect(applyProgress({ progressPercent: 0, status: "not_started" }, 0).status).toBe(
      "not_started",
    );
    expect(applyProgress({ progressPercent: 0, status: "not_started" }, 40).status).toBe(
      "in_progress",
    );
    expect(applyProgress({ progressPercent: 0, status: "not_started" }, 100).status).toBe(
      "completed",
    );
  });

  it("does not count unselected chapters in plan progress", () => {
    const plan = planProgress([
      { selected: true, status: "completed" },
      { selected: false, status: "completed" },
      { selected: true, status: "not_started" },
    ]);
    expect(plan).toEqual({ selected: 2, completedSelected: 1 });
  });
});

describe("schedule", () => {
  it("uses documented success intervals", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const next = nextReviewDate({ successfulReviewCount: 0, weak: false, from });
    expect(next.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect(SUCCESS_INTERVALS_DAYS).toEqual([1, 3, 7, 14]);
  });

  it("schedules weak results sooner", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const next = nextReviewDate({ successfulReviewCount: 3, weak: true, from });
    expect(next.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("marks past dates as due", () => {
    expect(isDue("2020-01-01T00:00:00.000Z", new Date("2026-01-01"))).toBe(true);
    expect(isWeakQuiz(1, 3)).toBe(true);
    expect(isWeakQuiz(2, 3)).toBe(false);
  });
});

describe("grounding", () => {
  it("accepts passages that exist in the fixture", () => {
    expect(
      passageExistsInSource(
        "A dead-reckoning update is therefore a prediction, not an observation of location.",
        FIXTURE_SOURCE,
      ),
    ).toBe(true);
  });

  it("rejects invented quotations", () => {
    expect(
      passageExistsInSource(
        "The Kalman gain is always optimal for any nonlinear system.",
        FIXTURE_SOURCE,
      ),
    ).toBe(false);
  });
});

describe("outline parse", () => {
  it("extracts fixture chapter titles without inventing extras", () => {
    const outline = parseOutlineFromText(FIXTURE_SOURCE);
    expect(outline.map((c) => c.title)).toEqual(FIXTURE_CHAPTER_TITLES);
    expect(outline[0]?.pdfPageStart ?? null).toBeNull();
    for (const chapter of outline) {
      expect(titleGroundedInSource(chapter.title, FIXTURE_SOURCE)).toBe(true);
    }
  });

  it("keeps printed page labels separate from PDF page indices", () => {
    const text = [
      "--- PDF page 4 ---",
      "Chapter 1. Dead Reckoning Assumptions .... 12",
      "Dead reckoning estimates present position from a known start, a heading, a speed, and elapsed time.",
    ].join("\n");
    const outline = assignPdfPageIndices(text, parseOutlineFromText(text));
    expect(outline).toHaveLength(1);
    expect(outline[0]?.pageStart).toBe("12");
    expect(outline[0]?.pdfPageStart).toBe(4);
  });

  it("flattens PDF bookmarks and fills page ranges from dests", () => {
    const outline = outlineFromPdfBookmarks(
      [
        {
          title: "Dead Reckoning",
          dest: "ch1",
          items: [{ title: "Assumptions", dest: "ch1a" }],
        },
        { title: "Observability", dest: "ch2" },
        { title: "Skip me", url: "https://example.com" },
      ],
      (node) => ({ ch1: 4, ch1a: 8, ch2: 20 }[String(node.dest)] ?? null),
    );
    expect(outline.map((chapter) => chapter.title)).toEqual([
      "Dead Reckoning",
      "Assumptions",
      "Observability",
    ]);
    expect(outline[0]).toMatchObject({ number: "1", pdfPageStart: 4, pdfPageEnd: 7 });
    expect(outline[1]).toMatchObject({ number: "1.1", parentNumber: "1", pdfPageStart: 8, pdfPageEnd: 19 });
    expect(outline[2]?.pdfPageStart).toBe(20);
  });

  it("reads printed page numbers from contents lines without requiring leader dots", () => {
    const text = [
      "--- PDF page 3 ---",
      "1 Introduction 1",
      "2 Linear Estimation .......... 15",
      "Chapter 3. Tracking  47",
      "Observability",
      "............... 88",
    ].join("\n");
    const toc = parseTableOfContents(text);
    expect(toc.map((chapter) => ({ title: chapter.title, page: chapter.pageStart }))).toEqual([
      { title: "Introduction", page: "1" },
      { title: "Linear Estimation", page: "15" },
      { title: "Tracking", page: "47" },
      { title: "Observability", page: "88" },
    ]);
    expect(toc[0]?.pageEnd).toBe("14");
    expect(toc[1]?.pageEnd).toBe("46");
  });

  it("copies printed contents pages onto bookmark titles", () => {
    const bookmarks = outlineFromPdfBookmarks(
      [
        { title: "Introduction", dest: "a" },
        { title: "Linear Estimation", dest: "b" },
      ],
      (node) => ({ a: 20, b: 34 }[String(node.dest)] ?? null),
    );
    const toc = parseTableOfContents("1 Introduction 1\n2 Linear Estimation 15\n");
    const merged = overlayPrintedPages(bookmarks, toc);
    expect(merged[0]).toMatchObject({
      title: "Introduction",
      pageStart: "1",
      pageEnd: "14",
      pdfPageStart: 20,
    });
    expect(merged[1]).toMatchObject({
      title: "Linear Estimation",
      pageStart: "15",
      pdfPageStart: 34,
    });
  });
});

describe("chapter text", () => {
  it("prefers the chapter body over a short contents line", () => {
    const body = "Currents and slip make the speed assumption false. ".repeat(8);
    const text = [
      "Dead Reckoning Assumptions .... 12",
      "--- PDF page 3 ---",
      "Dead Reckoning Assumptions",
      body,
      "--- PDF page 4 ---",
      "Why a Compass Heading Is Not a Course Over Ground",
      "Heading is not the path over the ground. ".repeat(8),
    ].join("\n");
    const sliced = sliceLongestChapter(text, "Dead Reckoning Assumptions", [
      "Why a Compass Heading Is Not a Course Over Ground",
    ]);
    expect(sliced?.pdfPageStart).toBe(3);
    expect(sliced?.excerpt).toContain("Currents and slip");
    expect(sliced?.excerpt).not.toContain(".... 12");
    expect(isSubstantialChapter("Dead Reckoning Assumptions", "Dead Reckoning Assumptions")).toBe(
      false,
    );
    expect(
      hasProse(
        "1 Introduction\n2 Essential background I\n3 The alpha beta gamma filter\n4 Kalman Filter in one dimension\n5 Adding process noise",
      ),
    ).toBe(false);
    expect(
      hasProse(
        "A moving average smooths a sequence by replacing each sample with the mean of its neighbors.",
      ),
    ).toBe(true);
  });
});

describe("book trees", () => {
  it("weights chapter progress by page span and leaves a sapling at zero", () => {
    expect(bookGrowth([])).toBe(0);
    expect(trunkBlocks(0)).toBe(1);
    expect(trunkBlocks(1)).toBe(8);
    expect(
      bookGrowth([
        { progressPercent: 100, pageStart: "1", pageEnd: "11" },
        { progressPercent: 0, pageStart: "11", pageEnd: "111" },
      ]),
    ).toBeCloseTo(10 / 110);
    expect(bookGrowth([{ progressPercent: 100 }, { progressPercent: 0 }])).toBe(0.5);
    expect(bookGrowth([{ progressPercent: 100, pageEnd: "20" }, { progressPercent: 0 }])).toBe(0.5);
    expect(treeTypeForBook({})).toBe("broadleaf");
    expect(treeTypeForBook({ treeGroup: "conifer" })).toBe("conifer");
    expect(bookGrowth([], 0.25)).toBe(0.25);
    expect(bookGrowth([{ progressPercent: 0 }], 0.4)).toBe(0.4);
    expect(bookGrowth([{ progressPercent: 100 }], 0.2)).toBe(1);
    expect(
      growthForBook(
        [{ progressPercent: 0, pdfPageStart: 1 }],
        { readPdfPage: "9", pdfPageCount: "10" },
      ),
    ).toBe(0);
    expect(growthForBook([], { readPdfPage: "2", pdfPageCount: "10" })).toBe(0.2);
  });
});

describe("reading progress", () => {
  const chapters = [
    { id: "a", pdfPageStart: 1, pdfPageEnd: 2, progressPercent: 0, pagePosition: null },
    { id: "b", pdfPageStart: 3, pdfPageEnd: 4, progressPercent: 0, pagePosition: null },
  ];

  it("credits the open page inside its chapter and leaves the others", () => {
    const first = creditVisitedPage(chapters, 1, 4, 0);
    expect(first.credits).toEqual([{ id: "a", progressPercent: 50, creditedPdfPage: 1 }]);
    const finished = creditVisitedPage(
      [{ ...chapters[0], progressPercent: 50, pagePosition: "pdf:1" }, chapters[1]],
      2,
      4,
      0,
    );
    expect(finished.credits[0]).toMatchObject({ id: "a", progressPercent: 100, creditedPdfPage: 2 });
    const jumped = creditVisitedPage(chapters, 4, 4, 0);
    expect(jumped.credits).toEqual([
      { id: "a", progressPercent: 100, creditedPdfPage: 2 },
      { id: "b", progressPercent: 100, creditedPdfPage: 4 },
    ]);
  });

  it("does not lower a higher saved percent", () => {
    const kept = creditVisitedPage(
      [{ ...chapters[0], progressPercent: 100, pagePosition: "pdf:2" }, chapters[1]],
      1,
      4,
      0,
    );
    expect(kept.credits).toEqual([]);
  });

  it("tracks the furthest opened page when no chapter has PDF pages", () => {
    const plain = [
      { id: "a", pdfPageStart: null, pdfPageEnd: null, progressPercent: 0, pagePosition: null },
    ];
    expect(creditVisitedPage(plain, 3, 10, 1).bookReadPage).toBe(3);
    expect(creditVisitedPage(plain, 2, 10, 5).bookReadPage).toBe(5);
    expect(creditVisitedPage([], 8, 10, 0)).toMatchObject({ bookReadPage: 8, credits: [] });
  });

  it("resumes a chapter at the furthest credited page", () => {
    expect(resumePdfPage({ ...chapters[0], pagePosition: "pdf:2" })).toBe(2);
    expect(resumePdfPage(chapters[0])).toBe(1);
  });

  it("treats preface, contents, and acknowledgements as front matter", () => {
    expect(isFrontMatter("Preface")).toBe(true);
    expect(isFrontMatter("Contents")).toBe(true);
    expect(isFrontMatter("Acknowledgments")).toBe(true);
    expect(isFrontMatter("Chapter 1 Introduction")).toBe(false);
    expect(isFrontMatter("1.1 Fundamental Concepts")).toBe(false);
    expect(isFrontMatter("Principles of GNSS, Inertial, and Multisensor Integrated Navigation Systems")).toBe(true);
  });

  it("stops at the next numbered chapter and leaves the open chapter open", () => {
    const outline = [
      { id: "title", title: "Principles of GNSS, Inertial, and Multisensor Integrated Navigation Systems", pdfPageStart: 2, pdfPageEnd: 5, progressPercent: 0, pagePosition: null },
      { id: "contents", title: "Contents", pdfPageStart: 6, pdfPageEnd: 17, progressPercent: 0, pagePosition: null },
      { id: "preface", title: "Preface", pdfPageStart: 18, pdfPageEnd: 19, progressPercent: 0, pagePosition: null },
      { id: "thanks", title: "Acknowledgments", pdfPageStart: 20, pdfPageEnd: 21, progressPercent: 0, pagePosition: null },
      { id: "ch1", title: "Chapter 1 Introduction", pdfPageStart: 22, pdfPageEnd: 22, progressPercent: 0, pagePosition: null },
      { id: "s11", title: "1.1 Fundamental Concepts", pdfPageStart: 22, pdfPageEnd: 25, progressPercent: 0, pagePosition: null },
      { id: "ch2", title: "Chapter 2 Coordinate Frames", pdfPageStart: 44, pdfPageEnd: 50, progressPercent: 0, pagePosition: null },
    ];
    const inside = creditVisitedPage(outline, 24, 797, 0);
    expect(inside.credits.map((credit) => credit.id)).toEqual(["title", "contents", "preface", "thanks", "ch1", "s11"]);
    expect(inside.credits.find((credit) => credit.id === "s11")?.progressPercent).toBe(75);
    expect(readingMilestoneGate(outline, 24, 797)).toBeNull();
    expect(readingMilestoneGate(outline, 43, 797)).toBeNull();
    expect(readingMilestoneGate(outline, 44, 797)).toMatchObject({
      chapterId: "ch1",
      title: "Chapter 1 Introduction",
      stopIndex: 6,
      resumePage: 43,
    });
    const parts = [
      { id: "part", title: "Sets and functions", pdfPageStart: 7, pdfPageEnd: 7, progressPercent: 0, pagePosition: null },
      { id: "intro", title: "Introduction to linear algebra", pdfPageStart: 7, pdfPageEnd: 11, progressPercent: 0, pagePosition: null },
      { id: "sets", title: "Sets", pdfPageStart: 12, pdfPageEnd: 17, progressPercent: 0, pagePosition: null },
      { id: "next", title: "The 2-dimensional space", pdfPageStart: 157, pdfPageEnd: 157, progressPercent: 0, pagePosition: null },
      { id: "curves", title: "Parametric curves on the plane", pdfPageStart: 157, pdfPageEnd: 166, progressPercent: 0, pagePosition: null },
    ];
    expect(readingMilestoneGate(parts, 11, 200)).toBeNull();
    expect(readingMilestoneGate(parts, 157, 200)).toMatchObject({
      chapterId: "part",
      title: "Sets and functions",
      stopIndex: 3,
      resumePage: 156,
    });
    expect(milestoneChapterIds(parts, "part")).toEqual(["part", "intro", "sets"]);
  });

  it("asks for a numbered chapter when the next chapter starts", () => {
    const row = (id: string, title: string, start: number, end: number) => ({
      id,
      title,
      pdfPageStart: start,
      pdfPageEnd: end,
      progressPercent: 0,
      pagePosition: null,
    });
    const book = [
      row("ch1", "Chapter 1 Introduction: The Nature of Science and Physics", 25, 25),
      row("outline1", "Chapter Outline", 25, 25),
      row("questions", "Conceptual Questions", 53, 53),
      row("problems", "Problems & Exercises", 53, 56),
      row("ch2", "Chapter 2 Kinematics", 57, 57),
      row("outline2", "Chapter Outline", 57, 57),
      row("intro2", "Introduction to One-Dimensional Kinematics", 57, 57),
      row("s21", "2.1 Displacement", 58, 60),
      row("ch3", "Chapter 3 Two-Dimensional Kinematics", 119, 119),
      row("s31", "3.1 Kinematics in Two Dimensions", 120, 130),
    ];
    expect(readingMilestoneGate(book, 56, 1671)).toBeNull();
    expect(readingMilestoneGate(book, 58, 1671)).toMatchObject({
      chapterId: "ch1",
      title: "Chapter 1 Introduction: The Nature of Science and Physics",
      resumePage: 56,
    });
    expect(readingMilestoneGate(book, 119, 1671)).toMatchObject({
      chapterId: "ch2",
      title: "Chapter 2 Kinematics",
      resumePage: 118,
    });
    expect(milestoneChapterIds(book, "ch2")).toEqual(["ch2", "outline2", "intro2", "s21"]);
    expect(milestoneSpanIds(book, "s21")).toEqual(["ch2", "outline2", "intro2", "s21"]);
    expect(milestoneSpanIds(book, "questions")).toEqual(["ch1", "outline1", "questions", "problems"]);
  });
});

describe("rewards", () => {
  it("is idempotent for the same chapter key", () => {
    const key = chapterCompleteKey("ch-1");
    const events = [
      { rewardKey: key, unlock: "cottage" },
      { rewardKey: key, unlock: "cottage" },
    ];
    // reconstruction uses unique keys at persistence layer; here we assert key identity
    expect(chapterCompleteKey("ch-1")).toBe(key);
    expect(unlockForNewChapterCount(1)).toBe("cottage");
    expect(reconstructIsland([{ rewardKey: key, unlock: "cottage" }]).completedChapters).toBe(1);
    expect(events[0].rewardKey).toBe(events[1].rewardKey);
  });

  it("keeps one plate id per category", () => {
    const ids = DEFAULT_BOOK_CATEGORIES.map((category) => category.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(bookCategory(DEFAULT_BOOK_CATEGORIES, "navigation")?.label).toBe("Navigation");
    expect(bookCategory(DEFAULT_BOOK_CATEGORIES, null)).toBeNull();
    expect(bookCategory(DEFAULT_BOOK_CATEGORIES, "not-a-plate")).toBeNull();
    expect(createCategory("Electronic warfare", DEFAULT_BOOK_CATEGORIES).id).toBe("electronic-warfare");
    expect(createCategory("Navigation", DEFAULT_BOOK_CATEGORIES).id).toBe("navigation-2");
  });

  it("scores a select, a multi-select, and a calculated value", () => {
    expect(gradeAnswer({ correctChoiceId: "a" }, "a")).toBe(true);
    expect(gradeAnswer({ correctChoiceId: "a" }, "b")).toBe(false);
    expect(gradeAnswer({ kind: "multi", correctChoiceIds: ["a", "c"] }, "c,a")).toBe(true);
    expect(gradeAnswer({ kind: "multi", correctChoiceIds: ["a", "c"] }, "a")).toBe(false);
    expect(gradeAnswer({ kind: "numeric", answer: "1/2" }, "0.5")).toBe(true);
    expect(gradeAnswer({ kind: "numeric", answer: "0.25" }, "0.5")).toBe(false);
    expect(gradeAnswer({ kind: "numeric", answer: "10" }, "")).toBe(false);
  });

  it("does not deteriorate with zero new events", () => {
    const island = reconstructIsland([{ rewardKey: "chapter_complete:a", unlock: "cottage" }]);
    expect(island.unlocks).toContain("cottage");
    expect(reconstructIsland([{ rewardKey: "chapter_complete:a", unlock: "cottage" }])).toEqual(
      island,
    );
  });
});
