import { describe, expect, it } from "vitest";
import { parseDerivation, type ProjectProposal } from "@progress-island/shared";
import { checkDerivation } from "./derivation-check.js";
import { reviewExam } from "./exam-review.js";

describe("sympy derivation checker", () => {
  it("accepts the formula before the substitution and rejects a bare value", async () => {
    const passed = await checkDerivation({
      steps: [
        { line: 1, name: "K", expr: "P/(P+R)" },
        { line: 2, name: "P", expr: "4" },
        { line: 3, name: "R", expr: "4" },
        { line: 4, name: "K", expr: "P/(P+R)" },
      ],
      target: "K",
      reference: "1/2",
      required: ["P/(P+R)"],
    });
    expect(passed.ok).toBe(true);
    expect(passed.targetMatches).toBe(true);
    expect(passed.required.every((item) => item.status === "passed")).toBe(true);
    expect(passed.steps.at(-1)?.value).toBe("1/2");

    const forecast = await checkDerivation({
      steps: [
        { line: 1, name: "F", expr: "Matrix([[1, 0], [0, 1]])" },
        { line: 2, name: "P", expr: "Matrix([[2, 0], [0, 3]])" },
        { line: 3, name: "calc1", expr: "F*P*F.T" },
      ],
      target: "S",
      reference: "Matrix([[2, 0], [0, 3]])",
      required: ["Matrix([[2, 0], [0, 3]])"],
    });
    expect(forecast.ok).toBe(true);
    expect(forecast.steps.at(-1)?.value).toBe("Matrix([[2, 0], [0, 3]])");
    expect(forecast.required[0]?.status).toBe("passed");

    const substituted = await checkDerivation({
      steps: [
        { line: 1, name: "M", expr: "Matrix([[a, 0], [0, 1]])" },
        { line: 2, name: "v", expr: "M.subs(a, 3)[0, 0]" },
      ],
      target: "v",
      reference: "3",
      required: ["3"],
    });
    expect(substituted.ok).toBe(true);
    expect(substituted.targetMatches).toBe(true);
    expect(substituted.steps.at(-1)?.value).toBe("3");

    const missing = await checkDerivation({
      steps: [{ line: 1, name: "P0", expr: "e_outer.subs(a, 1)" }],
      target: "P0",
      reference: "1",
      required: ["1"],
    });
    expect(missing.steps[0]?.explanation).toBe("e_outer is undefined.");

    const named = await checkDerivation({
      steps: [
        { line: 1, name: "u", expr: "Matrix([u1, u2])" },
        { line: 2, name: "row", expr: "Matrix([2*u1 + 3, u2])" },
      ],
      target: "row",
      reference: "Matrix([2*u1 + 3, u2])",
      required: ["Matrix([u1, u2])"],
    });
    expect(named.ok).toBe(true);
    expect(named.error).toBeNull();
    expect(named.targetMatches).toBe(true);
    expect(named.required[0]?.status).toBe("passed");
    expect(named.steps[0]?.value).toContain("u1");

    const matrices = await checkDerivation({
      steps: [
        { line: 1, name: "A", expr: "Matrix([[a, b], [c, d]])" },
        { line: 2, name: "vec", expr: "Matrix([x, y])" },
        { line: 3, name: "moved", expr: "A * vec" },
        { line: 4, name: "back", expr: "A.inv() * moved" },
        { line: 5, name: "scalar", expr: "3" },
        { line: 6, name: "mixed", expr: "scalar - vec" },
      ],
      target: "back",
      reference: "Matrix([x, y])",
      required: ["A * vec"],
    });
    expect(matrices.ok).toBe(true);
    expect(matrices.steps[2]?.value).toContain("a*x");
    expect(matrices.steps[3]?.status).toBe("passed");
    expect(matrices.steps[3]?.value).toContain("Matrix");
    expect(matrices.targetMatches).toBe(true);
    expect(matrices.steps[5]?.explanation).toBe("scalar is not a matrix, and vec is a matrix.");

    const missingMatrix = await checkDerivation({
      steps: [
        { line: 1, name: "u", expr: "Matrix([u1, u2])" },
        { line: 2, name: "x", expr: "A * u + b" },
      ],
      target: "x",
      reference: "Matrix([u1, u2])",
      required: [],
    });
    expect(missingMatrix.steps[1]?.explanation).toBe("A and b are undefined.");

    const angle = await checkDerivation({
      steps: [
        { line: 1, name: "CA", expr: "Matrix([6, 0])" },
        { line: 2, name: "CB", expr: "Matrix([3, 3*sqrt(3)])" },
        { line: 3, name: "turn_angle", expr: "acos((CA.dot(CB)) / (sqrt(CA.dot(CA)) * sqrt(CB.dot(CB))))" },
      ],
      target: "turn_angle",
      reference: "pi/3",
      required: [],
    });
    expect(angle.steps[2]?.status).toBe("passed");
    expect(angle.steps[2]?.value).toBe("pi/3");
    expect(angle.targetMatches).toBe(true);

    const equation = await checkDerivation({
      steps: [{ line: 2, name: "relation", expr: "Eq(x, y + 1)" }],
      target: "relation",
      reference: "Eq(x, y + 1)",
      required: ["Eq(x, y + 1)"],
    });
    expect(equation.steps[0]?.status).toBe("passed");
    expect(equation.steps[0]?.value).toBe("Eq(x - y, 1)");
    expect(equation.targetMatches).toBe(true);
    expect(equation.required[0]?.status).toBe("passed");

    const bareGamma = await checkDerivation({
      steps: [{ line: 1, name: "total", expr: "gamma + 1" }],
      target: "total",
      reference: "gamma + 1",
      required: [],
    });
    expect(bareGamma.steps[0]?.value).toBe("gamma + 1");

    const calledGamma = await checkDerivation({
      steps: [{ line: 1, name: "value", expr: "gamma(1)" }],
      target: "value",
      reference: "1",
      required: [],
    });
    expect(calledGamma.steps[0]?.status).toBe("passed");
    expect(calledGamma.targetMatches).toBe(true);

    const imported = await checkDerivation({
      steps: [{ line: 2, name: "value", expr: "N(pi)" }],
      imports: ["N", "NotASymPyName"],
      target: "value",
      reference: "pi",
      required: [],
    });
    expect(imported.unknownImports).toEqual(["NotASymPyName"]);
    expect(imported.steps[0]?.status).toBe("passed");
    expect(imported.steps[0]?.value?.startsWith("3.14159")).toBe(true);

    const despiteKey = await checkDerivation({
      steps: [{ line: 1, name: "x", expr: "a + 1" }],
      target: "x",
      reference: "a = 1",
      required: ["a = 1"],
    });
    expect(despiteKey.ok).toBe(true);
    expect(despiteKey.steps[0]?.status).toBe("passed");
    expect(despiteKey.steps[0]?.value).toBe("a + 1");
    expect(despiteKey.error).toBe("The stored reference could not be checked.");

    const bare = await checkDerivation({
      steps: [{ line: 1, name: "K", expr: "1/2" }],
      target: "K",
      reference: "1/2",
      required: ["P/(P+R)"],
    });
    expect(bare.ok).toBe(true);
    expect(bare.targetMatches).toBe(true);
    expect(bare.required[0]?.status).toBe("failed");
  });

  it("substitutes a matrix entry into a column of circle equations", async () => {
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
    const runnable = parsed.steps.filter((step) => step.error === null && !step.declaration);
    const report = await checkDerivation({
      steps: runnable.map((step) => ({ line: step.line, name: step.name, expr: step.expr })),
      target: "verification",
      reference: "Matrix([[Eq(225, r_0**2)], [Eq(369, r_1**2)], [Eq(481, r_2**2)]])",
      required: [],
    });
    expect(report.steps.at(-1)?.status).toBe("passed");
    expect(report.steps.at(-1)?.value).toBe("Matrix([[Eq(r_0**2, 225)], [Eq(r_1**2, 369)], [Eq(r_2**2, 481)]])");
    expect(report.targetMatches).toBe(true);
  });

  it("solves two circle lines for the intersection", async () => {
    const parsed = parseDerivation(`radii = Matrix([[15], [sqrt(369)], [sqrt(481)]])
r_0 = radii[0,0]
r_1 = radii[1,0]
r_2 = radii[2,0]
circle_0 = Eq(x**2 + y**2, r_0**2)
circle_1 = Eq((x-24)**2 + y**2, r_1**2)
circle_2 = Eq(x**2 + (y-32)**2, r_2**2)
line_1 = Eq(
simplify(expand(circle_1.lhs - circle_0.lhs)),
simplify(expand(circle_1.rhs - circle_0.rhs))
)
line_2 = Eq(
simplify(expand(circle_2.lhs - circle_0.lhs)),
simplify(expand(circle_2.rhs - circle_0.rhs))
)
P = solve([line_1, line_2], [x,y], dict=True)[0]
`);
    expect(parsed.steps.every((step) => step.error === null)).toBe(true);
    const report = await checkDerivation({
      steps: parsed.steps.filter((step) => !step.declaration).map((step) => ({
        line: step.line,
        name: step.name,
        expr: step.expr,
      })),
      target: "P",
      reference: "0",
      required: [],
    });
    expect(report.steps.map((step) => step.status)).not.toContain("failed");
    expect(report.steps.at(-1)?.value).toBe("{x: 9, y: 12}");
  });

  it("checks vector magnitude, dot, and cross with student values", async () => {
    const magnitude = await checkDerivation({
      steps: [
        { line: 1, name: "resultant", expr: "Matrix([[6], [7], [-2]])" },
        { line: 2, name: "resultant_magnitude", expr: "resultant.norm()" },
      ],
      target: "resultant_magnitude",
      reference: "sqrt(resultant[0]^2+resultant[1]^2+resultant[2]^2)",
      required: [],
      checks: [{ name: "resultant_magnitude", expr: "sqrt(resultant[0]^2+resultant[1]^2+resultant[2]^2)" }],
    });
    expect(magnitude).toMatchObject({ ok: true, error: null, targetMatches: true });
    expect(magnitude.required[0]?.explanation).toBe("resultant_magnitude matches.");

    const product = await checkDerivation({
      steps: [
        { line: 1, name: "U", expr: "Matrix([4,-9,6])" },
        { line: 2, name: "V", expr: "Matrix([-7,2,8])" },
        { line: 3, name: "dot_product", expr: "U.dot(V)" },
      ],
      target: "dot_product",
      reference: "U[0]*V[0]+U[1]*V[1]+U[2]*V[2]",
      required: [],
      checks: [{ name: "dot_product", expr: "U[0]*V[0]+U[1]*V[1]+U[2]*V[2]" }],
    });
    expect(product).toMatchObject({ ok: true, error: null, targetMatches: true });
    expect(product.steps.at(-1)?.value).toBe("2");

    const cross = await checkDerivation({
      steps: [
        { line: 1, name: "P", expr: "Matrix([3,-5,2])" },
        { line: 2, name: "Q", expr: "Matrix([7,4,-6])" },
        { line: 3, name: "cross_product", expr: "P.cross(Q)" },
      ],
      target: "cross_product",
      reference: "Matrix([P[1]*Q[2]-P[2]*Q[1],P[2]*Q[0]-P[0]*Q[2],P[0]*Q[1]-P[1]*Q[0]])",
      required: [],
      checks: [
        {
          name: "cross_product",
          expr: "Matrix([P[1]*Q[2]-P[2]*Q[1],P[2]*Q[0]-P[0]*Q[2],P[0]*Q[1]-P[1]*Q[0]])",
        },
      ],
    });
    expect(cross).toMatchObject({ ok: true, error: null, targetMatches: true });
    expect(cross.steps.at(-1)?.value).toBe("Matrix([[22], [32], [47]])");
  });

  it("checks each named workbook answer", async () => {
    const report = await checkDerivation({
      steps: [
        { line: 1, name: "distance", expr: "12" },
        { line: 2, name: "time", expr: "3" },
        { line: 3, name: "speed", expr: "distance/time" },
        { line: 4, name: "extra_time", expr: "5" },
        { line: 5, name: "extra_distance", expr: "speed*extra_time" },
      ],
      target: "extra_distance",
      reference: "speed*extra_time",
      required: [],
      checks: [
        { name: "speed", expr: "distance/time" },
        { name: "extra_distance", expr: "20" },
      ],
    });
    expect(report.ok).toBe(true);
    expect(report.targetMatches).toBe(true);
    expect(report.required.map((item) => item.explanation)).toEqual(["speed matches.", "extra_distance matches."]);

    const missed = await checkDerivation({
      steps: [
        { line: 1, name: "distance", expr: "12" },
        { line: 2, name: "time", expr: "3" },
        { line: 3, name: "speed", expr: "distance/time" },
      ],
      target: "extra_distance",
      reference: "20",
      required: [],
      checks: [
        { name: "speed", expr: "distance/time" },
        { name: "extra_distance", expr: "20" },
      ],
    });
    expect(missed.targetMatches).toBe(false);
    expect(missed.required.map((item) => item.explanation)).toEqual([
      "speed matches.",
      "extra_distance was not assigned.",
    ]);
  });

  it("scores a workbook as a count of matching tasks", async () => {
    const brief = {
      exam: {
        prompt: "tasks",
        given: [],
        target: "extra_distance",
        reference: "speed*extra_time",
        required: ["distance/time"],
        starter: "",
        exercises: [
          { ask: "Assign `speed` in metres per second.", given: ["distance = 12", "time = 3"], target: "speed", reference: "distance/time", kind: "calculation" },
          { ask: "Assign `extra_distance` in metres.", given: ["extra_time = 5"], target: "extra_distance", reference: "speed*extra_time", kind: "calculation" },
          { ask: "What repeated measurement would show the speed was not constant?", given: [], target: "", reference: "", kind: "theory" },
        ],
      },
    } as ProjectProposal;
    const review = await reviewExam({
      brief,
      deliverable: "",
      gradeWithModel: false,
      tasks: [
        { index: 0, answer: "distance = 12\ntime = 3\nspeed = distance/time" },
        { index: 1, answer: "speed = 4\nextra_time = 5\nextra_distance = 1" },
        { index: 2, answer: "" },
      ],
    });
    expect(review.grade).toBe("1/3");
    expect(review.passed).toBe(false);
    expect(review.notes?.map((note) => note.text)).toEqual([
      "Matches.",
      "extra_distance does not match.",
      "The written answer is blank.",
    ]);
  });
});
