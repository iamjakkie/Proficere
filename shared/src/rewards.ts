import type { IslandState, RewardEvent } from "./schemas.js";

export const REWARD_UNLOCKS = {
  firstChapter: "cottage",
  chapter2: "trees",
  chapter3: "path",
  chapter4: "garden",
  review1: "lanterns",
  review2: "dock",
  milestone5: "lighthouse",
} as const;

export function chapterCompleteKey(chapterId: string): string {
  return `chapter_complete:${chapterId}`;
}

export function reviewCompleteKey(chapterId: string, ordinal: number): string {
  return `review_success:${chapterId}:${ordinal}`;
}

export function unlockForNewChapterCount(completedDistinctChapters: number): string | null {
  if (completedDistinctChapters === 1) return REWARD_UNLOCKS.firstChapter;
  if (completedDistinctChapters === 2) return REWARD_UNLOCKS.chapter2;
  if (completedDistinctChapters === 3) return REWARD_UNLOCKS.chapter3;
  if (completedDistinctChapters === 4) return REWARD_UNLOCKS.chapter4;
  if (completedDistinctChapters === 5) return REWARD_UNLOCKS.milestone5;
  return "grove";
}

export function unlockForReviewCount(successfulReviews: number): string | null {
  if (successfulReviews === 1) return REWARD_UNLOCKS.review1;
  if (successfulReviews === 2) return REWARD_UNLOCKS.review2;
  return "wildflowers";
}

export function reconstructIsland(
  events: Pick<RewardEvent, "unlock" | "rewardKey">[],
): IslandState {
  const unlocks = [...new Set(events.map((e) => e.unlock))];
  return {
    unlocks,
    rewardCount: events.length,
    completedChapters: events.filter((e) =>
      e.rewardKey.startsWith("chapter_complete:"),
    ).length,
    completedReviews: events.filter((e) =>
      e.rewardKey.startsWith("review_success:"),
    ).length,
  };
}
