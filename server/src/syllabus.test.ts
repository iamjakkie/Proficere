import { describe, expect, it } from "vitest";
import { fetchLessonTitles } from "./syllabus.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

const COURSERA_COURSE = `<h1>Rust From Zero</h1>
  <h3>Ownership</h3>
  <h5>2 videos • Total 10 minutes</h5>
  <ul>
    <li>Moves and copies<span>4 min</span></li>
    <li>Borrowing</li>
  </ul>
  <h5>1 reading</h5>
  <ul><li>The book, chapter 4</li></ul>`;

describe("course syllabus", () => {
  it("loads Udemy lesson titles and keeps a section list when there are no lessons", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/courses/multithreading_parta/")) return json({ id: 2370762, title: "Part A" });
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
          { _class: "lecture", title: "Hello World" },
          { _class: "quiz", title: "Check" },
        ],
      });
    };

    const preview = await fetchLessonTitles("https://www.udemy.com/course/multithreading_parta/", fetchImpl);
    expect(preview.titles).toEqual(["Hello World", "Check", "A lecture"]);
    expect(preview.notes).toEqual(["3 items"]);
  });

  it("follows each Coursera course and checks the group counts", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("/specializations/rust")) {
        return html(`<a data-e2e="sdp-course-list-link" href="/learn/rust-from-zero?utm=1">Rust</a>
          <a data-e2e="sdp-course-list-link" href="https://www.coursera.org/learn/polars">Polars</a>`);
      }
      if (url.includes("/learn/polars")) {
        return html(`<h1>Polars</h1><h3>Frames</h3><h5>1 video</h5><ul><li>Lazy frames</li></ul>`);
      }
      return html(COURSERA_COURSE);
    };
    const preview = await fetchLessonTitles("https://www.coursera.org/specializations/rust", fetchImpl);
    expect(preview.titles).toEqual(["Moves and copies", "Borrowing", "The book, chapter 4", "Lazy frames"]);
    expect(preview.warnings).toEqual([]);
    expect(preview.notes).toEqual(["Rust From Zero: 3 items", "Polars: 1 items"]);
    expect(seen.some((url) => url.startsWith("https://www.coursera.org/learn/rust-from-zero"))).toBe(true);
  });

  it("reports a Coursera group that is short and rejects a page that is neither", async () => {
    const fetchImpl: typeof fetch = async () =>
      html(`<h1>Rust</h1><h3>Ownership</h3><h5>3 videos • Total 20 minutes</h5><ul><li>Moves</li></ul>`);
    const preview = await fetchLessonTitles("https://www.coursera.org/learn/rust", fetchImpl);
    expect(preview.titles).toEqual(["Moves"]);
    expect(preview.warnings[0]).toMatch(/expected 3, got 1/);
    const blocked: typeof fetch = async () => {
      throw new Error("should not fetch");
    };
    await expect(fetchLessonTitles("https://www.coursera.org/about", blocked)).rejects.toThrow(/not a course or specialization/);
  });

  it("loads MIT OpenCourseWare lecture topics and drops the PDF links", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      return html(`<main id="course-content-section"><table>
          <tr><td>1</td><td>The two-body problem (<a href="/lec_01/">PDF</a>)</td></tr>
          <tr><td>16</td><td>Non-singular &ldquo;Gauss-like&rdquo; method (<a href="/lec_16/">PDF</a>)</td></tr>
        </table></main>`);
    };
    const preview = await fetchLessonTitles(
      "https://ocw.mit.edu/courses/16-346-astrodynamics-fall-2008/pages/lecture-notes/",
      fetchImpl,
    );
    expect(preview.titles).toEqual(["1. The two-body problem", '16. Non-singular "Gauss-like" method']);
    expect(seen).toEqual(["https://ocw.mit.edu/courses/16-346-astrodynamics-fall-2008/pages/lecture-notes/"]);
  });

  it("reads Udacity lessons from the page data and Crash Course video titles", async () => {
    const udacity: typeof fetch = async () =>
      html(
        `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
          props: {
            pageProps: {
              staticProgramOutlineSectionProps: {
                parts: [
                  {
                    title: "Sensors",
                    lessons: [{ title: "Lidar" }, { title: "Project: fuse a track", isProjectLesson: true }],
                  },
                ],
              },
            },
          },
        })}</script>`,
      );
    const preview = await fetchLessonTitles(
      "https://www.udacity.com/course/sensor-fusion-engineer-nanodegree--nd313",
      udacity,
    );
    expect(preview.titles).toEqual(["Lidar", "Project: fuse a track"]);
    expect(preview.notes).toEqual(["Sensors: 2 items"]);

    const crash: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/page/2")) return html(`<h2 class="fl-post-title">Second video</h2>`);
      return html(
        `<h2 class="fl-post-title">First video</h2><a rel="next" href="https://thecrashcourse.com/topic/astronomy/page/2">Next</a>`,
      );
    };
    const videos = await fetchLessonTitles("https://thecrashcourse.com/topic/astronomy", crash);
    expect(videos.titles).toEqual(["First video", "Second video"]);
  });
});
