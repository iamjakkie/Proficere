import { describe, expect, it } from "vitest";
import { examInputsArePresent, expressionIsClosed, taskScore, workbookShape } from "./project-ai.js";

const checks = [
  { ask: "The distance is 12 m and the time is 3 s. Assign `speed`.", given: ["distance = 12", "time = 3"], target: "speed", reference: "distance/time", kind: "calculation" },
  { ask: "The speed stays constant for 5 s more. Assign `extra_distance`.", given: ["extra_time = 5"], target: "extra_distance", reference: "speed*extra_time", kind: "calculation" },
  { ask: "Which repeated measurement would show the speed was not constant?", given: [], target: "", reference: "", kind: "theory" },
];

describe("task score", () => {
  it("counts matching tasks and passes at seven out of ten", () => {
    const row = (passed: boolean) => ({ passed, operational: false as const });
    expect(taskScore([row(true), row(false), row(true)])).toEqual({ grade: "2/3", passed: false, complete: true });
    expect(taskScore([...Array(9).fill(row(true)), row(false)])).toEqual({ grade: "9/10", passed: true, complete: true });
    expect(taskScore([...Array(6).fill(row(true)), ...Array(4).fill(row(false))])).toEqual({
      grade: "6/10",
      passed: false,
      complete: true,
    });
    expect(taskScore([
      { passed: true, operational: false },
      { passed: false, operational: true },
    ]).complete).toBe(false);
    expect(taskScore([row(true), row(true)]).passed).toBe(true);
  });
});

describe("exam coverage", () => {
  it("rejects one long scenario and a single formula", () => {
    expect(workbookShape({ exercises: [] })).toBe(false);
    expect(workbookShape({ exercises: checks.slice(0, 1) })).toBe(false);
    expect(
      workbookShape({
        exercises: [
          {
            ask: "Explain the physical floor. Explain the mathematical model. Explain the measurements. Propose another observation. Describe the evidence against the model.",
            given: ["length = 8"],
            target: "volume",
            reference: "length*width*height",
            kind: "calculation",
          },
          ...checks,
        ],
      }),
    ).toBe(false);
  });

  it("accepts a short workbook of separate checks", () => {
    expect(workbookShape({ exercises: checks })).toBe(true);
    expect(workbookShape({ exercises: checks.map((item) => ({ ...item, kind: "theory", target: "", reference: "" })) })).toBe(false);
  });

  it("keeps a numeric answer only when the exam shows the inputs", () => {
    expect(expressionIsClosed("Rational(3, 4)")).toBe(true);
    expect(expressionIsClosed("Matrix([[2, 0], [0, 3]])")).toBe(true);
    expect(expressionIsClosed("P/(P+R)")).toBe(false);
    const numeric = {
      target: "command_cost",
      reference: "Rational(3, 4)",
      required: ["Matrix([[2, 0], [0, 3]])"],
    };
    expect(
      examInputsArePresent({
        ...numeric,
        prompt: "Recover the command for `u_test` and `v_target`, then assign `command_cost`.",
        given: [],
      }),
    ).toBe(false);
    expect(
      examInputsArePresent({
        ...numeric,
        prompt: "Evaluate K at P = 9 and R = 3.",
        given: ["p = K**2*R + (1-K)**2*P"],
      }),
    ).toBe(true);
    expect(
      examInputsArePresent({
        prompt: "Assign `command_cost` for x = A*u + b.",
        given: [],
        target: "command_cost",
        reference: "(a11*u1 + b1)**2",
        required: ["Matrix([[a11, a12], [a21, a22]])"],
      }),
    ).toBe(true);
  });
});
