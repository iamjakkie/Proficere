import { describe, expect, it } from "vitest";
import { fetchLessonTitles } from "./syllabus.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("course syllabus", () => {
  it("loads Udemy section titles and skips lectures", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("/courses/multithreading_parta/")) {
        return json({ id: 2370762, title: "Part A" });
      }
      if (url.includes("page=2")) {
        return json({
          next: null,
          results: [
            { _class: "lecture", title: "A lecture" },
            { _class: "chapter", title: "Semaphores" },
          ],
        });
      }
      return json({
        next: "https://www.udemy.com/api-2.0/courses/2370762/public-curriculum-items/?page=2",
        results: [
          { _class: "chapter", title: "Getting Started" },
          { _class: "lecture", title: "Hello World", asset: { title: "hello.mp4" } },
        ],
      });
    };

    const titles = await fetchLessonTitles("https://www.udemy.com/course/multithreading_parta/", fetchImpl);
    expect(titles).toEqual(["Getting Started", "Semaphores"]);
    expect(seen.some((url) => url.includes("/courses/2370762/public-curriculum-items/"))).toBe(true);
    expect(seen.some((url) => url.includes("page=2"))).toBe(true);
  });

  it("loads Coursera specialization courses in published order", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("q=slug")) return json({ elements: [{ id: "specId_ok", description: "ignore" }] });
      if (url.includes("/onDemandSpecializations.v1/specId_ok")) {
        return json({ elements: [{ courseIds: ["courseB___", "courseA___"] }] });
      }
      return json({
        elements: [
          { id: "courseA___", name: "Polars from Zero", description: "not a lesson" },
          { id: "courseB___", name: "Rust From Zero" },
        ],
      });
    };
    const titles = await fetchLessonTitles("https://www.coursera.org/specializations/rust", fetchImpl);
    expect(titles).toEqual(["Rust From Zero", "Polars from Zero"]);
  });

  it("loads Coursera course modules and ignores a page that is neither", async () => {
    const fetchImpl: typeof fetch = async () =>
      json({
        elements: [{ id: "material" }],
        linked: { "onDemandCourseMaterialModules.v1": [{ name: "Ownership" }, { name: "Capstone Project" }] },
      });
    const titles = await fetchLessonTitles("https://www.coursera.org/learn/rust", fetchImpl);
    expect(titles).toEqual(["Ownership", "Capstone Project"]);
    const blocked: typeof fetch = async () => {
      throw new Error("should not fetch");
    };
    await expect(fetchLessonTitles("https://www.coursera.org/about", blocked)).rejects.toThrow(/not a course or specialization/);
  });

  it("loads MIT OpenCourseWare lecture topics and drops the PDF links", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      return new Response(
        `<main id="course-content-section"><table>
          <tr><td>1</td><td>The two-body problem (<a href="/lec_01/">PDF</a>)</td></tr>
          <tr><td>16</td><td>Non-singular &ldquo;Gauss-like&rdquo; method (<a href="/lec_16/">PDF</a>)</td></tr>
        </table></main>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    };
    const titles = await fetchLessonTitles(
      "https://ocw.mit.edu/courses/16-346-astrodynamics-fall-2008/pages/lecture-notes/",
      fetchImpl,
    );
    expect(titles).toEqual(["1. The two-body problem", '16. Non-singular "Gauss-like" method']);
    expect(seen).toEqual(["https://ocw.mit.edu/courses/16-346-astrodynamics-fall-2008/pages/lecture-notes/"]);
  });
});
