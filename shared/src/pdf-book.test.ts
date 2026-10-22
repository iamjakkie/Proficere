import { describe, expect, it } from "vitest";
import { chooseImportedBook, titleIsPlaceholder } from "./pdf-book.js";

const source = `Linear Algebra Illustrated
Jane Q. Author
1 The Euclidean plane: angles 12
2 The Euclidean plane: distances 40`;

describe("chooseImportedBook", () => {
  it("uses a title and chapters that appear in the PDF text", () => {
    const chosen = chooseImportedBook({
      filename: "scan.pdf",
      sourceText: source,
      localOutline: [],
      ai: {
        title: "Linear Algebra Illustrated",
        author: "Jane Q. Author",
        chapters: [
          { number: "1", title: "The Euclidean plane: angles", pageStart: "12", pageEnd: null },
          { number: "2", title: "The Euclidean plane: distances", pageStart: "40", pageEnd: null },
          { number: "3", title: "A chapter that was not in the file", pageStart: null, pageEnd: null },
        ],
      },
    });
    expect(chosen.title).toBe("Linear Algebra Illustrated");
    expect(chosen.author).toBe("Jane Q. Author");
    expect(chosen.outline.map((chapter) => chapter.title)).toEqual([
      "The Euclidean plane: angles",
      "The Euclidean plane: distances",
    ]);
    expect(chosen.titleFromFile).toBe(false);
  });

  it("keeps a bookmark list and ignores a title that is not in the file", () => {
    const chosen = chooseImportedBook({
      filename: "notes.pdf",
      sourceText: source,
      localOutline: [
        { number: "1", title: "The Euclidean plane: angles", pageStart: null, pageEnd: null, pdfPageStart: 12 },
        { number: "2", title: "The Euclidean plane: distances", pageStart: null, pageEnd: null, pdfPageStart: 40 },
      ],
      ai: { title: "Some Other Book", author: "Nobody", chapters: [] },
    });
    expect(chosen.title).toBe("notes");
    expect(chosen.author).toBeNull();
    expect(chosen.outline).toHaveLength(2);
    expect(chosen.titleFromFile).toBe(true);
    expect(titleIsPlaceholder("Untitled book", "notes.pdf")).toBe(true);
    expect(titleIsPlaceholder("Linear Algebra Illustrated", "notes.pdf")).toBe(false);
  });
});
