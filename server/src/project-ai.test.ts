import { describe, expect, it } from "vitest";
import { examCoversTopics } from "./project-ai.js";

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
});
