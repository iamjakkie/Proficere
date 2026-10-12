import { describe, expect, it } from "vitest";
import { reviewPackFromModelJson } from "./openrouter.js";
import { articleText, findSectionLink, linksFromHtml, sectionMatchKey } from "./site-chapter.js";

const PAGE = `
<nav><a href="/secret.html">Secret</a></nav>
<h1>Introduction</h1>
<p>A moving average smooths a sequence by replacing each sample with the mean of its neighbors.</p>
<a href="/background.html">Essential background I</a>
<a href="alphabeta.html">The \\( \\alpha -\\beta -\\gamma \\) filter</a>
<script>alert("no")</script>
`;

describe("site chapter text", () => {
  it("matches Greek titles written as LaTeX", () => {
    expect(sectionMatchKey("The α-β-γ filter")).toBe(
      sectionMatchKey("The \\( \\alpha -\\beta -\\gamma \\) filter"),
    );
  });

  it("finds the section link and keeps the paragraph", () => {
    const links = linksFromHtml(PAGE, "https://example.test/intro.html");
    expect(findSectionLink(links, "Essential background I")?.url).toBe(
      "https://example.test/background.html",
    );
    expect(findSectionLink(links, "The α-β-γ filter")?.url).toBe(
      "https://example.test/alphabeta.html",
    );
    const text = articleText(PAGE);
    expect(text).toContain("mean of its neighbors");
    expect(text).not.toContain("Secret");
    expect(text).not.toContain("alert");
  });

  it("keeps calculation and multi-select questions and drops flashcards", () => {
    const pack = reviewPackFromModelJson({
      flashcards: [{ id: "f", front: "Q", back: "A", passage: "A passage here.", locator: "s" }],
      questions: [
        {
          id: "n1",
          kind: "numeric",
          prompt: "What is the gain?",
          answer: "1/2",
          explanation: "The passage sets the gain to one half.",
          passage: "The gain is one half.",
          locator: "section",
        },
        {
          id: "n1",
          kind: "multi",
          prompt: "Select every noise source that applies.",
          choices: [
            { id: "a", text: "Thermal" },
            { id: "b", text: "None" },
            { id: "c", text: "Clock" },
          ],
          correctChoiceIds: ["a", "c"],
          explanation: "Thermal noise and clock error are both named.",
          passage: "Thermal noise and clock error.",
          locator: "section",
        },
      ],
    });
    expect(pack.flashcards).toEqual([]);
    expect(pack.questions.map((question) => question.kind)).toEqual(["numeric", "multi"]);
    expect(new Set(pack.questions.map((question) => question.id)).size).toBe(2);
  });

  it("explains an empty model pack instead of a schema failure", () => {
    expect(() =>
      reviewPackFromModelJson({
        flashcards: [],
        questions: [],
        note: "The supplied text contains only a chapter list.",
      }),
    ).toThrow(/chapter list/);
  });
});
