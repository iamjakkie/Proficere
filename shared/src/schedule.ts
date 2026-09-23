/** Transparent review schedule: 1, 3, 7, 14 days after successive successful reviews. */
export const SUCCESS_INTERVALS_DAYS = [1, 3, 7, 14] as const;
export const WEAK_RETRY_DAYS = 1;

export function nextReviewDate(options: {
  successfulReviewCount: number;
  weak: boolean;
  from?: Date;
}): Date {
  const from = options.from ?? new Date();
  const days = options.weak
    ? WEAK_RETRY_DAYS
    : SUCCESS_INTERVALS_DAYS[
        Math.min(options.successfulReviewCount, SUCCESS_INTERVALS_DAYS.length - 1)
      ];
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function isDue(nextReviewAt: string, now = new Date()): boolean {
  return new Date(nextReviewAt).getTime() <= now.getTime();
}

export function isWeakQuiz(correctCount: number, total: number): boolean {
  if (total <= 0) return true;
  return correctCount / total < 2 / 3;
}
