export type ReadingMark = { at: string; bookId: string; page: number };
export type ExamMark = { at: string; passed: boolean };

export type WeekDay = { date: string; pages: number };

export type WeekProgress = {
  days: WeekDay[];
  pages: number;
  activeDays: number;
  exams: number;
  passed: number;
};

export type PaceBook = { title: string; gained: number; points: number[] };
export type PaceDay = { date: string; active: boolean };
export type ExamScore = { date: string; score: number; total: number };

export type ReadingPace = {
  books: PaceBook[];
  days: PaceDay[];
  activeDays: number;
  scores: ExamScore[];
};

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDay(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Seven UTC days ending today. Pages are how far each book moved, not every revisit. */
export function weekProgress(readings: ReadingMark[], exams: ExamMark[], now = new Date()): WeekProgress {
  const days: WeekDay[] = Array.from({ length: 7 }, (_, index) => ({
    date: dayKey(shiftDay(now, index - 6)),
    pages: 0,
  }));
  const inWeek = new Set(days.map((day) => day.date));
  const byBook = new Map<string, ReadingMark[]>();
  for (const mark of readings) {
    if (!mark.bookId || !Number.isInteger(mark.page) || mark.page < 1) continue;
    const list = byBook.get(mark.bookId) ?? [];
    list.push(mark);
    byBook.set(mark.bookId, list);
  }
  for (const marks of byBook.values()) {
    marks.sort((a, b) => a.at.localeCompare(b.at));
    let furthest = 0;
    for (const mark of marks) {
      if (mark.page <= furthest) continue;
      const gained = mark.page - furthest;
      furthest = mark.page;
      const date = mark.at.slice(0, 10);
      const day = days.find((item) => item.date === date);
      if (day && inWeek.has(date)) day.pages += gained;
    }
  }
  const examDays = new Set<string>();
  let examCount = 0;
  let passed = 0;
  for (const exam of exams) {
    const date = exam.at.slice(0, 10);
    if (!inWeek.has(date)) continue;
    examCount += 1;
    if (exam.passed) passed += 1;
    examDays.add(date);
  }
  const activeDays = days.filter((day) => day.pages > 0 || examDays.has(day.date)).length;
  return {
    days,
    pages: days.reduce((sum, day) => sum + day.pages, 0),
    activeDays,
    exams: examCount,
    passed,
  };
}

const MONTH_DAYS = 28;

/** Four weeks of page gains for the books that moved, plus which days were active. */
export function readingPace(
  readings: (ReadingMark & { title?: string })[],
  exams: { at: string; grade: string | null }[],
  now = new Date(),
): ReadingPace {
  const days: PaceDay[] = Array.from({ length: MONTH_DAYS }, (_, index) => ({
    date: dayKey(shiftDay(now, index - (MONTH_DAYS - 1))),
    active: false,
  }));
  const indexOf = new Map(days.map((day, index) => [day.date, index]));
  const byBook = new Map<string, { title: string; marks: ReadingMark[] }>();
  for (const mark of readings) {
    if (!mark.bookId || !Number.isInteger(mark.page) || mark.page < 1) continue;
    const entry = byBook.get(mark.bookId) ?? { title: mark.title?.trim() || "Book", marks: [] };
    entry.marks.push(mark);
    byBook.set(mark.bookId, entry);
  }
  const books: PaceBook[] = [];
  for (const entry of byBook.values()) {
    entry.marks.sort((a, b) => a.at.localeCompare(b.at));
    let furthest = 0;
    let baseline = 0;
    const points = Array.from({ length: MONTH_DAYS }, () => 0);
    let seen = false;
    for (const mark of entry.marks) {
      if (mark.page <= furthest) continue;
      furthest = mark.page;
      const index = indexOf.get(mark.at.slice(0, 10));
      if (index == null) {
        baseline = furthest;
        continue;
      }
      points[index] = furthest;
      seen = true;
    }
    if (!seen) continue;
    let level = baseline;
    for (let index = 0; index < points.length; index += 1) {
      const next = points[index] > level ? points[index] : level;
      if (next > level) days[index].active = true;
      level = next;
      points[index] = level;
    }
    const gained = points[points.length - 1] - baseline;
    if (gained <= 0) continue;
    books.push({ title: entry.title, gained, points });
  }
  books.sort((a, b) => b.gained - a.gained || a.title.localeCompare(b.title));
  const scores = exams.flatMap((exam) => {
    const parsed = exam.grade?.match(/^(\d+)\/(\d+)$/);
    if (!parsed) return [];
    return [{ date: exam.at.slice(0, 10), score: Number(parsed[1]), total: Number(parsed[2]) }];
  });
  scores.sort((a, b) => a.date.localeCompare(b.date));
  for (const score of scores) {
    const day = days.find((item) => item.date === score.date);
    if (day) day.active = true;
  }
  return {
    books: books.slice(0, 3),
    days,
    activeDays: days.filter((day) => day.active).length,
    scores: scores.slice(-8),
  };
}
