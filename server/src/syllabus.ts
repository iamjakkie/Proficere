import {
  AppError,
  type SyllabusItems,
  courseraCourseLinks,
  courseraSyllabus,
  courseraTarget,
  crashCourseTitles,
  crashCourseTopicUrl,
  lessonTitlesFromHtml,
  ocwLectureNotesUrl,
  ocwLectureTitles,
  udacityCourseUrl,
  udacityLessonTitles,
  udemyCourseSlug,
  udemyItemTitles,
  udemySectionTitles,
} from "@progress-island/shared";
import { assertCourseUrl } from "./shelf-store.js";

const UDEMY_PAGE_CAP = 20;
const COURSE_CAP = 40;
/** A browser agent. Course sites put the full syllabus in the HTML they return to one. */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export function syllabusBlockReason(status: number, finalUrl: string, html: string): string | null {
  if (status === 401 || status === 403) {
    return "That page refused the request. It may require a login. Paste the lesson titles instead.";
  }
  if (status >= 400) return `That page returned ${status}. Paste the lesson titles instead.`;
  let host = "";
  try {
    host = new URL(finalUrl).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  if (host === "coursera.org") {
    return "That Coursera page did not include a public course list. Paste the lesson titles instead.";
  }
  if (/login|signin|sign-in|accounts\.google/i.test(finalUrl)) {
    return "That page redirected to a login. Paste the lesson titles instead.";
  }
  if (!html.trim()) return "That page was empty. Paste the lesson titles instead.";
  return null;
}

/** Fetch a public page and return the lesson titles that are actually on it. */
export async function fetchLessonTitles(url: string, fetchImpl: typeof fetch = fetch): Promise<SyllabusItems> {
  assertCourseUrl(url);
  const host = new URL(url).hostname.replace(/^www\./, "");
  const slug = udemyCourseSlug(url);
  if (slug) return fetchUdemyItems(slug, fetchImpl);
  const coursera = courseraTarget(url);
  if (coursera) return fetchCoursera(url, coursera.kind, fetchImpl);
  const notes = ocwLectureNotesUrl(url);
  if (notes) return fetchOcwLectures(notes, fetchImpl);
  const udacity = udacityCourseUrl(url);
  if (udacity) return fetchUdacity(udacity, fetchImpl);
  const crash = crashCourseTopicUrl(url);
  if (crash) return fetchCrashCourse(crash, fetchImpl);
  if (host === "coursera.org") {
    throw new AppError(
      "That Coursera link is not a course or specialization. Paste the lesson titles instead.",
      "syllabus_blocked",
      400,
    );
  }
  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": BROWSER_UA,
      },
    });
  } catch {
    throw new AppError(
      "Could not fetch that page. It may be offline, blocked, or require a login. Paste the lesson titles instead.",
      "syllabus_blocked",
      400,
    );
  }
  const html = await response.text();
  const blocked = syllabusBlockReason(response.status, response.url || url, html);
  if (blocked) throw new AppError(blocked, "syllabus_blocked", 400);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
    throw new AppError(
      "That URL is not an HTML page with a heading list. Paste the lesson titles instead.",
      "syllabus_blocked",
      400,
    );
  }
  const parsed = lessonTitlesFromHtml(html);
  if (parsed.reason) throw new AppError(parsed.reason, "syllabus_empty", 400);
  return { titles: parsed.titles, warnings: [], notes: [] };
}

/** Lecture titles from an MIT OpenCourseWare notes page. The PDF files stay on OCW. */
async function fetchOcwLectures(notesUrl: string, fetchImpl: typeof fetch): Promise<SyllabusItems> {
  let response: Response;
  try {
    response = await fetchImpl(notesUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": BROWSER_UA,
      },
    });
  } catch {
    throw new AppError(
      "Could not read that MIT OpenCourseWare lecture list. Paste the lesson titles instead.",
      "syllabus_blocked",
      400,
    );
  }
  if (!response.ok) {
    throw new AppError(
      "MIT OpenCourseWare did not share a lecture list for that course. Paste the lesson titles instead.",
      "syllabus_empty",
      400,
    );
  }
  const html = await response.text();
  const titles = ocwLectureTitles(html);
  if (!titles.length) {
    throw new AppError(
      "MIT OpenCourseWare did not share a lecture list for that course. Paste the lesson titles instead.",
      "syllabus_empty",
      400,
    );
  }
  return { titles, warnings: [], notes: [] };
}

/** Public lesson, quiz, and practice titles for a Udemy course. Media stays on Udemy. */
async function fetchUdemyItems(slug: string, fetchImpl: typeof fetch): Promise<SyllabusItems> {
  const lookup = new URL(`https://www.udemy.com/api-2.0/courses/${encodeURIComponent(slug)}/`);
  lookup.searchParams.set("fields[course]", "id,title");
  const course = await readUdemyJson(lookup, fetchImpl);
  const id = Number((course as { id?: unknown }).id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(
      "That Udemy link did not match a public course. Paste the section titles instead.",
      "syllabus_empty",
      400,
    );
  }
  const pages: unknown[] = [];
  for (let page = 1; page <= UDEMY_PAGE_CAP; page += 1) {
    const curriculum = new URL(`https://www.udemy.com/api-2.0/courses/${id}/public-curriculum-items/`);
    curriculum.searchParams.set("page", String(page));
    curriculum.searchParams.set("page_size", "100");
    const body = await readUdemyJson(curriculum, fetchImpl);
    pages.push(body);
    const titles = udemyItemTitles(pages);
    const next = (body as { next?: unknown }).next;
    if (titles.length >= 2000 || !next) return itemsOrSections(pages, titles);
  }
  return itemsOrSections(pages, udemyItemTitles(pages));
}

function itemsOrSections(pages: unknown[], titles: string[]): SyllabusItems {
  if (titles.length) return { titles, warnings: [], notes: [`${titles.length} items`] };
  const sections = udemySectionTitles(pages);
  if (!sections.length) missingSections();
  return { titles: sections, warnings: [], notes: [`${sections.length} sections`] };
}

function missingSections(): never {
  throw new AppError(
    "Udemy did not share a section list for that course. Paste the section titles instead.",
    "syllabus_empty",
    400,
  );
}

async function readUdemyJson(url: URL, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: "application/json",
        "User-Agent": "ProgressIsland/0.1 (local syllabus preview)",
      },
    });
  } catch {
    throw new AppError(
      "Could not read that Udemy course's public section list. Paste the section titles instead.",
      "syllabus_blocked",
      400,
    );
  }
  if (response.status === 404) {
    throw new AppError(
      "That Udemy link did not match a public course. Paste the section titles instead.",
      "syllabus_empty",
      400,
    );
  }
  if (!response.ok) {
    throw new AppError(
      "Udemy refused the section list. Paste the section titles instead.",
      "syllabus_blocked",
      400,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new AppError(
      "Udemy did not return a section list. Paste the section titles instead.",
      "syllabus_empty",
      400,
    );
  }
}

/**
 * Every Coursera item. A program page only lists courses, so each course page is opened in order.
 * Videos and files stay on Coursera. A group whose count does not match is reported, not filled in.
 */
async function fetchCoursera(
  url: string,
  kind: "specialization" | "course",
  fetchImpl: typeof fetch,
): Promise<SyllabusItems> {
  const html = await readHtml(url, fetchImpl, "Coursera");
  if (kind === "course") {
    const parsed = courseraSyllabus(html);
    if (!parsed.titles.length) missingCoursera("course");
    return { titles: parsed.titles, warnings: parsed.warnings, notes: parsed.notes };
  }
  const links = courseraCourseLinks(html);
  if (!links.length) {
    throw new AppError(
      "No course links found on this Coursera page. Paste the lesson titles instead.",
      "syllabus_empty",
      400,
    );
  }
  const titles: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  if (links.length > COURSE_CAP) notes.push(`Stopped after ${COURSE_CAP} courses.`);
  for (const [index, link] of links.slice(0, COURSE_CAP).entries()) {
    if (index > 0) await pause(200);
    const page = await readHtml(link, fetchImpl, "Coursera");
    const parsed = courseraSyllabus(page);
    titles.push(...parsed.titles);
    warnings.push(...parsed.warnings);
    notes.push(...parsed.notes);
    if (titles.length >= 2000) {
      notes.push("Stopped after 2000 lessons.");
      break;
    }
  }
  if (!titles.length) missingCoursera("specialization");
  return { titles: titles.slice(0, 2000), warnings, notes };
}

async function fetchUdacity(url: string, fetchImpl: typeof fetch): Promise<SyllabusItems> {
  const html = await readHtml(url, fetchImpl, "Udacity");
  const parsed = udacityLessonTitles(html);
  if (!parsed.titles.length) {
    throw new AppError(
      parsed.warnings[0] ?? "Udacity did not share a lesson list. Paste the lesson titles instead.",
      "syllabus_empty",
      400,
    );
  }
  return parsed;
}

async function fetchCrashCourse(url: string, fetchImpl: typeof fetch): Promise<SyllabusItems> {
  const titles: string[] = [];
  const seen = new Set<string>();
  let page: string | null = url;
  while (page && !seen.has(page) && seen.size < 8 && titles.length < 2000) {
    seen.add(page);
    const html = await readHtml(page, fetchImpl, "Crash Course");
    const parsed = crashCourseTitles(html);
    titles.push(...parsed.titles);
    if (!parsed.next) break;
    try {
      page = new URL(parsed.next, page).href;
    } catch {
      break;
    }
  }
  if (!titles.length) {
    throw new AppError(
      "No videos found on that Crash Course page. Paste the lesson titles instead.",
      "syllabus_empty",
      400,
    );
  }
  return { titles: titles.slice(0, 2000), warnings: [], notes: [`${Math.min(titles.length, 2000)} videos`] };
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readHtml(url: string, fetchImpl: typeof fetch, site: string): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": BROWSER_UA,
      },
    });
  } catch {
    throw new AppError(`Could not read that ${site} page. Paste the lesson titles instead.`, "syllabus_blocked", 400);
  }
  if (!response.ok) {
    throw new AppError(
      `${site} did not share a lesson list for that link. Paste the lesson titles instead.`,
      "syllabus_empty",
      400,
    );
  }
  return response.text();
}

function missingCoursera(kind: "specialization" | "course"): never {
  throw new AppError(
    kind === "specialization"
      ? "Coursera did not share a lesson list for that specialization. Paste the lesson titles instead."
      : "Coursera did not share a lesson list for that course. Paste the lesson titles instead.",
    "syllabus_empty",
    400,
  );
}
