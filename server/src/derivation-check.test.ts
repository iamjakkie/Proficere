import { describe, expect, it } from "vitest";
import { checkDerivation } from "./derivation-check.js";

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
});
