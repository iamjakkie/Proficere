import { z } from "zod";
import { BookCategorySchema } from "./categories.js";

export const provenanceTypes = [
  "retrieved",
  "uploaded",
  "pasted",
  "manual",
] as const;

export const ProvenanceTypeSchema = z.enum(provenanceTypes);
export type ProvenanceType = z.infer<typeof ProvenanceTypeSchema>;

export const chapterStatuses = [
  "not_started",
  "in_progress",
  "completed",
] as const;

export const ChapterStatusSchema = z.enum(chapterStatuses);
export type ChapterStatus = z.infer<typeof ChapterStatusSchema>;

export const BookSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  author: z.string().nullable(),
  edition: z.string().nullable(),
  isbn: z.string().nullable(),
  identifiers: z.record(z.string()).default({}),
  catalogUrl: z.string().nullable(),
  contentsAvailable: z.boolean(),
  libraryFilename: z.string().nullable(),
  sortOrder: z.number().int().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Book = z.infer<typeof BookSchema>;

export const SourceDocumentSchema = z.object({
  id: z.string().uuid(),
  bookId: z.string().uuid(),
  provenanceType: ProvenanceTypeSchema,
  provenanceLabel: z.string(),
  url: z.string().nullable(),
  filename: z.string().nullable(),
  pageLocator: z.string().nullable(),
  editionNote: z.string().nullable(),
  text: z.string(),
  textHash: z.string(),
  extractionVersion: z.string(),
  aiConsentAt: z.string().nullable(),
  createdAt: z.string(),
});
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;

export const OutlineChapterSchema = z.object({
  number: z.string().nullable(),
  title: z.string().min(1),
  parentNumber: z.string().nullable().optional(),
  pageStart: z.string().nullable().optional(),
  pageEnd: z.string().nullable().optional(),
  pdfPageStart: z.number().int().nullable().optional(),
  pdfPageEnd: z.number().int().nullable().optional(),
  sourceSpanStart: z.number().int().nullable().optional(),
  sourceSpanEnd: z.number().int().nullable().optional(),
  /** Set by a merge preview so a renamed chapter keeps its history. */
  existingId: z.string().uuid().optional(),
});
export type OutlineChapter = z.infer<typeof OutlineChapterSchema>;

export const ChapterSchema = z.object({
  id: z.string().uuid(),
  bookId: z.string().uuid(),
  sourceDocumentId: z.string().uuid().nullable(),
  parentId: z.string().uuid().nullable(),
  number: z.string().nullable(),
  title: z.string(),
  outlinePosition: z.number().int(),
  pageStart: z.string().nullable(),
  pageEnd: z.string().nullable(),
  pdfPageStart: z.number().int().nullable(),
  pdfPageEnd: z.number().int().nullable(),
  sourceSpanStart: z.number().int().nullable(),
  sourceSpanEnd: z.number().int().nullable(),
  selected: z.boolean(),
  printed: z.boolean(),
  progressPercent: z.number().min(0).max(100),
  status: ChapterStatusSchema,
  note: z.string().nullable(),
  pagePosition: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const ProgressEventSchema = z.object({
  id: z.string().uuid(),
  chapterId: z.string().uuid(),
  oldState: z.record(z.unknown()),
  newState: z.record(z.unknown()),
  note: z.string().nullable(),
  createdAt: z.string(),
  undoneAt: z.string().nullable(),
});
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;

export const FlashcardSchema = z.object({
  id: z.string(),
  front: z.string().min(1),
  back: z.string().min(1),
  passage: z.string().min(1),
  locator: z.string().min(1),
  rejected: z.boolean().optional(),
  reportNote: z.string().nullable().optional(),
});
export type Flashcard = z.infer<typeof FlashcardSchema>;

export const QuizChoiceSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
});

export const QuizQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string().min(1),
  choices: z.array(QuizChoiceSchema).min(2).max(6),
  correctChoiceId: z.string(),
  explanation: z.string().min(1),
  passage: z.string().min(1),
  locator: z.string().min(1),
  rejected: z.boolean().optional(),
  reportNote: z.string().nullable().optional(),
});
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const ModelReviewPackSchema = z.object({
  flashcards: z.array(FlashcardSchema).min(1).max(8),
  questions: z.array(QuizQuestionSchema).min(1).max(6),
});
export type ModelReviewPack = z.infer<typeof ModelReviewPackSchema>;

export const ReviewPackSchema = z.object({
  id: z.string().uuid(),
  chapterId: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
  sourceHash: z.string(),
  stale: z.boolean(),
  flashcards: z.array(FlashcardSchema),
  questions: z.array(QuizQuestionSchema),
  createdAt: z.string(),
});
export type ReviewPack = z.infer<typeof ReviewPackSchema>;

export const ReviewAttemptSchema = z.object({
  id: z.string().uuid(),
  packId: z.string().uuid(),
  chapterId: z.string().uuid(),
  answers: z.record(z.string()),
  correctCount: z.number().int(),
  total: z.number().int(),
  weak: z.boolean(),
  nextReviewAt: z.string(),
  createdAt: z.string(),
});
export type ReviewAttempt = z.infer<typeof ReviewAttemptSchema>;

export const RewardEventSchema = z.object({
  id: z.string().uuid(),
  rewardKey: z.string(),
  kind: z.string(),
  unlock: z.string(),
  createdAt: z.string(),
});
export type RewardEvent = z.infer<typeof RewardEventSchema>;

export const IslandStateSchema = z.object({
  unlocks: z.array(z.string()),
  rewardCount: z.number().int(),
  completedChapters: z.number().int(),
  completedReviews: z.number().int(),
});
export type IslandState = z.infer<typeof IslandStateSchema>;

export const IslandTreeSchema = z.object({
  bookId: z.string().uuid(),
  title: z.string(),
  author: z.string().nullable(),
  coverUrl: z.string().nullable(),
  growth: z.number().min(0).max(1),
  /** Crown layers. One at the start, eight when the book is finished. */
  trunkBlocks: z.number().int().min(1).max(8),
  /** From identifiers.treeGroup when a grouping exists. Otherwise the default type. */
  treeType: z.string(),
  /** identifiers.category. Null until the book is assigned to a plate. */
  category: z.string().nullable(),
  hasPdf: z.boolean(),
  readPdfPage: z.number().int().nullable(),
  pdfPageCount: z.number().int().nullable(),
  lastPdfPage: z.number().int().nullable(),
});
export type IslandTree = z.infer<typeof IslandTreeSchema>;

export const BookSearchHitSchema = z.object({
  catalogId: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  edition: z.string().nullable(),
  isbn: z.string().nullable(),
  year: z.string().nullable(),
  catalogUrl: z.string().nullable(),
  contentsAvailable: z.boolean(),
  contentsPreview: z.array(OutlineChapterSchema).optional(),
});
export type BookSearchHit = z.infer<typeof BookSearchHitSchema>;

export const AiStatusSchema = z.object({
  configured: z.boolean(),
  hasKey: z.boolean(),
  model: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type AiStatus = z.infer<typeof AiStatusSchema>;

export const DashboardSchema = z.object({
  nextChapter: ChapterSchema.nullable(),
  dueReviews: z.array(
    z.object({
      chapter: ChapterSchema,
      nextReviewAt: z.string(),
      packId: z.string().uuid().nullable(),
    }),
  ),
  island: IslandStateSchema,
  trees: z.array(IslandTreeSchema),
  categories: z.array(BookCategorySchema),
  nextBookTitle: z.string().nullable(),
  planProgress: z.object({
    selected: z.number().int(),
    completedSelected: z.number().int(),
  }),
  ai: AiStatusSchema,
});
export type Dashboard = z.infer<typeof DashboardSchema>;
