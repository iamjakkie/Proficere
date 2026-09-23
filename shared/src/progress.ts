import type { Chapter, ChapterStatus } from "./schemas.js";

export function statusFromPercent(percent: number): ChapterStatus {
  if (percent >= 100) return "completed";
  if (percent > 0) return "in_progress";
  return "not_started";
}

export function applyProgress(
  _chapter: Pick<Chapter, "progressPercent" | "status">,
  percent: number,
): { progressPercent: number; status: ChapterStatus } {
  const progressPercent = Math.max(0, Math.min(100, Math.round(percent)));
  return {
    progressPercent,
    status: statusFromPercent(progressPercent),
  };
}

export function planProgress(chapters: Pick<Chapter, "selected" | "status">[]): {
  selected: number;
  completedSelected: number;
} {
  const selectedChapters = chapters.filter((c) => c.selected);
  return {
    selected: selectedChapters.length,
    completedSelected: selectedChapters.filter((c) => c.status === "completed")
      .length,
  };
}

export function wholeBookProgress(
  chapters: Pick<Chapter, "status">[],
): { total: number; completed: number } {
  return {
    total: chapters.length,
    completed: chapters.filter((c) => c.status === "completed").length,
  };
}
