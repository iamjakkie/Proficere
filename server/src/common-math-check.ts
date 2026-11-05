import { ComputeEngine, type Expression } from "@cortex-js/compute-engine";

export type MathCheck = { passed: boolean; operational: boolean; note: string };

/** Replace `name = value` data in an expression. Longer names are replaced first. */
export function bindGiven(latex: string, given: string[]): string {
  const pairs = given
    .flatMap((row) => {
      const match = row.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/);
      if (!match?.[1] || !match[2]) return [];
      return [{ name: match[1], value: match[2].trim() }];
    })
    .sort((left, right) => right.name.length - left.name.length);
  let next = latex;
  for (const { name, value } of pairs) {
    const needsWrap = /[+\-*/^,]/.test(value) && !value.startsWith("(") && !value.startsWith("\\");
    const replacement = needsWrap ? `(${value})` : value;
    const pattern = new RegExp(`(?<![A-Za-z\\\\])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "g");
    next = next.replace(pattern, () => replacement);
  }
  return next;
}

function asNumber(expr: Expression): number | null {
  const [coefficient, rest] = expr.N().toNumericValue();
  if (!rest.isEqual(1)) return null;
  if (typeof coefficient === "number" && Number.isFinite(coefficient)) return coefficient;
  if (coefficient && typeof coefficient === "object" && "num" in coefficient) {
    const value = Number(coefficient.num);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function listItems(expr: Expression): Expression[] | null {
  const json: unknown = expr.json;
  if (!Array.isArray(json) || json[0] !== "List") return null;
  return json.slice(1).map((item) => expr.engine.box(item as Expression));
}

function sameList(left: Expression[], right: Expression[]): boolean {
  if (left.length !== right.length || left.length === 0) return false;
  const used = new Set<number>();
  for (const item of left) {
    const found = right.findIndex((other, index) => {
      if (used.has(index)) return false;
      return sameExpression(item, other);
    });
    if (found < 0) return false;
    used.add(found);
  }
  return true;
}

function sameExpression(left: Expression, right: Expression): boolean {
  const a = left.simplify();
  const b = right.simplify();
  if (a.isEqual(b) === true) return true;
  const aList = listItems(a);
  const bList = listItems(b);
  if (aList && bList) return sameList(aList, bList);
  const aNumber = asNumber(a);
  const bNumber = asNumber(b);
  if (aNumber == null || bNumber == null) return false;
  const scale = Math.max(1, Math.abs(aNumber), Math.abs(bNumber));
  return Math.abs(aNumber - bNumber) <= 1e-6 * scale;
}

/** Mathematical equality. A matching decimal and a reordered solution list both count. */
export function sameLatex(leftLatex: string, rightLatex: string): boolean {
  const ce = new ComputeEngine();
  let left: Expression;
  let right: Expression;
  try {
    left = ce.parse(leftLatex);
    right = ce.parse(rightLatex);
  } catch {
    return false;
  }
  if (!left.isValid || !right.isValid) return false;
  return sameExpression(left, right);
}

/**
 * Compare the answer the student wrote with the stored answer.
 * The stored action is not applied, and the note never includes the stored answer.
 */
export async function checkCommonMathAnswer(input: {
  latex: string;
  reference: string;
}): Promise<MathCheck> {
  const latex = input.latex.trim();
  if (!latex) return { passed: false, operational: false, note: "Write an answer to check." };
  const reference = input.reference.trim();
  if (!reference) return { passed: false, operational: true, note: "This task has no stored answer to check." };
  let passed = false;
  try {
    passed = sameLatex(latex, reference);
  } catch {
    return { passed: false, operational: true, note: "The answer could not be checked." };
  }
  return { passed, operational: false, note: passed ? "Matches." : "Does not match." };
}
