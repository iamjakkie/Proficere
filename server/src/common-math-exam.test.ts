import { describe, expect, it } from "vitest";
import type { ProjectProposal } from "@progress-island/shared";
import { bindGiven, checkCommonMathAnswer, sameLatex } from "./common-math-check.js";
import { reviewExam } from "./exam-review.js";

const brief = {
  exam: {
    prompt: "tasks",
    given: [],
    target: "speed",
    reference: "4",
    required: [],
    starter: "",
    exercises: [
      {
        ask: "A cart travels 12 m in 3 s. Find `speed` in metres per second.",
        given: ["distance = 12", "time = 3"],
        target: "speed",
        reference: "4",
        action: "calculate",
        kind: "calculation" as const,
      },
      {
        ask: "Differentiate x squared.",
        given: [],
        target: "slope",
        reference: "2x",
        action: "differentiate x",
        kind: "calculation" as const,
      },
      {
        ask: "What repeated measurement would show the speed was not constant?",
        given: [],
        target: "",
        reference: "",
        action: "",
        kind: "theory" as const,
      },
    ],
  },
} as unknown as ProjectProposal;

describe("common math exams", () => {
  it("substitutes given names without touching a longer name", () => {
    expect(bindGiven(String.raw`\frac{distance}{time}`, ["time = 3", "distance = 12"])).toBe(String.raw`\frac{12}{3}`);
  });

  it("treats an equivalent result as the same value", () => {
    expect(sameLatex(String.raw`\frac{5}{6}`, String.raw`\frac{5}{6}`)).toBe(true);
    expect(sameLatex("4", String.raw`\frac{12}{3}`)).toBe(true);
    expect(sameLatex("2*x", "2x")).toBe(true);
    expect(sameLatex("x*2", "2x")).toBe(true);
    expect(sameLatex("x+x", "2x")).toBe(true);
    expect(sameLatex(String.raw`\bigl\lbrack1, -1\bigr\rbrack`, String.raw`\bigl\lbrack-1, 1\bigr\rbrack`)).toBe(true);
    expect(sameLatex("4", "5")).toBe(false);
    expect(sameLatex("x", "2x")).toBe(false);
    expect(sameLatex("3x", "2x")).toBe(false);
  });

  it("accepts a true derivative statement and rejects a false one", () => {
    expect(sameLatex(String.raw`\frac{d}{dx}x^{2}=2x`, "2x")).toBe(true);
    expect(sameLatex(String.raw`\frac{d}{\differentialD x}x^2=2x`, "2x")).toBe(true);
    expect(sameLatex("d/dx x^2 = 2x", "2x")).toBe(true);
    expect(sameLatex(String.raw`2\cdot x`, "2x")).toBe(true);
    expect(sameLatex(String.raw`x\cdot2`, "2x")).toBe(true);
    expect(sameLatex(String.raw`\frac{d}{dx}x^{2}=2*x`, "2x")).toBe(true);
    expect(sameLatex(String.raw`\frac{d}{dx}x^{2}=x*2`, "2x")).toBe(true);
    expect(sameLatex(String.raw`\frac{d}{dx}x^{2}=3x`, "2x")).toBe(false);
    expect(sameLatex(String.raw`\frac{d}{\differentialD x}x^2=3x`, "2x")).toBe(false);
    expect(sameLatex(String.raw`\frac{d}{dx}x^{3}=2x`, "2x")).toBe(false);
    expect(sameLatex(String.raw`\frac{d}{dx}x^{2}`, "2x")).toBe(false);
    expect(sameLatex("5=5", "2x")).toBe(false);
  });

  it("grades the written answer and does not solve the task", async () => {
    const review = await reviewExam({
      brief,
      deliverable: "",
      gradeWithModel: false,
      tasks: [
        { index: 0, answer: String.raw`\frac{12}{3}`, action: "calculate" },
        { index: 1, answer: "2x", action: "differentiate x" },
        { index: 2, answer: "" },
      ],
    });
    expect(review.grade).toBe("2/3");
    expect(review.passed).toBe(false);
    expect(review.notes?.map((note) => note.text)).toEqual(["Matches.", "Matches.", "The written answer is blank."]);
    expect(review.notes?.some((note) => note.text.includes("2x") || note.text === "4")).toBe(false);
    expect(review.objective[0]?.coverage).toContain("does not solve");
  });

  it("does not differentiate the expression the student typed", async () => {
    const checked = await checkCommonMathAnswer({
      latex: "x^2",
      reference: "2x",
    });
    expect(checked).toEqual({ passed: false, operational: false, note: "Does not match." });
    const stated = await checkCommonMathAnswer({
      latex: String.raw`\frac{d}{\differentialD x}x^2=2x`,
      reference: "2x",
    });
    expect(stated).toEqual({ passed: true, operational: false, note: "Matches." });
    expect(stated.note.includes("2x")).toBe(false);
    for (const latex of ["x", "3x", String.raw`\frac{d}{dx}x^{2}=3x`]) {
      expect(await checkCommonMathAnswer({ latex, reference: "2x" })).toEqual({
        passed: false,
        operational: false,
        note: "Does not match.",
      });
    }
  });

  it("marks a wrong answer without quoting the key", async () => {
    const checked = await checkCommonMathAnswer({
      latex: "5",
      reference: String.raw`\frac{12}{3}`,
    });
    expect(checked).toEqual({ passed: false, operational: false, note: "Does not match." });
  });
});
