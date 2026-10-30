import { describe, expect, it } from "vitest";
import { parseDerivation, seedCalculations } from "./derivation.js";
import { preserveExamKey, redactProposal, validateVerificationPlan, type ProjectProposal } from "./projects.js";

describe("derivation exams", () => {
  it("rejects a script that tries to reach past the language", () => {
    expect(parseDerivation("K = __import__('os')").error).toBeTruthy();
    expect(parseDerivation("K = P / (P + R)\nP = 4\nR = 4").steps).toHaveLength(3);
  });

  it("checks a calculation that is not an assignment", () => {
    const parsed = parseDerivation("\\[\nF*x + G*u\n\\]");
    expect(parsed.error).toBeNull();
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0]?.expr).toBe("F*x + G*u");
    expect(parsed.steps[0]?.error).toBeNull();
  });

  it("reads a sympy script with subs and multi-line matrices", () => {
    const parsed = parseDerivation(`from sympy import Matrix, symbols
a, b = symbols('a b')
e0 = Matrix([[3*a + 2*b],
 [2*b]])
e0_outer = e0 * e0.T
P0 = e0_outer.subs({a: 1, b: -1})
z = (e0.subs({a: 1, b: -1}))[0, 0]
`);
    expect(parsed.error).toBeNull();
    expect(parsed.imports).toEqual(["Matrix", "symbols"]);
    expect(parsed.steps.filter((step) => step.declaration).map((step) => step.line)).toEqual([1, 2]);
    expect(parsed.steps.filter((step) => !step.declaration).map((step) => step.name)).toEqual(["e0", "e0_outer", "P0", "z"]);
    expect(parsed.steps.find((step) => step.name === "P0")?.expr).toBe("e0_outer.subs(a, 1).subs(b, -1)");
    expect(parsed.steps.every((step) => step.error === null)).toBe(true);
  });

  it("reads a substitution of a matrix entry inside a column of equations", () => {
    const parsed = parseDerivation(`P = Matrix([[9], [12]])
circle_0 = Eq(x**2 + y**2, r_0**2)
circle_1 = Eq((x-24)**2 + y**2, r_1**2)
circle_2 = Eq(x**2 + (y-32)**2, r_2**2)
verification = Matrix([
circle_0.subs({x: P[0], y: P[1]}),
circle_1.subs({x: P[0], y: P[1]}),
circle_2.subs({x: P[0], y: P[1]})
])
`);
    const verification = parsed.steps.find((step) => step.name === "verification");
    expect(parsed.error).toBeNull();
    expect(verification?.error).toBeNull();
    expect(verification?.expr).toBe(
      "Matrix([ circle_0.subs(x, P[0]).subs(y, P[1]), circle_1.subs(x, P[0]).subs(y, P[1]), circle_2.subs(x, P[0]).subs(y, P[1]) ])",
    );
  });

  it("reads solve with a keyword and equation sides", () => {
    const parsed = parseDerivation(`line_1 = Eq(
simplify(expand(circle_1.lhs - circle_0.lhs)),
simplify(expand(circle_1.rhs - circle_0.rhs))
)
P = solve([line_1, line_2], [x,y], dict=True)[0]
`);
    expect(parsed.steps.find((step) => step.name === "line_1")?.error).toBeNull();
    expect(parsed.steps.find((step) => step.name === "P")?.error).toBeNull();
    expect(parsed.steps.find((step) => step.name === "P")?.expr).toBe("solve([line_1, line_2], [x,y], dict=True)[0]");
  });

  it("turns the displayed exam data into calculations", () => {
    const seeded = seedCalculations([
      "F = \\begin{bmatrix} 1 & 3 \\\\ 0 & 1 \\end{bmatrix}",
      "\\hat{x}_0 = \\begin{bmatrix} 146 \\\\ 4 \\end{bmatrix}",
      "e_0 = \\begin{bmatrix} 3a + 2b \\\\ 2b \\end{bmatrix}",
      "v = 4f",
    ]);
    expect(seeded).toContain("F = Matrix([[1, 3], [0, 1]])");
    expect(seeded).toContain("xhat_0 = Matrix([[146], [4]])");
    expect(seeded).toContain("e_0 = Matrix([[3*a + 2*b], [2*b]])");
    expect(seeded).toContain("v = 4*f");
  });

  it("keeps the exam key off the client payload and restores it on save", () => {
    const stored = {
      exam: {
        prompt: "Assign K.",
        given: ["K = P / (P + R)"],
        target: "K",
        reference: "1/2",
        required: ["P/(P+R)"],
        starter: "",
      },
    } as ProjectProposal;
    const hidden = redactProposal(stored);
    expect(hidden.exam?.reference).toBe("");
    expect(hidden.exam?.required).toEqual([]);
    const kept = preserveExamKey(hidden, stored);
    expect(kept.exam?.reference).toBe("1/2");
    expect(kept.exam?.required).toEqual(["P/(P+R)"]);
  });

  it("hides each exercise answer and restores it with the exam", () => {
    const stored = {
      exam: {
        prompt: "1. Assign speed.",
        given: ["distance = 12"],
        target: "speed",
        reference: "distance/time",
        required: [],
        starter: "",
        exercises: [
          { ask: "Assign `speed`.", given: ["distance = 12", "time = 3"], target: "speed", reference: "distance/time", kind: "calculation" as const },
        ],
      },
    } as ProjectProposal;
    const hidden = redactProposal(stored);
    expect(hidden.exam?.exercises[0]?.reference).toBe("");
    expect(preserveExamKey(hidden, stored).exam?.exercises[0]?.reference).toBe("distance/time");
  });

  it("treats a derivation criterion as ready for an objective exam", () => {
    const plan = validateVerificationPlan([
      {
        id: "steps",
        statement: "Each assignment follows.",
        evidenceRequired: "A derivation.",
        method: "derivation",
        referenceExpression: null,
        tolerance: null,
        knownGood: null,
        faulty: [],
        submissionField: null,
        coverage: "SymPy checks each assignment and required step.",
      },
    ]);
    expect(plan.activation).toBe("ready");
    expect(plan.executionAvailable).toBe(false);
  });
});
