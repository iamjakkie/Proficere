import {
  AppError,
  courseraCourseTitles,
  courseraModuleTitles,
  courseraTarget,
  lessonTitlesFromHtml,
  ocwLectureNotesUrl,
  ocwLectureTitles,
  udemyCourseSlug,
  udemySectionTitles,
} from "@progress-island/shared";
import { assertCourseUrl } from "./shelf-store.js";

const UDEMY_PAGE_CAP = 6;

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

/** Fetch a public page and return only headings that are actually in the HTML. */
export async function fetchLessonTitles(url: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  assertCourseUrl(url);
  const host = new URL(url).hostname.replace(/^www\./, "");
  const slug = udemyCourseSlug(url);
  if (slug) return fetchUdemySections(slug, fetchImpl);
  const coursera = courseraTarget(url);
  if (coursera?.kind === "specialization") return fetchCourseraSpecialization(coursera.slug, fetchImpl);
  if (coursera?.kind === "course") return fetchCourseraModules(coursera.slug, fetchImpl);
  const notes = ocwLectureNotesUrl(url);
  if (notes) return fetchOcwLectures(notes, fetchImpl);
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
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "ProgressIsland/0.1 (local syllabus preview)",
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
  return parsed.titles;
}

/** Lecture titles from an MIT OpenCourseWare notes page. The PDF files stay on OCW. */
async function fetchOcwLectures(notesUrl: string, fetchImpl: typeof fetch): Promise<string[]> {
  let response: Response;
  try {
    response = await fetchImpl(notesUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "ProgressIsland/0.1 (local syllabus preview)",
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
  return titles;
}

/** Public section titles for a Udemy course. Lectures, practice items, and media stay on Udemy. */
async function fetchUdemySections(slug: string, fetchImpl: typeof fetch): Promise<string[]> {
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
    const titles = udemySectionTitles(pages);
    const next = (body as { next?: unknown }).next;
    if (titles.length >= 80 || !next) return titles.length ? titles : missingSections();
  }
  const titles = udemySectionTitles(pages);
  if (!titles.length) missingSections();
  return titles;
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

/** Course titles in a Coursera specialization. Lecture video stays on Coursera. */
async function fetchCourseraSpecialization(slug: string, fetchImpl: typeof fetch): Promise<string[]> {
  const lookup = new URL("https://www.coursera.org/api/onDemandSpecializations.v1");
  lookup.searchParams.set("q", "slug");
  lookup.searchParams.set("slug", slug);
  lookup.searchParams.set("fields", "id");
  const found = await readCourseraJson(lookup, fetchImpl);
  const id = courseraId((found as { elements?: { id?: unknown }[] }).elements?.[0]?.id);
  if (!id) missingCoursera("specialization");
  const detail = new URL(`https://www.coursera.org/api/onDemandSpecializations.v1/${id}`);
  detail.searchParams.set("fields", "courseIds");
  const body = await readCourseraJson(detail, fetchImpl);
  const ids = ((body as { elements?: { courseIds?: unknown }[] }).elements?.[0]?.courseIds ?? [])
    .map(courseraId)
    .filter((value): value is string => value != null)
    .slice(0, 80);
  if (!ids.length) missingCoursera("specialization");
  const names = new URL("https://www.coursera.org/api/courses.v1");
  names.searchParams.set("ids", ids.join(","));
  names.searchParams.set("fields", "id,name");
  const listed = await readCourseraJson(names, fetchImpl);
  const titles = courseraCourseTitles(ids, (listed as { elements?: unknown[] }).elements ?? []);
  if (!titles.length) missingCoursera("specialization");
  return titles;
}

/** Module titles for one Coursera course. */
async function fetchCourseraModules(slug: string, fetchImpl: typeof fetch): Promise<string[]> {
  const materials = new URL("https://www.coursera.org/api/onDemandCourseMaterials.v2/");
  materials.searchParams.set("q", "slug");
  materials.searchParams.set("slug", slug);
  materials.searchParams.set("includes", "modules");
  materials.searchParams.set("fields", "onDemandCourseMaterialModules.v1(name)");
  const body = await readCourseraJson(materials, fetchImpl);
  const modules =
    (body as { linked?: { "onDemandCourseMaterialModules.v1"?: unknown[] } }).linked?.[
      "onDemandCourseMaterialModules.v1"
    ] ?? [];
  const titles = courseraModuleTitles(modules);
  if (!titles.length) missingCoursera("course");
  return titles;
}

function courseraId(value: unknown): string | null {
  const id = String(value ?? "");
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
}

function missingCoursera(kind: "specialization" | "course"): never {
  throw new AppError(
    kind === "specialization"
      ? "Coursera did not share a course list for that specialization. Paste the lesson titles instead."
      : "Coursera did not share a module list for that course. Paste the lesson titles instead.",
    "syllabus_empty",
    400,
  );
}

async function readCourseraJson(url: URL, fetchImpl: typeof fetch): Promise<unknown> {
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
      "Could not read that Coursera page's public list. Paste the lesson titles instead.",
      "syllabus_blocked",
      400,
    );
  }
  if (response.status === 404) {
    throw new AppError(
      "Coursera did not share a public list for that link. Paste the lesson titles instead.",
      "syllabus_empty",
      400,
    );
  }
  if (!response.ok) {
    throw new AppError(
      "Coursera refused the public list. Paste the lesson titles instead.",
      "syllabus_blocked",
      400,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new AppError(
      "Coursera did not return a public list. Paste the lesson titles instead.",
      "syllabus_empty",
      400,
    );
  }
}
