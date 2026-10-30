import { AppError, lessonTitlesFromHtml } from "@progress-island/shared";
import { assertCourseUrl } from "./shelf-store.js";

const BLOCKED_HOST = /(^|\.)((udemy\.com)|(coursera\.org))$/i;

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
  if (BLOCKED_HOST.test(host)) {
    return "Udemy and Coursera do not share a lesson list with this app. Paste the lesson titles yourself.";
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
  if (BLOCKED_HOST.test(host)) {
    throw new AppError(
      "Udemy and Coursera do not share a lesson list with this app. Paste the lesson titles yourself.",
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
