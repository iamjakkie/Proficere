import type { CriterionCheck, ProjectProposal } from "@progress-island/shared";
import { parseDerivation, sympyImports } from "@progress-island/shared";
import { checkDerivation } from "./derivation-check.js";
import { gradeExamWithAi } from "./project-ai.js";

export type ExamReview = {
  objective: CriterionCheck[];
  reasoning: [];
  questions: [];
  label: "passed" | "failed" | "operational_failure";
  nextAction: string;
  operational: { message: string } | null;
  grade: string | null;
  passed: boolean | null;
  notes: { line: number; text: string }[] | null;
};

function criterion(status: CriterionCheck["status"], explanation: string, operational: boolean): CriterionCheck {
  return {
    criterionId: "derivation",
    method: "derivation",
    status,
    explanation,
    coverage: "SymPy checks each assignment and each required step. The grade is a separate review of the write-up.",
    operational,
  };
}

function hides(text: string, secrets: string[]): boolean {
  const compact = text.replace(/\s+/g, "").toLowerCase();
  return secrets.some((secret) => {
    const hidden = secret.replace(/\s+/g, "").toLowerCase();
    return hidden.length > 2 && compact.includes(hidden);
  });
}

export async function reviewExam(input: {
  brief: ProjectProposal;
  deliverable: string;
  gradeWithModel: boolean;
}): Promise<ExamReview> {
  const exam = input.brief.exam;
  if (!exam?.reference?.trim() || exam.required.length === 0) {
    return {
      objective: [criterion("not_run", "The derivation checker has no reference for this exam.", true)],
      reasoning: [],
      questions: [],
      label: "operational_failure",
      nextAction: "The exam key is missing, so this attempt was not graded.",
      operational: { message: "The derivation checker has no reference for this exam. That is not evidence the solution is wrong." },
      grade: null,
      passed: null,
      notes: null,
    };
  }
  const parsed = parseDerivation(input.deliverable);
  if (parsed.error) {
    return {
      objective: [criterion("failed", parsed.error, false)],
      reasoning: [],
      questions: [],
      label: "failed",
      nextAction: parsed.error,
      operational: null,
      grade: "F",
      passed: false,
      notes: [{ line: 1, text: parsed.error }],
    };
  }
  const report = await checkDerivation({
    steps: parsed.steps
      .filter((step) => step.error === null && !step.declaration)
      .map((step) => ({ line: step.line, name: step.name, expr: step.expr })),
    target: exam.target,
    reference: exam.reference,
    required: exam.required,
    imports: parsed.imports,
  });
  if (!report.ok) {
    return {
      objective: [criterion("not_run", report.error ?? "The derivation checker did not finish.", true)],
      reasoning: [],
      questions: [],
      label: "operational_failure",
      nextAction: "Run the check again. This failure does not mean the derivation is wrong.",
      operational: { message: report.error ?? "The derivation checker did not finish. That is not evidence the solution is wrong." },
      grade: null,
      passed: null,
      notes: null,
    };
  }
  const algebraPassed =
    report.targetMatches &&
    report.steps.every((step) => step.status === "passed") &&
    report.required.every((item) => item.status === "passed");
  const algebraText = [
    ...report.steps.map((step) => `Line ${step.line ?? "?"}: ${step.status}. ${step.explanation}`),
    ...report.required.map((item) => item.explanation),
    algebraPassed ? "The final assignment matches the stored value." : "The final assignment does not match.",
  ].join(" ");
  const secrets = [exam.reference, ...exam.required];
  if (!input.gradeWithModel) {
    if (!algebraPassed) {
      return {
        objective: [criterion("failed", algebraText, false)],
        reasoning: [],
        questions: [],
        label: "failed",
        nextAction: "The algebra check did not pass. The written grade was not requested.",
        operational: null,
        grade: "F",
        passed: false,
        notes: report.steps
          .filter((step) => step.status === "failed")
          .map((step) => ({ line: step.line ?? 1, text: step.explanation })),
      };
    }
    return {
      objective: [criterion("passed", algebraText, false)],
      reasoning: [],
      questions: [],
      label: "operational_failure",
      nextAction: "The algebra matched. A grade still needs the written review.",
      operational: { message: "The written review did not run. A matching derivation is not a grade." },
      grade: null,
      passed: null,
      notes: null,
    };
  }
  let graded;
  try {
    graded = await gradeExamWithAi({
      prompt: exam.prompt,
      given: exam.given,
      target: exam.target,
      derivation: input.deliverable,
      algebraPassed,
      steps: report.steps.map((step) => ({
        line: step.line,
        name: step.name,
        status: step.status,
        explanation: step.explanation,
      })),
    });
  } catch {
    if (!algebraPassed) {
      return {
        objective: [criterion("failed", algebraText, false)],
        reasoning: [],
        questions: [],
        label: "failed",
        nextAction: "The algebra check did not pass. The written review did not finish.",
        operational: null,
        grade: "F",
        passed: false,
        notes: [{ line: 1, text: "The written review did not finish. The algebra result stands." }],
      };
    }
    return {
      objective: [criterion("passed", algebraText, false)],
      reasoning: [],
      questions: [],
      label: "operational_failure",
      nextAction: "Run the review again. A matching derivation is not a grade.",
      operational: { message: "The written review did not finish. That is not evidence the derivation is wrong." },
      grade: null,
      passed: null,
      notes: null,
    };
  }
  let grade = graded.grade;
  let passed = graded.passed && (grade === "A" || grade === "B" || grade === "C") && algebraPassed;
  if (!algebraPassed && (grade === "A" || grade === "B" || grade === "C")) grade = "D";
  if (!algebraPassed || grade === "D" || grade === "F" || !graded.passed) passed = false;
  const notes = graded.notes.filter((note) => !hides(note.text, secrets));
  const summary = hides(graded.summary, secrets) ? "The written review is recorded without the expected value." : graded.summary;
  return {
    objective: [criterion(algebraPassed ? "passed" : "failed", algebraText, false)],
    reasoning: [],
    questions: [],
    label: passed ? "passed" : "failed",
    nextAction: summary,
    operational: null,
    grade,
    passed,
    notes,
  };
}

export type ExamPreview = {
  error: string | null;
  operational: string | null;
  target: string;
  summary: string;
  steps: { line: number | null; name: string; status: "passed" | "failed"; explanation: string; value: string | null }[];
  requiredFound: number;
  requiredTotal: number;
};

/** SymPy results for the editor. Nothing is stored and the expected answer is not returned. */
export async function previewExam(brief: ProjectProposal, deliverable: string): Promise<ExamPreview> {
  const exam = brief.exam;
  const target = exam?.target ?? "";
  const requiredTotal = exam?.required.length ?? 0;
  const parsed = parseDerivation(deliverable);
  if (parsed.error) {
    return { error: parsed.error, operational: null, target, summary: parsed.error, steps: [], requiredFound: 0, requiredTotal };
  }
  const runnable = parsed.steps.filter((step) => step.error === null && !step.declaration);
  const report = runnable.length
    ? await checkDerivation({
        steps: runnable.map((step) => ({ line: step.line, name: step.name, expr: step.expr })),
        target,
        reference: exam?.reference ?? "",
        required: exam?.required ?? [],
        imports: parsed.imports,
      })
    : null;
  if (report && !report.ok && report.steps.length === 0) {
    return {
      error: null,
      operational: report.error ?? "The derivation checker did not finish.",
      target,
      summary: "",
      steps: [],
      requiredFound: 0,
      requiredTotal,
    };
  }
  const secrets = [exam?.reference ?? "", ...(exam?.required ?? [])];
  let cursor = 0;
  const steps = parsed.steps.map((step) => {
    if (step.declaration) {
      const unknown = (report?.unknownImports ?? []).find((name) => sympyImports(step.shown)?.includes(name));
      return {
        line: step.line,
        name: step.shown,
        status: unknown ? ("failed" as const) : ("passed" as const),
        explanation: unknown ? `${unknown} is not in SymPy.` : step.error ?? "Declared.",
        value: null,
      };
    }
    if (step.error || !report) {
      return {
        line: step.line,
        name: step.shown,
        status: "failed" as const,
        explanation: step.error ?? "This calculation could not be read.",
        value: null,
      };
    }
    const row = report.steps[cursor] ?? null;
    cursor += 1;
    return {
      line: step.line,
      name: step.shown,
      status: row?.status ?? "failed",
      explanation: hides(row?.explanation ?? "", secrets) ? "This step was checked." : (row?.explanation ?? "This calculation could not be read."),
      value: row?.value ?? null,
    };
  });
  const final = [...steps].reverse().find((step) => step.name === target && step.status === "passed" && step.value);
  const targetStep = [...steps].reverse().find((step) => step.name === target);
  const requiredFound = report?.required.filter((item) => item.status === "passed").length ?? 0;
  const ran = steps.filter((step) => step.status === "passed" && step.value).length;
  const ranText = `Ran ${ran} ${ran === 1 ? "calculation" : "calculations"}.`;
  const summary = !report
    ? (steps[0]?.explanation ?? "Write a calculation to run.")
    : ran === 0
      ? (steps[0]?.explanation ?? "Write a calculation to run.")
      : targetStep?.status === "failed"
        ? `${ranText} ${targetStep.explanation}`
        : !final
          ? `${ranText} ${target} was not assigned.`
          : report.targetMatches
            ? `${ranText} ${target} = ${final.value}.`
            : `${ranText} ${target} = ${final.value}. This does not match the exam.`;
  return {
    error: null,
    operational: report?.error ?? null,
    target,
    summary,
    steps,
    requiredFound,
    requiredTotal,
  };
}
