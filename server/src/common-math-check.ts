import { ComputeEngine, type Expression } from "@cortex-js/compute-engine";
import { parseAction, runOperation } from "common-math/engine";

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
 * Run the expression the student wrote and compare it with the stored result.
 * The note never includes that stored result.
 */
export async function checkCommonMathAnswer(input: {
  latex: string;
  action: string;
  given: string[];
  reference: string;
}): Promise<MathCheck> {
  const parsed = parseAction(input.action.trim());
  if (!parsed.ok) return { passed: false, operational: false, note: parsed.message };
  const latex = bindGiven(input.latex, input.given).trim();
  if (!latex) return { passed: false, operational: false, note: "Write an expression to run." };
  let result;
  try {
    result = await runOperation({ latex, operation: parsed.operation, timeoutMs: 8000 });
  } catch {
    return { passed: false, operational: true, note: "The calculation did not finish." };
  }
  if (result.status === "timeout") {
    return { passed: false, operational: true, note: "The calculation took too long and was stopped." };
  }
  if (result.status !== "success" || !result.resultLatex) {
    return {
      passed: false,
      operational: false,
      note: result.message?.trim() || "This expression did not produce a result.",
    };
  }
  const passed = sameLatex(result.resultLatex, bindGiven(input.reference, input.given));
  return { passed, operational: false, note: passed ? "Matches." : "Does not match." };
}
