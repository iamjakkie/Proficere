import { describe, expect, it } from "vitest";
import {
  articleSegments,
  bookSegments,
  cleanPriority,
  courseSegments,
  exerciseHitsFromJson,
  fieldFigure,
  finishedSegmentCount,
  isPdfLink,
  isUniversityHost,
  lessonTitlesFromHtml,
  courseraCourseTitles,
  courseraModuleTitles,
  courseraTarget,
  hasPublicSyllabus,
  ocwLectureNotesUrl,
  ocwLectureTitles,
  udemyCourseSlug,
  udemySectionTitles,
  parseLessonList,
  rankExerciseHits,
  searchIsDue,
  searchQueriesFromTitles,
  searchTopicsFromReadings,
  searchTopicsFromTitles,
  priorityRank,
  sharePercent,
  workshopSegments,
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

  it("reads Udemy section titles and ignores lectures", () => {
    expect(udemyCourseSlug("https://www.udemy.com/course/multithreading_parta/?couponCode=X")).toBe(
      "multithreading_parta",
    );
    expect(udemyCourseSlug("https://www.udemy.com/course/multithreading_parta/learn/lecture/1")).toBe(
      "multithreading_parta",
    );
    expect(udemyCourseSlug("https://www.coursera.org/learn/threads")).toBeNull();
    expect(courseraTarget("https://www.coursera.org/specializations/rust")).toEqual({
      kind: "specialization",
      slug: "rust",
    });
    expect(courseraTarget("https://www.coursera.org/learn/polars?utm=1")).toEqual({
      kind: "course",
      slug: "polars",
    });
    expect(courseraTarget("https://www.coursera.org/about")).toBeNull();
    expect(hasPublicSyllabus("https://www.udemy.com/course/multithreading_parta/")).toBe(true);
    expect(hasPublicSyllabus("https://www.coursera.org/specializations/rust")).toBe(true);
    expect(ocwLectureNotesUrl("https://ocw.mit.edu/courses/16-346-astrodynamics-fall-2008/")).toBe(
      "https://ocw.mit.edu/courses/16-346-astrodynamics-fall-2008/pages/lecture-notes/",
    );
    expect(
      ocwLectureTitles(`<main id="course-content-section"><table>
        <tr><th>LEC #</th><th>TOPICS</th></tr>
        <tr><td>1</td><td>The two-body problem (<a href="/lec_01/">PDF</a>)</td></tr>
        <tr><td>3</td><td>Barker&rsquo;s equation (<a href="/lec_03/">PDF</a>)</td></tr>
        </table><ul><li>Prof. Richard Battin</li></ul></main>`),
    ).toEqual(["1. The two-body problem", "3. Barker's equation"]);
    expect(
      courseraCourseTitles(
        ["b", "a"],
        [
          { id: "a", name: "Polars from Zero", description: "long" },
          { id: "b", name: "Rust From Zero" },
        ],
      ),
    ).toEqual(["Rust From Zero", "Polars from Zero"]);
    expect(courseraModuleTitles([{ name: "Ownership" }, { name: "Lecture video" }])).toEqual([
      "Ownership",
      "Lecture video",
    ]);
    expect(
      udemySectionTitles([
        {
          results: [
            { _class: "chapter", title: "Getting Started" },
            { _class: "lecture", title: "Hello World" },
            { _class: "practice", title: "Assignment" },
          ],
        },
        { results: [{ _class: "chapter", title: "Semaphores" }, { _class: "chapter", title: "Getting Started" }] },
      ]),
    ).toEqual(["Getting Started", "Semaphores"]);
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
    expect(searchQueriesFromTitles([])).toEqual([]);
    expect(searchQueriesFromTitles(["Estimation"])[0]).toContain("Estimation");
    expect(searchQueriesFromTitles(["Estimation"])[0]).toContain("filetype:pdf");
    expect(searchQueriesFromTitles(["Estimation"])[0]).toContain("site:.edu");
  });

  it("sends one Google query per topic and groups similar chapters", () => {
    const titles = [
      "3.1 Position, Displacement, and Average Velocity",
      "Introduction",
      "Chapter Outline",
      "Chapter 3 Motion Along a Straight Line",
      "Chapter Review",
      "2.4 Products of Vectors",
      "2.1 Scalars and Vectors",
      "Chapter 2 Vectors",
      "Lecture 2: Forces",
    ];
    expect(searchTopicsFromTitles(titles)).toEqual(["Motion Along a Straight Line", "Vectors", "Forces"]);
    const queries = searchQueriesFromTitles(titles);
    expect(queries).toHaveLength(3);
    expect(queries[0]).toBe(
      '"Motion Along a Straight Line" (exercises OR "problem set" OR homework) filetype:pdf (site:.edu OR site:.ac.uk OR site:.edu.au OR site:.ac.nz OR site:.ac.za OR site:.edu.sg)',
    );
    expect(queries[1]).toContain("Vectors");
    expect(queries.every((query) => !/\d/.test(query))).toBe(true);
    expect(
      searchTopicsFromTitles(["Blank Page", "About OpenStax", "Problems & Exercises", "Section Summary", "Forces"]),
    ).toEqual(["Forces"]);
    expect(
      searchTopicsFromTitles([
        "Products of Vectors",
        "Algebra of Vectors",
        "Kalman Filter",
        "Extended Kalman Filter",
        "Significant Figures",
      ]),
    ).toEqual(["Vectors", "Kalman Filter", "Significant Figures"]);
    expect(
      searchTopicsFromTitles([
        "Introduction: The Nature of Science and Physics",
        "Introduction to Science and the Realm of Physics, Physical Quantities, and Units",
      ]),
    ).toEqual(["Introduction: The Nature of Science and Physics"]);
    expect(
      searchTopicsFromReadings([
        { title: "3.1 Position", resource: "Physics", parentTitle: "Chapter 3 Motion Along a Straight Line" },
        { title: "Chapter 3 Graph Theory", resource: "Discrete" },
      ]),
    ).toEqual(["Motion Along a Straight Line", "Graph Theory"]);
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
    expect(workshopSegments([{ column: "done" }, { column: "todo" }, { column: "test" }])).toEqual([1, 0, 0]);
    expect(fieldFigure("workshop", [1, 0, 0])).toBe("1/3");
    expect(cleanPriority("top")).toBe("top");
    expect(cleanPriority("later")).toBe("none");
    expect(priorityRank("top")).toBeLessThan(priorityRank("high"));
    expect(priorityRank("high")).toBeLessThan(priorityRank("none"));
  });

  it("rejects a workshop plan that is not a card list", () => {
    expect(WorkshopPlanSchema.safeParse({ cards: [] }).success).toBe(false);
    expect(WorkshopPlanSchema.safeParse({ cards: [{ title: "Sketch the board" }] }).success).toBe(true);
    expect(WorkshopPlanSchema.safeParse({ cards: [{ title: "X", column: "archived" }] }).success).toBe(false);
  });
});
