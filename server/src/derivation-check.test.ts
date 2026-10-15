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
