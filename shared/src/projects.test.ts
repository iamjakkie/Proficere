import { describe, expect, it } from "vitest";
import {
  applyGrounding,
  assessmentLabel,
  evalArithmetic,
  runObjectiveCheck,
  validateNumericChecker,
  validateVerificationPlan,
  type ProjectCriterion,
  type ProjectProposal,
} from "./projects.js";

const KALMAN = `
The scalar update uses a gain K = P / (P + R).
When the estimate variance P equals the measurement variance R, the gain is one half.
A measurement that is much noisier than the estimate pulls the gain toward zero.
`;

const ALGEBRA = `
A linear equation ax + b = 0 has the solution x = -b / a when a is not zero.
For a = 2 and b = -4 the solution is x = 2.
Adding the same number to both sides does not change the solution set.
`;

function numericCriterion(expression: string, good: string, faulty: string[]): ProjectCriterion {
  return {
    id: "value",
    statement: "The submitted value matches the frozen expression.",
    evidenceRequired: "A line of the form answer: <number>.",
    method: "numeric_tolerance",
    referenceExpression: expression,
    tolerance: 0.01,
    knownGood: good,
    faulty,
    submissionField: "answer",
    coverage: "Compares one submitted number with the recomputed expression.",
  };
}

function proposal(overrides: Partial<ProjectProposal> = {}): ProjectProposal {
  return {
    id: "p1",
    title: "Compute one gain",
    fit: "apply",
    grounding: "source_grounded",
    problem: "Compute the gain when the two variances match.",
    outcome: "A single numeric answer with the assumption stated.",
    whyItFits: "The section states this case. Reading it is not the same as computing it.",
    objectives: ["Compute K when P = R."],
    familiarConcepts: ["A variance is a spread."],
    newLearning: ["The gain formula."],
    prerequisites: ["Arithmetic with fractions."],
    sources: [],
    studySequence: [{ chapterId: "c1", title: "Gain", locator: "section", why: "The formula is stated there." }],
    deliverables: ["answer: <number> and one sentence of assumptions."],
    checkpoints: ["Write the formula before substituting."],
    effortMinHours: 1,
    effortMaxHours: 2,
    assumptions: ["P and R are positive."],
    criteria: [numericCriterion("1/2", "0.5", ["0.9"])],
    beyondPrevious: "No earlier project computed this gain.",
    verificationLimitations: [],
    predictionRequired: false,
    inventedExercise: "The substitution P = R is the exercise. The source states the formula, not this worksheet.",
    sourceSupported: ["K = P / (P + R)", "Equal variances give a gain of one half."],
    ...overrides,
  };
}

describe("project checks work for more than one topic", () => {
  it("recomputes arithmetic and rejects a checker that accepts a bad case", () => {
    expect(evalArithmetic("1/2")).toBeCloseTo(0.5);
    expect(evalArithmetic("(4)/(2)")).toBe(2);
    expect(evalArithmetic("alert(1)")).toBeNull();
    const kalman = validateNumericChecker(numericCriterion("1/2", "0.5", ["0"]));
    const algebra = validateNumericChecker(numericCriterion("(4)/(2)", "2", ["0"]));
    expect(kalman.ok).toBe(true);
    expect(algebra.ok).toBe(true);
    expect(validateNumericChecker(numericCriterion("1/2", "0.5", ["0.5"])).ok).toBe(false);
  });

  it("keeps a real quote and downgrades an invented passage", () => {
    const corpus = [
      {
        bookId: "b1",
        bookTitle: "Kalman notes",
        chapterId: "c1",
        chapterTitle: "Gain",
        locator: "section Gain",
        sourceHash: "h1",
        text: KALMAN,
        hasProse: true,
      },
      {
        bookId: "b2",
        bookTitle: "Algebra notes",
        chapterId: "c2",
        chapterTitle: "Linear equations",
        locator: "section Linear equations",
        sourceHash: "h2",
        text: ALGEBRA,
        hasProse: true,
      },
    ];
    const grounded = applyGrounding(
      proposal({
        sources: [
          {
            bookId: "",
            bookTitle: "",
            chapterId: "c1",
            chapterTitle: "Gain",
            locator: "page 99",
            sourceHash: "",
            grounding: "source_grounded",
            passage: "When the estimate variance P equals the measurement variance R, the gain is one half.",
          },
        ],
      }),
      corpus,
    );
    expect(grounded.grounding).toBe("source_grounded");
    expect(grounded.sources[0]?.locator).toBe("section Gain");
    const invented = applyGrounding(
      proposal({
        title: "Solve ax + b = 0",
        sources: [
          {
            bookId: "",
            bookTitle: "",
            chapterId: "c2",
            chapterTitle: "Linear equations",
            locator: "page 3",
            sourceHash: "",
            grounding: "source_grounded",
            passage: "This sentence was not in the algebra note.",
          },
        ],
      }),
      corpus,
    );
    expect(invented.grounding).toBe("topic_based");
    expect(invented.sources[0]?.passage).toBeNull();
    const outlineOnly = applyGrounding(
      proposal({
        sources: [
          {
            bookId: "b1",
            bookTitle: "Kalman notes",
            chapterId: "c1",
            chapterTitle: "Gain",
            locator: "Gain",
            sourceHash: "h1",
            grounding: "source_grounded",
            passage: "When the estimate variance P equals the measurement variance R, the gain is one half.",
          },
        ],
      }),
      [{ ...corpus[0], hasProse: false, text: "Gain" }],
    );
    expect(outlineOnly.grounding).toBe("topic_based");
  });

  it("refuses to call an unrun execution check verified", () => {
    const execution: ProjectCriterion = {
      ...numericCriterion("1/2", "0.5", ["0"]),
      id: "run",
      method: "execution",
      referenceExpression: null,
      tolerance: null,
      knownGood: null,
      faulty: [],
    };
    const plan = validateVerificationPlan([execution]);
    expect(plan.executionAvailable).toBe(false);
    expect(plan.activation).toBe("unsupported");
    expect(runObjectiveCheck(execution, "print(1)").status).toBe("not_run");
    expect(
      assessmentLabel({
        assessmentMode: "objective",
        objective: [runObjectiveCheck(execution, "print(1)")],
        reasoning: [{ criterionId: "run", judgment: "meets_rubric", explanation: "The review read the code." }],
        operational: false,
      }),
    ).toBe("unverified");
  });

  it("does not treat an AI-only plan as ready for objective verification", () => {
    const plan = validateVerificationPlan([
      {
        id: "write",
        statement: "The explanation states the assumption.",
        evidenceRequired: "A sentence.",
        method: "ai_review",
        referenceExpression: null,
        tolerance: null,
        knownGood: null,
        faulty: [],
        submissionField: null,
        coverage: null,
      },
    ]);
    expect(plan.activation).toBe("needs_validation");
    expect(plan.issues.some((issue) => issue.severity === "block")).toBe(true);
  });

  it("separates a passed number from the reasoning review", () => {
    const criterion = numericCriterion("1/2", "0.5", ["0"]);
    const objective = runObjectiveCheck(criterion, "answer: 0.5");
    expect(objective.status).toBe("passed");
    expect(
      assessmentLabel({
        assessmentMode: "objective",
        objective: [objective],
        reasoning: [{ criterionId: "value", judgment: "needs_revision", explanation: "The assumption was missing." }],
        operational: false,
      }),
    ).toBe("needs_revision");
    expect(
      assessmentLabel({
        assessmentMode: "objective",
        objective: [objective],
        reasoning: [{ criterionId: "value", judgment: "meets_rubric", explanation: "The assumption matches the section." }],
        operational: false,
      }),
    ).toBe("verified");
    expect(
      assessmentLabel({
        assessmentMode: "ai_reviewed",
        objective: [],
        reasoning: [{ criterionId: "write", judgment: "meets_rubric", explanation: "The report states its limit." }],
        operational: false,
      }),
    ).toBe("ai_reviewed");
    expect(
      assessmentLabel({
        assessmentMode: "objective",
        objective: [{ ...objective, status: "not_run", operational: true }],
        reasoning: [{ criterionId: "value", judgment: "meets_rubric", explanation: "Unread." }],
        operational: true,
      }),
    ).toBe("operational_failure");
  });
});
