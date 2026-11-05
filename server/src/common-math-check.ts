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

function equalSides(expr: Expression): Expression[] | null {
  const json: unknown = expr.json;
  if (!Array.isArray(json) || json[0] !== "Equal" || json.length < 3) return null;
  return json.slice(1).map((item) => expr.engine.box(item as Expression));
}

/**
 * A written statement such as d/dx x^2 = 2x. The derivative the student wrote
 * is evaluated so the two sides can be compared. A bare derivative is left alone.
 */
function statedValue(expr: Expression): Expression | null {
  const sides = equalSides(expr);
  if (!sides) return null;
  let values: Expression[];
  try {
    values = sides.map((side) => side.evaluate());
  } catch {
    return null;
  }
  const first = values[0];
  if (!first || values.some((value) => !sameExpression(value, first))) return null;
  return first;
}

/** MathLive writes the differential as `\differentialD`, which the checker reads as d. */
function readableLatex(latex: string): string {
  return latex.replaceAll("\\differentialD", "\\mathrm{d}");
}

const CHAIN_BREAK = "\u0000";

/** Steps of a solution chain, split on arrows and on rows of display math. */
function chainSteps(latex: string): string[] {
  let text = readableLatex(latex).trim();
  const displayed = text.match(/^\\displaylines\s*\{([\s\S]*)\}\s*$/);
  if (displayed?.[1]) text = displayed[1];
  text = text
    .replace(/\\\\(?:\[[^\]]*\])?/g, CHAIN_BREAK)
    .replace(/\\(?:longrightarrow|rightarrow|Rightarrow|implies|to)\b/g, CHAIN_BREAK);
  const steps = text
    .split(CHAIN_BREAK)
    .map((step) => step.trim())
    .filter((step) => step.length > 0);
  return steps.length > 0 ? steps : [text];
}

function expressionHead(expr: Expression): string | null {
  const json: unknown = expr.json;
  return Array.isArray(json) && typeof json[0] === "string" ? json[0] : null;
}

/** Solutions of an equation or a disjunction of equations, such as x=-1 or x=1. */
function solutionSet(engine: ComputeEngine, latex: string): Expression | null {
  let expr: Expression;
  try {
    expr = engine.parse(latex);
  } catch {
    return null;
  }
  if (!expr.isValid) return null;
  try {
    const solved = engine.box(["Solve", expr]).evaluate();
    return listItems(solved) ? solved : null;
  } catch {
    return null;
  }
}

/** Every step has the same solutions, and those solutions are the stored answer. */
function chainMatches(engine: ComputeEngine, steps: string[], reference: Expression): boolean {
  const sets: Expression[] = [];
  for (const step of steps) {
    const set = solutionSet(engine, step);
    if (!set) return false;
    sets.push(set);
  }
  const first = sets[0];
  if (!first || sets.some((set) => !sameExpression(set, first))) return false;
  return sameExpression(first, reference);
}

/** Mathematical equality. A matching decimal, a reordered list, a true equation, and an equivalent solution chain all count. */
export function sameLatex(leftLatex: string, rightLatex: string): boolean {
  const ce = new ComputeEngine();
  const steps = chainSteps(leftLatex);
  let right: Expression;
  try {
    right = ce.parse(readableLatex(rightLatex));
  } catch {
    return false;
  }
  if (!right.isValid) return false;
  if (steps.length > 1) return chainMatches(ce, steps, right);
  let left: Expression;
  try {
    left = ce.parse(steps[0] ?? "");
  } catch {
    return false;
  }
  if (!left.isValid) return false;
  const stated = statedValue(left);
  if (equalSides(left)) return stated != null && sameExpression(stated, right);
  if (expressionHead(left) === "Or") {
    const solved = solutionSet(ce, steps[0] ?? "");
    return solved != null && sameExpression(solved, right);
  }
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
