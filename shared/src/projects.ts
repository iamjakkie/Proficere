import { z } from "zod";
import { passageExistsInSource } from "./grounding.js";

export const ProjectFitSchema = z.enum(["reinforce", "apply", "combine", "stretch"]);
export const GroundingKindSchema = z.enum(["source_grounded", "topic_based"]);
export const CheckMethodSchema = z.enum([
  "numeric_tolerance",
  "execution",
  "ai_review",
  "presence",
  "derivation",
]);
export const AssessmentModeSchema = z.enum(["objective", "ai_reviewed"]);
export const ObjectiveStatusSchema = z.enum(["passed", "failed", "not_run"]);
export const ReasoningJudgmentSchema = z.enum([
  "meets_rubric",
  "needs_revision",
  "insufficient_evidence",
  "not_reviewed",
]);

export const ProjectSourceRefSchema = z.object({
  bookId: z.string(),
  bookTitle: z.string(),
  chapterId: z.string(),
  chapterTitle: z.string(),
  locator: z.string(),
  sourceHash: z.string(),
  grounding: GroundingKindSchema,
  passage: z.string().nullable(),
});
export const ExamExerciseSchema = z.object({
  ask: z.string().min(1).max(320),
  given: z.array(z.string().max(200)).max(6).default([]),
  target: z.string().max(40).default(""),
  reference: z.string().max(400).default(""),
  /** CommonMath action, such as `calculate` or `differentiate x`. Empty keeps the SymPy script. */
  action: z.string().max(80).optional().default(""),
  kind: z.enum(["calculation", "theory"]),
});
export type ExamExercise = z.infer<typeof ExamExerciseSchema>;

export const ExamTaskSchema = z.object({
  prompt: z.string().min(1),
  given: z.array(z.string()).max(40),
  target: z.string().min(1),
  reference: z.string().max(400).optional().default(""),
  required: z.array(z.string().max(400)).max(12).default([]),
  starter: z.string().max(500).default(""),
  exercises: z.array(ExamExerciseSchema).max(10).default([]),
});
export type ExamTask = z.infer<typeof ExamTaskSchema>;

export type ProjectSourceRef = z.infer<typeof ProjectSourceRefSchema>;

export const ProjectCriterionSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  evidenceRequired: z.string().min(1),
  method: CheckMethodSchema,
  referenceExpression: z.string().nullable(),
  tolerance: z.number().positive().nullable(),
  knownGood: z.string().nullable(),
  faulty: z.array(z.string()).max(4),
  submissionField: z.string().nullable(),
  coverage: z.string().nullable(),
});
export type ProjectCriterion = z.infer<typeof ProjectCriterionSchema>;

export const ProjectProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  fit: ProjectFitSchema,
  grounding: GroundingKindSchema,
  problem: z.string().min(1),
  outcome: z.string().min(1),
  whyItFits: z.string().min(1),
  objectives: z.array(z.string().min(1)).min(1).max(6),
  familiarConcepts: z.array(z.string()),
  newLearning: z.array(z.string()),
  prerequisites: z.array(z.string()),
  sources: z.array(ProjectSourceRefSchema),
  studySequence: z.array(
    z.object({
      chapterId: z.string().nullable(),
      title: z.string().min(1),
      locator: z.string().nullable(),
      why: z.string().min(1),
    }),
  ).min(1).max(6),
  deliverables: z.array(z.string().min(1)).min(1).max(6),
  checkpoints: z.array(z.string().min(1)).min(1).max(5),
  effortMinHours: z.number().positive(),
  effortMaxHours: z.number().positive(),
  assumptions: z.array(z.string()),
  criteria: z.array(ProjectCriterionSchema).min(1).max(8),
  beyondPrevious: z.string().min(1),
  verificationLimitations: z.array(z.string()),
  predictionRequired: z.boolean(),
  inventedExercise: z.string().min(1),
  sourceSupported: z.array(z.string()),
  exam: ExamTaskSchema.nullable().optional(),
});
export type ProjectProposal = z.infer<typeof ProjectProposalSchema>;

export type SourceCorpus = {
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  locator: string;
  sourceHash: string;
  text: string;
  hasProse: boolean;
};

const TOPIC_LIMIT =
  "Only a title or outline was available, so this proposal is topic-based. Provide an excerpt if you want it grounded in the source.";

/** Keep quotes that exist in stored text. Never keep a passage or page that was not supplied. */
export function applyGrounding(proposal: ProjectProposal, corpus: SourceCorpus[]): ProjectProposal {
  const byId = new Map(corpus.map((item) => [item.chapterId, item]));
  const byTitle = new Map(corpus.map((item) => [item.chapterTitle.trim().toLowerCase(), item]));
  const matched = proposal.sources.flatMap((ref) => {
    const hit = byId.get(ref.chapterId) ?? byTitle.get(ref.chapterTitle.trim().toLowerCase());
    if (!hit) return [];
    return [{ ref, hit }];
  });
  const limitations = [...proposal.verificationLimitations];
  const topic = (sources: ProjectSourceRef[]): ProjectProposal => {
    if (!limitations.some((item) => item.includes("topic-based"))) limitations.push(TOPIC_LIMIT);
    return {
      ...proposal,
      grounding: "topic_based",
      sources: sources.map((source) => ({ ...source, passage: null, grounding: "topic_based" })),
      verificationLimitations: limitations,
    };
  };
  if (matched.length === 0 || matched.some(({ hit }) => !hit.hasProse)) {
    return topic(
      matched.map(({ ref, hit }) => ({
        ...ref,
        bookId: hit.bookId,
        bookTitle: hit.bookTitle,
        chapterId: hit.chapterId,
        chapterTitle: hit.chapterTitle,
        locator: hit.locator,
        sourceHash: hit.sourceHash,
        passage: null,
        grounding: "topic_based",
      })),
    );
  }
  let quoted = true;
  const sources = matched.map(({ ref, hit }) => {
    const passage = ref.passage?.trim() ?? "";
    const found = passage.length > 0 && passageExistsInSource(passage, hit.text);
    if (!found) quoted = false;
    return {
      ...ref,
      bookId: hit.bookId,
      bookTitle: hit.bookTitle,
      chapterId: hit.chapterId,
      chapterTitle: hit.chapterTitle,
      locator: hit.locator,
      sourceHash: hit.sourceHash,
      passage: found ? passage : null,
      grounding: found ? ("source_grounded" as const) : ("topic_based" as const),
    };
  });
  if (!quoted) {
    limitations.push(
      "A cited passage was not in the stored text, so this proposal is topic-based rather than source-grounded.",
    );
    return { ...proposal, grounding: "topic_based", sources, verificationLimitations: limitations };
  }
  return { ...proposal, grounding: "source_grounded", sources, verificationLimitations: limitations };
}

/** Literals and + - * / ( ) only. This is the trusted checker, not submitted code. */
export function evalArithmetic(input: string): number | null {
  const source = input.replace(/\s+/g, "");
  if (!source || !/^[\d.+\-*/()]+$/.test(source)) return null;
  let index = 0;
  const peek = () => source[index];
  function parseExpr(): number | null {
    let left = parseTerm();
    if (left == null) return null;
    while (peek() === "+" || peek() === "-") {
      const op = source[index++];
      const right = parseTerm();
      if (right == null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseTerm(): number | null {
    let left = parseFactor();
    if (left == null) return null;
    while (peek() === "*" || peek() === "/") {
      const op = source[index++];
      const right = parseFactor();
      if (right == null || (op === "/" && right === 0)) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }
  function parseFactor(): number | null {
    if (peek() === "(") {
      index += 1;
      const value = parseExpr();
      if (peek() !== ")" || value == null) return null;
      index += 1;
      return value;
    }
    const start = index;
    if (peek() === "-") index += 1;
    while (/[\d.]/.test(peek() ?? "")) index += 1;
    if (index === start || (source[start] === "-" && index === start + 1)) return null;
    const value = Number(source.slice(start, index));
    return Number.isFinite(value) ? value : null;
  }
  const value = parseExpr();
  if (value == null || index !== source.length) return null;
  return value;
}

export function validateNumericChecker(criterion: ProjectCriterion): {
  ok: boolean;
  reference: number | null;
  reason: string;
} {
  if (criterion.method !== "numeric_tolerance") {
    return { ok: false, reference: null, reason: "Not a numeric check." };
  }
  if (!criterion.referenceExpression || criterion.tolerance == null || !criterion.knownGood) {
    return {
      ok: false,
      reference: null,
      reason: "A numeric check needs a reference expression, a tolerance, and a known-good case.",
    };
  }
  if (criterion.faulty.length < 1) {
    return { ok: false, reference: null, reason: "A numeric check needs a representative faulty case." };
  }
  const reference = evalArithmetic(criterion.referenceExpression);
  if (reference == null) {
    return {
      ok: false,
      reference: null,
      reason: "The reference expression is not a trusted arithmetic formula, so it was not used as an independent value.",
    };
  }
  const good = extractNumber(criterion.knownGood);
  if (good == null || Math.abs(good - reference) > criterion.tolerance) {
    return {
      ok: false,
      reference,
      reason: "The known-good case does not match the reference expression within the stated tolerance.",
    };
  }
  for (const faulty of criterion.faulty) {
    const value = extractNumber(faulty);
    if (value == null || Math.abs(value - reference) <= criterion.tolerance) {
      return {
        ok: false,
        reference,
        reason: "A faulty case was accepted by the tolerance, so the checker is not validated.",
      };
    }
  }
  return { ok: true, reference, reason: "Checker matched its known-good case and rejected the faulty cases." };
}

export function extractNumber(text: string): number | null {
  const labeled = text.match(/answer\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  if (labeled) return Number(labeled[1]);
  const fraction = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return Number(fraction[1]) / denominator;
  }
  const direct = text.trim().match(/^-?\d+(?:\.\d+)?$/);
  if (direct) return Number(direct[0]);
  return null;
}

export type PlanIssue = {
  criterionId: string | null;
  severity: "block" | "limit";
  message: string;
};

export function validateVerificationPlan(criteria: ProjectCriterion[]): {
  activation: "ready" | "needs_validation" | "unsupported";
  issues: PlanIssue[];
  executionAvailable: false;
} {
  const issues: PlanIssue[] = [];
  if (criteria.length === 0) {
    issues.push({
      criterionId: null,
      severity: "block",
      message: "The brief has no acceptance criteria.",
    });
  }
  let needsValidation = false;
  let unsupported = false;
  for (const criterion of criteria) {
    if (!criterion.statement.trim() || !criterion.evidenceRequired.trim()) {
      issues.push({
        criterionId: criterion.id,
        severity: "block",
        message: "Every criterion needs a statement and the evidence required.",
      });
    }
    if (criterion.method === "execution") {
      unsupported = true;
      issues.push({
        criterionId: criterion.id,
        severity: "block",
        message:
          "Execution is not available. This check would stay Not run. Approve a narrower AI-reviewed scope, or remove the criterion. Submitted code will not be run.",
      });
    }
    if (criterion.method === "numeric_tolerance") {
      const check = validateNumericChecker(criterion);
      if (!check.ok) {
        needsValidation = true;
        issues.push({
          criterionId: criterion.id,
          severity: "block",
          message: `Verification plan needs validation. ${check.reason}`,
        });
      } else {
        issues.push({
          criterionId: criterion.id,
          severity: "limit",
          message:
            "The reference value is recomputed from the frozen arithmetic expression. It was checked against the known-good and faulty cases, not against a separate external implementation.",
        });
      }
    }
    if (criterion.method === "ai_review") {
      issues.push({
        criterionId: criterion.id,
        severity: "limit",
        message: "This judgment is an AI review of the submission. It is not an executed check.",
      });
    }
    if (criterion.method === "derivation") {
      issues.push({
        criterionId: criterion.id,
        severity: "limit",
        message:
          "SymPy checks each assignment and each required step. The grade is a separate review of the write-up.",
      });
    }
  }
  const objectiveReady = criteria.some(
    (criterion) =>
      (criterion.method === "numeric_tolerance" && validateNumericChecker(criterion).ok) ||
      criterion.method === "derivation",
  );
  if (!unsupported && !needsValidation && !objectiveReady) {
    needsValidation = true;
    issues.push({
      criterionId: null,
      severity: "block",
      message:
        "No validated numeric check is available, so this cannot be labeled verified against the rubric. Approve the narrower AI-reviewed scope, or add a numeric check with a known-good case and a faulty case.",
    });
  }
  const activation = unsupported ? "unsupported" : needsValidation ? "needs_validation" : "ready";
  return { activation, issues, executionAvailable: false };
}

export type CriterionCheck = {
  criterionId: string;
  method: ProjectCriterion["method"];
  status: "passed" | "failed" | "not_run";
  explanation: string;
  coverage: string | null;
  operational: boolean;
};

export function runObjectiveCheck(criterion: ProjectCriterion, submissionText: string): CriterionCheck {
  const base = {
    criterionId: criterion.id,
    method: criterion.method,
    coverage: criterion.coverage,
    operational: false,
  };
  if (criterion.method === "execution") {
    return {
      ...base,
      status: "not_run",
      explanation: "Not run. No execution runner is configured, so this code was not executed.",
    };
  }
  if (criterion.method === "ai_review") {
    return {
      ...base,
      status: "not_run",
      explanation: "Not an objective check. The reasoning review covers this criterion.",
    };
  }
  if (criterion.method === "derivation") {
    return {
      ...base,
      status: "not_run",
      operational: true,
      explanation: "The derivation checker has not been attached to this result.",
    };
  }
  if (criterion.method === "presence") {
    const present = submissionText.trim().length >= 40;
    return {
      ...base,
      status: present ? "passed" : "failed",
      explanation: present
        ? "The submission includes a written artifact."
        : "The required written artifact is missing or too short to review.",
      coverage: "Presence only. This does not check correctness.",
    };
  }
  const validated = validateNumericChecker(criterion);
  if (!validated.ok || validated.reference == null || criterion.tolerance == null) {
    return {
      ...base,
      status: "not_run",
      operational: true,
      explanation: validated.reason,
    };
  }
  const submitted = extractNumber(submissionText);
  if (submitted == null) {
    return {
      ...base,
      status: "failed",
      explanation: "No answer: value was found in the submission.",
      coverage: criterion.coverage ?? "One numeric comparison against the frozen expression.",
    };
  }
  const passed = Math.abs(submitted - validated.reference) <= criterion.tolerance;
  return {
    ...base,
    status: passed ? "passed" : "failed",
    explanation: passed
      ? `Submitted ${submitted} is within ${criterion.tolerance} of the recomputed reference ${validated.reference}.`
      : `Submitted ${submitted} is outside ${criterion.tolerance} of the recomputed reference ${validated.reference}.`,
    coverage: criterion.coverage ?? "One numeric comparison. Passing it does not establish every property of the work.",
  };
}

export type ReasoningResult = {
  criterionId: string;
  judgment: "meets_rubric" | "needs_revision" | "insufficient_evidence" | "not_reviewed";
  explanation: string;
};

export function assessmentLabel(input: {
  assessmentMode: "objective" | "ai_reviewed";
  objective: CriterionCheck[];
  reasoning: ReasoningResult[];
  operational: boolean;
}): "verified" | "ai_reviewed" | "needs_revision" | "operational_failure" | "unverified" {
  if (input.operational) return "operational_failure";
  const requiredObjective = input.objective.filter(
    (item) => item.method === "numeric_tolerance" || item.method === "execution" || item.method === "presence",
  );
  const reasoningCriteria = input.reasoning.filter((item) => item.judgment !== "not_reviewed");
  const reasoningFails = input.reasoning.some(
    (item) => item.judgment === "needs_revision" || item.judgment === "insufficient_evidence",
  );
  if (requiredObjective.some((item) => item.status === "failed") || reasoningFails) return "needs_revision";
  if (requiredObjective.some((item) => item.status === "not_run" && item.method === "execution")) {
    return "unverified";
  }
  const numeric = requiredObjective.filter((item) => item.method === "numeric_tolerance");
  const reasoningMeets =
    reasoningCriteria.length > 0 && reasoningCriteria.every((item) => item.judgment === "meets_rubric");
  if (!reasoningMeets) return "unverified";
  if (input.assessmentMode === "objective" && numeric.length > 0 && numeric.every((item) => item.status === "passed")) {
    return "verified";
  }
  if (input.assessmentMode === "ai_reviewed") return "ai_reviewed";
  return "unverified";
}

export function assessmentLabelText(
  label: ReturnType<typeof assessmentLabel> | "passed" | "failed",
): string {
  if (label === "passed") return "Passed";
  if (label === "failed") return "Failed";
  if (label === "verified") return "Verified against this rubric";
  if (label === "ai_reviewed") return "AI-reviewed against this rubric";
  if (label === "needs_revision") return "Needs revision";
  if (label === "operational_failure") return "Check did not finish";
  return "Unverified";
}

export function redactProposal(proposal: ProjectProposal): ProjectProposal {
  if (!proposal.exam) return proposal;
  return {
    ...proposal,
    exam: {
      ...proposal.exam,
      reference: "",
      required: [],
      exercises: (proposal.exam.exercises ?? []).map((item) => ({ ...item, reference: "" })),
    },
  };
}

export function preserveExamKey(incoming: ProjectProposal, stored: ProjectProposal): ProjectProposal {
  if (!stored.exam) return incoming;
  if (!incoming.exam) return { ...incoming, exam: stored.exam };
  const storedExercises = stored.exam.exercises ?? [];
  return {
    ...incoming,
    exam: {
      ...incoming.exam,
      reference: stored.exam.reference,
      required: stored.exam.required,
      exercises: (incoming.exam.exercises ?? []).map((item, index) => ({
        ...item,
        reference: storedExercises[index]?.reference ?? item.reference,
        action: item.action?.trim() ? item.action : (storedExercises[index]?.action ?? item.action),
      })),
    },
  };
}
