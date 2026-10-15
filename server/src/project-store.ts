import crypto from "node:crypto";
import { v4 as uuid } from "uuid";
import {
  AppError,
  applyGrounding,
  hasProse,
  preserveExamKey,
  redactProposal,
  runObjectiveCheck,
  validateVerificationPlan,
  type CriterionCheck,
  type ProjectCriterion,
  type ProjectProposal,
  type ProjectSourceRef,
  type SourceCorpus,
} from "@progress-island/shared";
import type { Db } from "./db.js";
import { topicsFromText, type SectionTopic } from "./site-chapter.js";
import {
  chapterText,
  getBook,
  getChapter,
  hashText,
  listBooksForLibrary,
  listChapters,
  nowIso,
} from "./store.js";

type AssessmentMode = "objective" | "ai_reviewed";

export type ProjectRecord = {
  id: string;
  batchId: string | null;
  proposalId: string;
  status: string;
  brief: ProjectProposal;
  dismissReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectVersionRecord = {
  id: string;
  projectId: string;
  versionNumber: number;
  brief: ProjectProposal;
  plan: ReturnType<typeof validateVerificationPlan>;
  sourceSnapshot: ProjectSourceRef[];
  assessmentMode: AssessmentMode;
  createdAt: string;
};

export type SubmissionRecord = {
  id: string;
  projectId: string;
  versionId: string;
  submissionNumber: number;
  artifacts: SubmissionArtifacts;
  createdAt: string;
};

export type SubmissionArtifacts = {
  explanation: string;
  assumptions: string;
  deliverable: string;
  prediction: string | null;
};

export type ReviewRecord = {
  id: string;
  submissionId: string;
  versionId: string;
  objective: CriterionCheck[];
  reasoning: unknown;
  questions: { id: string; prompt: string }[];
  answers: Record<string, string> | null;
  answerReview: unknown;
  label: string;
  nextAction: string | null;
  operational: { message: string } | null;
  grade: string | null;
  passed: boolean | null;
  notes: { line: number; text: string }[] | null;
  createdAt: string;
};

export type ProjectView = ProjectRecord & { grade: string | null; passed: boolean | null };

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapProject(row: Record<string, unknown>): ProjectRecord {
  return {
    id: String(row.id),
    batchId: (row.batch_id as string) ?? null,
    proposalId: String(row.proposal_id),
    status: String(row.status),
    brief: parseJson(String(row.brief_json), {} as ProjectProposal),
    dismissReason: (row.dismiss_reason as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function projectOptions(db: Db) {
  return listBooksForLibrary(db).map((book) => ({
    id: book.id,
    title: book.title,
    chapters: listChapters(db, book.id).map((chapter) => {
      const text = chapterText(db, chapter) ?? "";
      const prose = hasProse(text);
      return {
        id: chapter.id,
        title: chapter.title,
        status: chapter.status,
        progressPercent: chapter.progressPercent,
        hasProse: prose,
        locator: chapter.pdfPageStart != null ? `PDF page ${chapter.pdfPageStart}` : chapter.title,
      };
    }),
  }));
}

export function corpusForChapters(db: Db, chapterIds: string[]): SourceCorpus[] {
  return chapterIds.map((chapterId) => {
    const chapter = getChapter(db, chapterId);
    const book = getBook(db, chapter.bookId);
    const text = chapterText(db, chapter) ?? "";
    return {
      bookId: book.id,
      bookTitle: book.title,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      locator: chapter.pdfPageStart != null ? `PDF page ${chapter.pdfPageStart}` : chapter.title,
      sourceHash: hashText(text),
      text,
      hasProse: hasProse(text),
    };
  });
}

export function suggestionContextHash(input: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function buildSuggestionContext(db: Db, input: {
  chapterIds: string[];
  goal: string;
  hours: number | null;
  output: string;
  tools: string;
  instruction: string;
  topics?: Record<string, SectionTopic[]>;
}) {
  const corpus = corpusForChapters(db, input.chapterIds);
  const topicsFor = (chapterId: string, text: string) =>
    input.topics?.[chapterId] ?? topicsFromText(text);
  const projects = listProjects(db).slice(0, 8).map((project) => {
    const latest = latestReviewForProject(db, project.id);
    return {
      id: project.id,
      title: project.brief.title,
      status: project.status,
      label: latest?.label ?? null,
      dismissReason: project.dismissReason,
    };
  });
  const dismissals = listDismissals(db).slice(0, 12);
  const hash = suggestionContextHash({
    chapters: corpus.map((item) => ({
      id: item.chapterId,
      status: chapterStatus(db, item.chapterId),
      progress: chapterProgress(db, item.chapterId),
      sourceHash: item.sourceHash,
      hasProse: item.hasProse,
      topics: topicsFor(item.chapterId, item.text).map((topic) => topic.heading),
    })),
    projects,
    dismissals: dismissals.map((item) => ({ key: item.proposalKey, reason: item.reason })),
    goal: input.goal,
    hours: input.hours,
    output: input.output,
    tools: input.tools,
    instruction: input.instruction,
  });
  const packet = {
    note: "Reading status is not demonstrated skill. Do not treat a completed chapter as mastery.",
    preferences: {
      goal: input.goal,
      hours: input.hours,
      output: input.output,
      tools: input.tools,
      instruction: input.instruction,
    },
    sections: corpus.map((item) => ({
      chapterId: item.chapterId,
      bookTitle: item.bookTitle,
      chapterTitle: item.chapterTitle,
      locator: item.locator,
      readingStatus: chapterStatus(db, item.chapterId),
      progressPercent: chapterProgress(db, item.chapterId),
      grounding: item.hasProse ? "excerpt" : "outline_only",
      topics: topicsFor(item.chapterId, item.text),
    })),
    previousProjects: projects,
    dismissedSuggestions: dismissals.map((item) => ({ title: item.title, reason: item.reason })),
  };
  return { hash, corpus, packet };
}

function chapterStatus(db: Db, chapterId: string): string {
  return getChapter(db, chapterId).status;
}

function chapterProgress(db: Db, chapterId: string): number {
  return getChapter(db, chapterId).progressPercent;
}

export function latestBatch(db: Db): { id: string; proposals: ProjectProposal[]; createdAt: string } | null {
  const row = db
    .prepare("SELECT * FROM project_batches ORDER BY created_at DESC LIMIT 1")
    .get() as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    proposals: parseJson(String(row.proposals_json), []),
    createdAt: String(row.created_at),
  };
}

export function findBatch(db: Db, hash: string): { id: string; proposals: ProjectProposal[] } | null {
  const row = db
    .prepare("SELECT * FROM project_batches WHERE context_hash = ? ORDER BY created_at DESC LIMIT 1")
    .get(hash) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { id: String(row.id), proposals: parseJson(String(row.proposals_json), []) };
}

export function saveBatch(
  db: Db,
  hash: string,
  request: unknown,
  proposals: ProjectProposal[],
): { id: string; proposals: ProjectProposal[] } {
  const id = uuid();
  db.prepare(
    `INSERT INTO project_batches (id, context_hash, request_json, proposals_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, hash, JSON.stringify(request), JSON.stringify(proposals), nowIso());
  return { id, proposals };
}

export function listDismissals(db: Db): { proposalKey: string; title: string; reason: string }[] {
  return (
    db.prepare("SELECT * FROM project_dismissals ORDER BY created_at DESC LIMIT 20").all() as Record<
      string,
      unknown
    >[]
  ).map((row) => ({
    proposalKey: String(row.proposal_key),
    title: String(row.title),
    reason: String(row.reason),
  }));
}

export function dismissSuggestion(db: Db, title: string, reason: string): void {
  const clean = reason.trim();
  if (clean.length < 3) throw new AppError("Add a short reason for dismissing this suggestion.", "dismiss_reason", 400);
  db.prepare(
    `INSERT INTO project_dismissals (id, proposal_key, title, reason, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(uuid(), title.trim().toLowerCase(), title.trim(), clean, nowIso());
}

export function listProjects(db: Db): ProjectView[] {
  return (
    db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as Record<string, unknown>[]
  ).map((row) => annotateProject(db, mapProject(row)));
}

function annotateProject(db: Db, project: ProjectRecord): ProjectView {
  const latest = latestReviewForProject(db, project.id);
  return { ...project, grade: latest?.grade ?? null, passed: latest?.passed ?? null };
}

export function getProject(db: Db, id: string): ProjectRecord {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new AppError("Project not found.", "not_found", 404);
  return mapProject(row);
}

export function focusedProject(db: Db): ProjectView | null {
  const row = db
    .prepare("SELECT * FROM projects WHERE status IN ('draft', 'active') ORDER BY updated_at DESC LIMIT 1")
    .get() as Record<string, unknown> | undefined;
  return row ? annotateProject(db, mapProject(row)) : null;
}

export function acceptProposal(
  db: Db,
  batchId: string,
  proposalId: string,
  setAside: boolean,
): ProjectRecord {
  const batch = db.prepare("SELECT * FROM project_batches WHERE id = ?").get(batchId) as
    | Record<string, unknown>
    | undefined;
  if (!batch) throw new AppError("Suggestion batch not found.", "not_found", 404);
  const proposals = parseJson<ProjectProposal[]>(String(batch.proposals_json), []);
  const proposal = proposals.find((item) => item.id === proposalId);
  if (!proposal) throw new AppError("That suggestion is not in the batch.", "not_found", 404);
  const current = focusedProject(db);
  if (current && !setAside) {
    throw new AppError(
      `“${current.brief.title}” is already the focused project. Set it aside before starting another.`,
      "project_focused",
      409,
    );
  }
  if (current && setAside) {
    db.prepare("UPDATE projects SET status = 'paused', updated_at = ? WHERE id = ?").run(nowIso(), current.id);
  }
  const id = uuid();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO projects (id, batch_id, proposal_id, status, brief_json, dismiss_reason, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, NULL, ?, ?)`,
  ).run(id, batchId, proposalId, JSON.stringify(proposal), ts, ts);
  if (proposal.exam && validateVerificationPlan(proposal.criteria).activation === "ready") {
    approveProject(db, id, "objective");
  }
  return getProject(db, id);
}

export function updateDraft(db: Db, projectId: string, brief: ProjectProposal): ProjectRecord {
  const project = getProject(db, projectId);
  if (project.status !== "draft") {
    throw new AppError(
      "The approved brief is frozen. Approve a new version to change the requirements.",
      "frozen_brief",
      409,
    );
  }
  const kept = preserveExamKey(brief, project.brief);
  db.prepare("UPDATE projects SET brief_json = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(kept),
    nowIso(),
    projectId,
  );
  return getProject(db, projectId);
}

export function dismissProject(db: Db, projectId: string, reason: string): ProjectRecord {
  const project = getProject(db, projectId);
  dismissSuggestion(db, project.brief.title, reason);
  db.prepare("UPDATE projects SET status = 'dismissed', dismiss_reason = ?, updated_at = ? WHERE id = ?").run(
    reason.trim(),
    nowIso(),
    projectId,
  );
  return getProject(db, projectId);
}

export function approveProject(db: Db, projectId: string, mode: AssessmentMode): ProjectVersionRecord {
  const project = getProject(db, projectId);
  if (project.status !== "draft" && project.status !== "active" && project.status !== "paused") {
    throw new AppError("This project cannot be approved from its current state.", "project_state", 400);
  }
  const plan = validateVerificationPlan(project.brief.criteria);
  let criteria = project.brief.criteria;
  const limitations = [...project.brief.verificationLimitations];
  if (mode === "objective") {
    if (plan.activation !== "ready") {
      throw new AppError(
        "The verification plan is not ready to activate as an objective check.",
        "plan_not_ready",
        400,
        plan,
      );
    }
  } else {
    const dropped = criteria.filter(
      (criterion) =>
        criterion.method === "execution" ||
        (criterion.method === "numeric_tolerance" && !criterionReady(criterion)),
    );
    criteria = criteria.filter((criterion) => !dropped.includes(criterion));
    if (!criteria.some((criterion) => criterion.method === "ai_review")) {
      criteria.push({
        id: "scope-review",
        statement: "The submission addresses the approved outcome and states its assumptions.",
        evidenceRequired: "A written explanation of the approach and assumptions.",
        method: "ai_review",
        referenceExpression: null,
        tolerance: null,
        knownGood: null,
        faulty: [],
        submissionField: null,
        coverage: "Reasoning review only. No numerical or execution check is claimed.",
      });
    }
    if (dropped.length > 0) {
      limitations.push(
        `Approved as an AI-reviewed scope. These checks are not required: ${dropped
          .map((item) => item.statement)
          .join("; ")}.`,
      );
    }
  }
  const brief: ProjectProposal = { ...project.brief, criteria, verificationLimitations: limitations };
  const narrowedPlan = validateVerificationPlan(brief.criteria);
  const versionNumber =
    (db.prepare("SELECT COALESCE(MAX(version_number), 0) AS n FROM project_versions WHERE project_id = ?").get(
      projectId,
    ) as { n: number }).n + 1;
  const id = uuid();
  const snapshot = brief.sources;
  db.prepare(
    `INSERT INTO project_versions
     (id, project_id, version_number, brief_json, plan_json, source_snapshot_json, assessment_mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    versionNumber,
    JSON.stringify(brief),
    JSON.stringify(narrowedPlan),
    JSON.stringify(snapshot),
    mode,
    nowIso(),
  );
  db.prepare("UPDATE projects SET status = 'active', brief_json = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(brief),
    nowIso(),
    projectId,
  );
  return getVersion(db, id);
}

function criterionReady(criterion: ProjectCriterion): boolean {
  return validateVerificationPlan([criterion]).activation === "ready";
}

export function listVersions(db: Db, projectId: string): ProjectVersionRecord[] {
  return (
    db
      .prepare("SELECT * FROM project_versions WHERE project_id = ? ORDER BY version_number ASC")
      .all(projectId) as Record<string, unknown>[]
  ).map(mapVersion);
}

export function latestVersion(db: Db, projectId: string): ProjectVersionRecord | null {
  const versions = listVersions(db, projectId);
  return versions.at(-1) ?? null;
}

function mapVersion(row: Record<string, unknown>): ProjectVersionRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    versionNumber: Number(row.version_number),
    brief: parseJson(String(row.brief_json), {} as ProjectProposal),
    plan: parseJson(String(row.plan_json), validateVerificationPlan([])),
    sourceSnapshot: parseJson(String(row.source_snapshot_json), []),
    assessmentMode: String(row.assessment_mode) as AssessmentMode,
    createdAt: String(row.created_at),
  };
}

function getVersion(db: Db, id: string): ProjectVersionRecord {
  const row = db.prepare("SELECT * FROM project_versions WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new AppError("Project version not found.", "not_found", 404);
  return mapVersion(row);
}

export function resumeProject(db: Db, projectId: string): ProjectRecord {
  const project = getProject(db, projectId);
  if (project.status !== "paused") {
    throw new AppError("Only a set-aside project can be resumed.", "project_state", 400);
  }
  const current = focusedProject(db);
  if (current) {
    throw new AppError(
      `“${current.brief.title}” is already the focused project. Set it aside before resuming another.`,
      "project_focused",
      409,
    );
  }
  db.prepare("UPDATE projects SET status = 'active', updated_at = ? WHERE id = ?").run(nowIso(), projectId);
  return getProject(db, projectId);
}

export function reopenForRevision(db: Db, projectId: string): ProjectRecord {
  const project = getProject(db, projectId);
  if (project.status !== "active" && project.status !== "paused") {
    throw new AppError("Approve the current brief before opening another version.", "project_state", 400);
  }
  db.prepare("UPDATE projects SET status = 'draft', updated_at = ? WHERE id = ?").run(nowIso(), projectId);
  return getProject(db, projectId);
}

export function addSubmission(db: Db, projectId: string, artifacts: SubmissionArtifacts): SubmissionRecord {
  const project = getProject(db, projectId);
  if (project.status !== "active") {
    throw new AppError("Approve the brief before submitting work.", "not_approved", 400);
  }
  const version = latestVersion(db, projectId);
  if (!version) throw new AppError("Approve the brief before submitting work.", "not_approved", 400);
  if (version.brief.predictionRequired && !artifacts.prediction?.trim()) {
    throw new AppError("Save your prediction before any result is revealed.", "prediction_required", 400);
  }
  const submissionNumber =
    (db
      .prepare("SELECT COALESCE(MAX(submission_number), 0) AS n FROM project_submissions WHERE project_id = ?")
      .get(projectId) as { n: number }).n + 1;
  const id = uuid();
  db.prepare(
    `INSERT INTO project_submissions
     (id, project_id, version_id, submission_number, artifacts_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, version.id, submissionNumber, JSON.stringify(artifacts), nowIso());
  return getSubmission(db, id);
}

export function listSubmissions(db: Db, projectId: string): SubmissionRecord[] {
  return (
    db
      .prepare("SELECT * FROM project_submissions WHERE project_id = ? ORDER BY submission_number ASC")
      .all(projectId) as Record<string, unknown>[]
  ).map(mapSubmission);
}

export function getSubmission(db: Db, id: string): SubmissionRecord {
  const row = db.prepare("SELECT * FROM project_submissions WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new AppError("Submission not found.", "not_found", 404);
  return mapSubmission(row);
}

function mapSubmission(row: Record<string, unknown>): SubmissionRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    versionId: String(row.version_id),
    submissionNumber: Number(row.submission_number),
    artifacts: parseJson(String(row.artifacts_json), {
      explanation: "",
      assumptions: "",
      deliverable: "",
      prediction: null,
    }),
    createdAt: String(row.created_at),
  };
}

export function objectiveResultsFor(version: ProjectVersionRecord, artifacts: SubmissionArtifacts): CriterionCheck[] {
  const text = [artifacts.deliverable, artifacts.explanation, artifacts.assumptions].join("\n");
  return version.brief.criteria.map((criterion) => runObjectiveCheck(criterion, text));
}

export function findReview(db: Db, submissionId: string): ReviewRecord | null {
  const row = db
    .prepare("SELECT * FROM project_reviews WHERE submission_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(submissionId) as Record<string, unknown> | undefined;
  return row ? mapReview(row) : null;
}

export function saveReview(
  db: Db,
  input: {
    submissionId: string;
    versionId: string;
    objective: CriterionCheck[];
    reasoning: unknown;
    questions: { id: string; prompt: string }[];
    label: string;
    nextAction: string | null;
    operational: { message: string } | null;
    grade?: string | null;
    passed?: boolean | null;
    notes?: { line: number; text: string }[] | null;
  },
): ReviewRecord {
  const existing = findReview(db, input.submissionId);
  if (existing && existing.label !== "operational_failure") return existing;
  const id = uuid();
  db.prepare(
    `INSERT INTO project_reviews
     (id, submission_id, version_id, objective_json, reasoning_json, questions_json, answer_json, answer_review_json, label, next_action, operational_json, grade, passed, notes_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.submissionId,
    input.versionId,
    JSON.stringify(input.objective),
    input.reasoning ? JSON.stringify(input.reasoning) : null,
    JSON.stringify(input.questions),
    input.label,
    input.nextAction,
    input.operational ? JSON.stringify(input.operational) : null,
    input.grade ?? null,
    input.passed == null ? null : input.passed ? 1 : 0,
    input.notes ? JSON.stringify(input.notes) : null,
    nowIso(),
  );
  return getReview(db, id);
}

export function saveAnswers(
  db: Db,
  reviewId: string,
  answers: Record<string, string>,
  answerReview: unknown,
): ReviewRecord {
  const review = getReview(db, reviewId);
  db.prepare("UPDATE project_reviews SET answer_json = ?, answer_review_json = ? WHERE id = ?").run(
    JSON.stringify(answers),
    JSON.stringify(answerReview),
    reviewId,
  );
  const updated = getReview(db, reviewId);
  if (JSON.stringify(updated.objective) !== JSON.stringify(review.objective)) {
    throw new AppError("Answer review must not change objective results.", "review_integrity", 500);
  }
  return updated;
}

export function getReview(db: Db, id: string): ReviewRecord {
  const row = db.prepare("SELECT * FROM project_reviews WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new AppError("Review not found.", "not_found", 404);
  return mapReview(row);
}

function mapReview(row: Record<string, unknown>): ReviewRecord {
  return {
    id: String(row.id),
    submissionId: String(row.submission_id),
    versionId: String(row.version_id),
    objective: parseJson(String(row.objective_json), []),
    reasoning: row.reasoning_json ? parseJson(String(row.reasoning_json), null) : null,
    questions: parseJson(String(row.questions_json), []),
    answers: row.answer_json ? parseJson(String(row.answer_json), null) : null,
    answerReview: row.answer_review_json ? parseJson(String(row.answer_review_json), null) : null,
    label: String(row.label),
    nextAction: (row.next_action as string) ?? null,
    operational: row.operational_json ? parseJson(String(row.operational_json), null) : null,
    grade: row.grade == null ? null : String(row.grade),
    passed: row.passed == null ? null : Number(row.passed) === 1,
    notes: row.notes_json ? parseJson(String(row.notes_json), null) : null,
    createdAt: String(row.created_at),
  };
}

export function presentProject<T extends { brief: ProjectProposal }>(project: T): T {
  return { ...project, brief: redactProposal(project.brief) };
}

export function presentVersion<T extends { brief: ProjectProposal }>(version: T): T {
  return { ...version, brief: redactProposal(version.brief) };
}

export function presentBatch<T extends { proposals: ProjectProposal[] }>(batch: T): T {
  return { ...batch, proposals: batch.proposals.map(redactProposal) };
}

function latestReviewForProject(db: Db, projectId: string): ReviewRecord | null {
  const row = db
    .prepare(
      `SELECT r.* FROM project_reviews r
       JOIN project_submissions s ON s.id = r.submission_id
       WHERE s.project_id = ?
       ORDER BY r.created_at DESC LIMIT 1`,
    )
    .get(projectId) as Record<string, unknown> | undefined;
  return row ? mapReview(row) : null;
}

export function finishProject(db: Db, projectId: string): ProjectRecord {
  getProject(db, projectId);
  db.prepare("UPDATE projects SET status = 'completed', updated_at = ? WHERE id = ?").run(nowIso(), projectId);
  return getProject(db, projectId);
}

export { applyGrounding };
