export type PlanePoint = { name: string; x: number; y: number };

/** Read named plane points from exam data. Accepts Matrix([x, y]) and a bmatrix column. */
export function planePoints(given: string[]): PlanePoint[] {
  const points: PlanePoint[] = [];
  for (const item of given) {
    const eq = item.indexOf("=");
    if (eq <= 0) continue;
    const name = item.slice(0, eq).trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) continue;
    const vector = readVector(item.slice(eq + 1));
    if (!vector) continue;
    points.push({ name, x: vector[0], y: vector[1] });
  }
  return points;
}

function readVector(rhs: string): [number, number] | null {
  const text = rhs.trim();
  const bmatrix = text.match(/\\begin\{(?:bmatrix|pmatrix|matrix)\}([\s\S]*?)\\end\{(?:bmatrix|pmatrix|matrix)\}/);
  if (bmatrix) {
    const rows = bmatrix[1]
      .split(/\\\\/)
      .map((row) => row.trim())
      .filter(Boolean);
    if (rows.length === 2) return pair(rows[0], rows[1]);
    if (rows.length === 1 && rows[0].includes("&")) {
      const [left, right] = rows[0].split("&");
      return pair(left, right);
    }
    return null;
  }
  if (text.startsWith("Matrix([") && text.endsWith("])")) {
    const cells = splitTop(text.slice("Matrix([".length, -2));
    if (cells.length === 2) return pair(cells[0], cells[1]);
  }
  return null;
}

function pair(left: string | undefined, right: string | undefined): [number, number] | null {
  if (left == null || right == null) return null;
  const x = evalScalar(left);
  const y = evalScalar(right);
  if (x == null || y == null) return null;
  return [x, y];
}

function splitTop(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Exact-enough arithmetic for coordinates: numbers, pi, sqrt, and + - * /. */
export function evalScalar(input: string): number | null {
  const text = input
    .trim()
    .replace(/\\sqrt\{([^{}]+)\}/g, "sqrt($1)")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\pi/g, "pi")
    .replace(/\s+/g, "");
  if (!text || !/^[0-9pisqrt+\-*/().,]+$/.test(text)) return null;
  try {
    const parsed = parseExpr(text);
    if (!Number.isFinite(parsed.value) || parsed.index !== text.length) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

function parseExpr(text: string): { value: number; index: number } {
  let index = 0;
  const expr = (): number => {
    let value = term();
    while (text[index] === "+" || text[index] === "-") {
      const op = text[index];
      index += 1;
      const right = term();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };
  const term = (): number => {
    let value = factor();
    while (text[index] === "*" || text[index] === "/") {
      const op = text[index];
      index += 1;
      const right = factor();
      value = op === "*" ? value * right : value / right;
    }
    return value;
  };
  const factor = (): number => {
    if (text[index] === "+") {
      index += 1;
      return factor();
    }
    if (text[index] === "-") {
      index += 1;
      return -factor();
    }
    if (text[index] === "(") {
      index += 1;
      const value = expr();
      if (text[index] !== ")") throw new Error("paren");
      index += 1;
      return value;
    }
    if (text.startsWith("sqrt(", index)) {
      index += 5;
      const value = expr();
      if (text[index] !== ")") throw new Error("sqrt");
      index += 1;
      return Math.sqrt(value);
    }
    if (text.startsWith("pi", index) && !/[A-Za-z0-9_]/.test(text[index + 2] ?? "")) {
      index += 2;
      return Math.PI;
    }
    const num = /^\d+(?:\.\d+)?/.exec(text.slice(index));
    if (!num) throw new Error("number");
    index += num[0].length;
    return Number(num[0]);
  };
  return { value: expr(), index };
}
