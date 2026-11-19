import {
  readingPace,
  weekProgress,
  type ExamMark,
  type ReadingMark,
  type ReadingPace,
  type WeekProgress,
} from "@progress-island/shared";
import type { Db } from "./db.js";

function readingMark(at: string, payload: string | null): ReadingMark | null {
  if (!payload) return null;
  try {
    const body = JSON.parse(payload) as { bookId?: unknown; page?: unknown };
    if (typeof body.bookId !== "string" || typeof body.page !== "number") return null;
    return { at, bookId: body.bookId, page: body.page };
  } catch {
    return null;
  }
}

/** Furthest-page movement, the active books, and recent exam scores. */
export function homeCharts(db: Db, now = new Date()): { week: WeekProgress; pace: ReadingPace } {
  const titles = new Map(
    (db.prepare("SELECT id, title FROM books").all() as { id: string; title: string }[]).map((row) => [row.id, row.title]),
  );
  const readings = (
    db.prepare("SELECT created_at, payload FROM activity_log WHERE event = 'reading_progress'").all() as {
      created_at: string;
      payload: string | null;
    }[]
  ).flatMap((row) => {
    const mark = readingMark(row.created_at, row.payload);
    return mark ? [{ ...mark, title: titles.get(mark.bookId) }] : [];
  });
  const reviews = db.prepare("SELECT created_at, grade, passed FROM project_reviews").all() as {
    created_at: string;
    grade: string | null;
    passed: number | null;
  }[];
  const exams: ExamMark[] = reviews.map((row) => ({ at: row.created_at, passed: row.passed === 1 }));
  return {
    week: weekProgress(readings, exams, now),
    pace: readingPace(
      readings,
      reviews.map((row) => ({ at: row.created_at, grade: row.grade })),
      now,
    ),
  };
}
