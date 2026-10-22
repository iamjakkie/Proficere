import { describe, expect, it } from "vitest";
import { examCoversTopics, examInputsArePresent, expressionIsClosed } from "./project-ai.js";

const topics = [
  "State Extrapolation Equation",
  "Covariance Extrapolation Equation",
  "Measurement Equation",
];

describe("exam coverage", () => {
  it("rejects an exam that uses one equation from a longer section", () => {
    expect(examCoversTopics("Differentiate the variance and solve for K.", 1, topics)).toBe(false);
    expect(
      examCoversTopics(
        "Use the State Extrapolation Equation, the Covariance Extrapolation Equation, and the Measurement Equation.",
        2,
        topics,
      ),
    ).toBe(false);
  });

  it("accepts one scenario that names every topic and checks each step", () => {
    const prompt = topics.join(", ");
    expect(examCoversTopics(prompt, topics.length, topics, 2)).toBe(true);
    expect(examCoversTopics(prompt, topics.length, topics, 0)).toBe(false);
    expect(examCoversTopics("Any single derivation", 1, [])).toBe(true);
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
