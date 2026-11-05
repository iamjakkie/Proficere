import type { CriterionCheck, ProjectProposal } from "@progress-island/shared";
import { parseDerivation, sympyImports } from "@progress-island/shared";
import { checkCommonMathAnswer } from "./common-math-check.js";
import { checkDerivation } from "./derivation-check.js";
import { gradeExamWithAi, gradeWrittenAnswers, taskScore } from "./project-ai.js";

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

function criterion(
  status: CriterionCheck["status"],
  explanation: string,
  operational: boolean,
  engine: "sympy" | "common-math" = "sympy",
): CriterionCheck {
  return {
    criterionId: "derivation",
    method: "derivation",
    status,
    explanation,
    coverage:
      engine === "common-math"
        ? "CommonMath runs each expression and compares it with the stored value. A written answer is graded separately."
        : "SymPy checks each assignment and each required step. The grade is a separate review of the write-up.",
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
  tasks?: { index: number; answer: string; action?: string }[];
  gradeWithModel: boolean;
}): Promise<ExamReview> {
  const exercises = input.brief.exam?.exercises ?? [];
  if (exercises.length >= 3) return reviewWorkbook(input);
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
  const calculations = (exam.exercises ?? []).filter((item) => item.kind === "calculation" && item.target && item.reference);
  const report = await checkDerivation({
    steps: parsed.steps
      .filter((step) => step.error === null && !step.declaration)
      .map((step) => ({ line: step.line, name: step.name, expr: step.expr })),
    target: exam.target,
    reference: exam.reference,
    required: calculations.length > 0 ? [] : exam.required,
    imports: parsed.imports,
    checks: calculations.map((item) => ({ name: item.target, expr: item.reference })),
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
  const secrets = [
    exam.reference,
    ...exam.required,
    ...(exam.exercises ?? []).map((item) => item.reference),
  ];
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

async function reviewWorkbook(input: {
  brief: ProjectProposal;
  tasks?: { index: number; answer: string; action?: string }[];
  gradeWithModel: boolean;
}): Promise<ExamReview> {
  const exercises = input.brief.exam?.exercises ?? [];
  const answers = input.tasks ?? [];
  const math = exercises.some((item) => item.kind === "calculation" && Boolean(item.action?.trim()));
  const rows: { index: number; passed: boolean; operational: boolean; note: string }[] = [];
  const written: { index: number; ask: string; answer: string }[] = [];
  for (let index = 0; index < exercises.length; index += 1) {
    const exercise = exercises[index];
    const submitted = answers.find((item) => item.index === index);
    const answer = submitted?.answer ?? "";
    if (!exercise || exercise.kind === "theory") {
      if (!answer.trim()) rows.push({ index, passed: false, operational: false, note: "The written answer is blank." });
      else if (!input.gradeWithModel) rows.push({ index, passed: false, operational: true, note: "The written answer was not graded." });
      else {
        written.push({ index, ask: exercise?.ask ?? "", answer });
        rows.push({ index, passed: false, operational: true, note: "The written answer was not graded." });
      }
      continue;
    }
    if (exercise.action?.trim()) {
      const checked = await checkCommonMathAnswer({
        latex: answer,
        action: submitted?.action?.trim() || exercise.action,
        given: exercise.given,
        reference: exercise.reference,
      });
      rows.push({ index, ...checked });
      continue;
    }
    const checked = await checkCalculation(exercise.target, exercise.reference, answer);
    rows.push({ index, ...checked });
  }
  if (written.length > 0) {
    try {
      const judged = await gradeWrittenAnswers({ items: written });
      for (const item of written) {
        const row = rows.find((entry) => entry.index === item.index);
        const verdict = judged.find((entry) => entry.index === item.index);
        if (!row) continue;
        if (!verdict) continue;
        row.passed = verdict.passed;
        row.operational = false;
        row.note = verdict.note;
      }
    } catch {
      // The placeholder rows stay operational. A failed written review is not a wrong answer.
    }
  }
  const score = taskScore(rows);
  const notes = rows.map((row) => ({ line: row.index + 1, text: row.note }));
  if (!score.complete) {
    return {
      objective: [criterion("not_run", `${score.grade} tasks were checked. A written review did not finish.`, true, math ? "common-math" : "sympy")],
      reasoning: [],
      questions: [],
      label: "operational_failure",
      nextAction: "Submit again. A task that was not graded is not marked wrong.",
      operational: { message: "A written answer was not graded. That is not evidence the answer is wrong." },
      grade: score.grade,
      passed: null,
      notes,
    };
  }
  return {
    objective: [criterion(score.passed ? "passed" : "failed", `${score.grade} tasks match.`, false, math ? "common-math" : "sympy")],
    reasoning: [],
    questions: [],
    label: score.passed ? "passed" : "failed",
    nextAction: score.passed
      ? `${score.grade} passes the exam.`
      : "Correct the tasks that do not match, then submit again. Seven out of ten passes the exam.",
    operational: null,
    grade: score.grade,
    passed: score.passed,
    notes,
  };
}

async function checkCalculation(
  target: string,
  reference: string,
  answer: string,
): Promise<{ passed: boolean; operational: boolean; note: string }> {
  const parsed = parseDerivation(answer);
  if (parsed.error) return { passed: false, operational: false, note: parsed.error };
  const steps = parsed.steps.filter((step) => step.error === null && !step.declaration);
  if (steps.length === 0) return { passed: false, operational: false, note: "Write a calculation to run." };
  const report = await checkDerivation({
    steps: steps.map((step) => ({ line: step.line, name: step.name, expr: step.expr })),
    target,
    reference,
    required: [],
    imports: parsed.imports,
    checks: [{ name: target, expr: reference }],
  });
  if (!report.ok) {
    return { passed: false, operational: true, note: report.error ?? "The check did not finish." };
  }
  const passed =
    report.targetMatches &&
    report.steps.every((step) => step.status === "passed") &&
    report.required.every((item) => item.status === "passed");
  const missed = report.required.find((item) => item.status === "failed")?.explanation;
  return { passed, operational: false, note: passed ? "Matches." : missed || `${target} does not match.` };
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
export async function previewExam(brief: ProjectProposal, deliverable: string, exerciseIndex?: number): Promise<ExamPreview> {
  const exam = brief.exam;
  const selected = exerciseIndex == null ? null : exam?.exercises?.[exerciseIndex];
  if (selected?.kind === "theory") {
    return {
      error: "This task is a written answer. It is graded when you submit the exam.",
      operational: null,
      target: "",
      summary: "This task is a written answer. It is graded when you submit the exam.",
      steps: [],
      requiredFound: 0,
      requiredTotal: 0,
    };
  }
  const target = selected?.target || exam?.target || "";
  const calculations =
    selected?.kind === "calculation"
      ? [selected]
      : (exam?.exercises ?? []).filter((item) => item.kind === "calculation" && item.target && item.reference);
  const requiredTotal = calculations.length > 0 ? calculations.length : (exam?.required.length ?? 0);
  const parsed = parseDerivation(deliverable);
  if (parsed.error) {
    return { error: parsed.error, operational: null, target, summary: parsed.error, steps: [], requiredFound: 0, requiredTotal };
  }
  const runnable = parsed.steps.filter((step) => step.error === null && !step.declaration);
  const report = runnable.length
    ? await checkDerivation({
        steps: runnable.map((step) => ({ line: step.line, name: step.name, expr: step.expr })),
        target,
        reference: selected?.reference || exam?.reference || "",
        required: calculations.length > 0 ? [] : (exam?.required ?? []),
        imports: parsed.imports,
        checks: calculations.map((item) => ({ name: item.target, expr: item.reference })),
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
  const secrets = [
    exam?.reference ?? "",
    ...(exam?.required ?? []),
    ...(exam?.exercises ?? []).map((item) => item.reference),
  ];
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
  const missed = (report?.required ?? []).filter((item) => item.status === "failed").map((item) => item.explanation);
  const summary = !report
    ? (steps[0]?.explanation ?? "Write a calculation to run.")
    : ran === 0
      ? (steps[0]?.explanation ?? "Write a calculation to run.")
      : missed.length > 0
        ? `${ranText} ${missed.join(" ")}`
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
