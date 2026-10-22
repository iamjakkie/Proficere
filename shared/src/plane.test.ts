import { describe, expect, it } from "vitest";
import { evalScalar, planePoints } from "./plane.js";

describe("plane points", () => {
  it("reads a column and an exact square root", () => {
    const points = planePoints([
      "C = Matrix([0, 0])",
      "A = Matrix([6, 0])",
      "B = Matrix([3, 3*sqrt(3)])",
      "omega = pi/6",
      "v = 2",
    ]);
    expect(points.map((point) => point.name)).toEqual(["C", "A", "B"]);
    expect(points[2]?.y).toBeCloseTo(3 * Math.sqrt(3), 8);
    expect(evalScalar("\\frac{\\pi}{6}")).toBeCloseTo(Math.PI / 6, 8);
  });
});
