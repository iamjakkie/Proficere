export type DerivationStep = {
  line: number;
  name: string;
  expr: string;
  shown: string;
  error: string | null;
  declaration?: boolean;
};

export type ParsedDerivation = {
  steps: DerivationStep[];
  assumptions: string[];
  notes: { line: number; text: string }[];
  imports: string[];
  error: string | null;
};

/** `from sympy import Eq, solve` names. A star import asks for the names already available. */
export function sympyImports(line: string): string[] | null {
  const trimmed = line.trim();
  if (trimmed === "from sympy import *") return [];
  const match = trimmed.match(/^from\s+sympy\s+import\s+(.+)$/);
  if (!match) return null;
  const names: string[] = [];
  for (const part of match[1].split(",")) {
    const name = part.trim();
    if (!NAME.test(name)) return null;
    names.push(name);
  }
  return names;
}

const SAFE = /^[A-Za-z0-9_+\-*/^().,\s<>[\].=]+$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

function safe(expr: string): boolean {
  return expr.length > 0 && expr.length <= 2000 && !expr.includes("__") && SAFE.test(expr);
}

function readBrace(source: string, open: number): { body: string; end: number } | null {
  if (source[open] !== "{") return null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return { body: source.slice(open + 1, index), end: index + 1 };
    }
  }
  return null;
}

function replaceTwoArg(source: string, command: string): string {
  const needle = `\\${command}`;
  let out = "";
  for (let index = 0; index < source.length; ) {
    if (source.startsWith(needle, index) && source[index + needle.length] === "{") {
      const first = readBrace(source, index + needle.length);
      const second = first && source[first.end] === "{" ? readBrace(source, first.end) : null;
      if (!first || !second) return source;
      const atom = (value: string) => (/^[A-Za-z0-9_.]+$/.test(value) ? value : `(${value})`);
      out += `${atom(replaceTwoArg(first.body, command).trim())}/${atom(replaceTwoArg(second.body, command).trim())}`;
      index = second.end;
      continue;
    }
    out += source[index];
    index += 1;
  }
  return out;
}

function replaceSqrt(source: string): string {
  const needle = "\\sqrt";
  let out = "";
  for (let index = 0; index < source.length; ) {
    if (source.startsWith(needle, index) && source[index + needle.length] === "{") {
      const body = readBrace(source, index + needle.length);
      if (!body) return source;
      out += `sqrt(${replaceSqrt(body.body)})`;
      index = body.end;
      continue;
    }
    out += source[index];
    index += 1;
  }
  return out;
}

function translatePiece(input: string): string {
  let text = input;
  text = replaceTwoArg(text, "dfrac");
  text = replaceTwoArg(text, "frac");
  text = replaceSqrt(text);
  text = text.replace(/\\hat\{([A-Za-z])\}(?:_\{(\d+)\}|_(\d+))?/g, (_, letter: string, braced?: string, plain?: string) => {
    const sub = braced || plain;
    return sub ? `${letter}hat_${sub}` : `${letter}hat`;
  });
  text = text.replace(/\\cdot|\\times/g, "*");
  text = text.replace(/\)\^\{T\}|\)\^T/g, ").T");
  text = text.replace(/([A-Za-z0-9_])\^\{T\}|([A-Za-z0-9_])\^T/g, (_, first?: string, second?: string) => `${first || second}.T`);
  text = text.replace(/(\d)(?=[A-Za-z])/g, "$1*");
  return text;
}

function replaceMatrices(source: string): string {
  const pattern = /\\begin\{(?:bmatrix|pmatrix|matrix)\}([\s\S]*?)\\end\{(?:bmatrix|pmatrix|matrix)\}/;
  let text = source;
  for (let guard = 0; guard < 8; guard += 1) {
    const match = pattern.exec(text);
    if (!match || match.index === undefined) break;
    const rows = match[1]
      .split(/\\\\/)
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => `[${row.split("&").map((cell) => translatePiece(cell).trim()).join(", ")}]`);
    const matrix = `Matrix([${rows.join(", ")}])`;
    text = text.slice(0, match.index) + matrix + text.slice(match.index + match[0].length);
  }
  return text;
}

function splitComma(source: string): string[] {
  const parts: string[] = [];
  let depthCount = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(" || char === "[" || char === "{") depthCount += 1;
    else if (char === ")" || char === "]" || char === "}") depthCount -= 1;
    else if (char === "," && depthCount === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** `.subs({x: P[0], y: P[1]})` becomes `.subs(x, P[0]).subs(y, P[1])`, which the checker can read. */
function expandSubs(source: string): string {
  let out = "";
  for (let index = 0; index < source.length; ) {
    const call = ".subs(";
    if (!source.startsWith(call, index)) {
      out += source[index];
      index += 1;
      continue;
    }
    let cursor = index + call.length;
    while (source[cursor] === " ") cursor += 1;
    if (source[cursor] !== "{") {
      out += source[index];
      index += 1;
      continue;
    }
    const body = readBrace(source, cursor);
    if (!body || source[body.end] !== ")") {
      out += source[index];
      index += 1;
      continue;
    }
    const pairs = splitComma(body.body);
    const chain: string[] = [];
    let valid = pairs.length > 0;
    for (const pair of pairs) {
      const colon = pair.indexOf(":");
      const key = colon > 0 ? pair.slice(0, colon).trim() : "";
      const value = colon > 0 ? pair.slice(colon + 1).trim() : "";
      if (!NAME.test(key) || !safe(value)) {
        valid = false;
        break;
      }
      chain.push(`.subs(${key}, ${value})`);
    }
    if (!valid) {
      out += source[index];
      index += 1;
      continue;
    }
    out += chain.join("");
    index = body.end + 1;
  }
  return out;
}

function isPrelude(text: string): boolean {
  const line = text.trim();
  return /^(?:from\s+\S+\s+import\s+|import\s+)/.test(line) || /(?:^|=\s*)symbols\s*\(/.test(line);
}

export function translateCalculation(input: string): string {
  let text = input.trim();
  text = text.replace(/\\\[|\\\]|\\\(|\\\)|\$\$|\$/g, "");
  text = text.replace(/\\(?:quad|qquad|,|;|:|!)/g, " ");
  text = text.replace(/\\left|\\right/g, "");
  text = replaceMatrices(text);
  text = translatePiece(text);
  text = expandSubs(text);
  text = text.replace(/\s+/g, " ").trim().replace(/,\s*$/, "");
  return text;
}

function depth(text: string): number {
  let count = 0;
  for (const char of text) {
    if (char === "(" || char === "[" || char === "{") count += 1;
    else if (char === ")" || char === "]" || char === "}") count -= 1;
  }
  return count;
}

function unfinished(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (depth(trimmed) !== 0) return true;
  if (/\\begin\{/.test(trimmed) && !/\\end\{/.test(trimmed)) return true;
  return /[+\-*/\\,]$/.test(trimmed);
}

function isDelimiter(text: string): boolean {
  return text === "\\[" || text === "\\]" || text === "\\(" || text === "\\)" || text === "$$" || text === "$";
}

function logicalLines(source: string): { line: number; text: string }[] {
  const rows: { line: number; text: string }[] = [];
  let buffer = "";
  let start = 1;
  const flush = () => {
    if (buffer.trim()) rows.push({ line: start, text: buffer.trim() });
    buffer = "";
  };
  source.split(/\n/).forEach((raw, index) => {
    const line = raw.trim();
    const lineNo = index + 1;
    if (!buffer && (!line || line.startsWith("#") || /^assume\b/i.test(line) || isDelimiter(line) || isPrelude(line))) return;
    if (!buffer) start = lineNo;
    buffer = buffer ? `${buffer} ${line}` : line;
    if (!unfinished(buffer)) flush();
  });
  flush();
  return rows;
}

function splitStatements(text: string): string[] {
  const parts: string[] = [];
  let depthCount = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(" || char === "[" || char === "{") depthCount += 1;
    else if (char === ")" || char === "]" || char === "}") depthCount -= 1;
    else if (char === "," && depthCount === 0 && /^\s*(?:\\?[A-Za-z].*)?=/.test(text.slice(index + 1))) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

function splitAssign(text: string): { name: string; expr: string } | { expr: string } {
  let depthCount = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(" || char === "[" || char === "{") depthCount += 1;
    else if (char === ")" || char === "]" || char === "}") depthCount -= 1;
    else if (char === "=" && depthCount === 0) {
      return { name: text.slice(0, index).trim(), expr: text.slice(index + 1).trim() };
    }
  }
  return { expr: text.trim() };
}

export function parseDerivation(source: string): ParsedDerivation {
  const empty: ParsedDerivation = { steps: [], assumptions: [], notes: [], imports: [], error: null };
  const imports: string[] = [];
  if (source.includes("__")) {
    return { ...empty, error: "This derivation uses a form the checker does not read." };
  }
  const steps: DerivationStep[] = [];
  const assumptions: string[] = [];
  const notes: { line: number; text: string }[] = [];
  const consumed = new Set<number>();
  source.split(/\n/).forEach((raw, index) => {
    const line = raw.trim();
    const lineNo = index + 1;
    if (!line || isDelimiter(line)) return;
    if (isPrelude(line)) {
      const imported = line.trim().startsWith("from sympy import") ? sympyImports(line) : null;
      if (line.trim().startsWith("from sympy import") && !imported) {
        steps.push({
          line: lineNo,
          name: line,
          expr: "",
          shown: line,
          error: "Use from sympy import Name. Separate names with commas.",
          declaration: true,
        });
      } else {
        imports.push(...(imported ?? []));
        steps.push({
          line: lineNo,
          name: line,
          expr: "",
          shown: line,
          error: null,
          declaration: true,
        });
      }
      consumed.add(lineNo);
      return;
    }
    if (line.startsWith("#")) {
      notes.push({ line: lineNo, text: line.slice(1).trim() });
      consumed.add(lineNo);
      return;
    }
    if (/^assume\b/i.test(line)) {
      const body = translateCalculation(line.replace(/^assume\s*/i, ""));
      assumptions.push(body);
      consumed.add(lineNo);
      if (!safe(body)) {
        steps.push({
          line: lineNo,
          name: "",
          expr: "",
          shown: line,
          error: `Line ${lineNo} is not an assumption the checker can read.`,
        });
      }
    }
  });
  let calc = 0;
  for (const row of logicalLines(source)) {
    if (consumed.has(row.line) && !unfinished(row.text) && !row.text.includes("=") && !row.text.startsWith("assume")) continue;
    if (/^assume\b/i.test(row.text) && !unfinished(row.text)) continue;
    for (const statement of splitStatements(row.text.replace(/^assume\s*/i, ""))) {
      if (isPrelude(statement)) continue;
      const translated = translateCalculation(statement);
      const assigned = splitAssign(translated);
      if ("name" in assigned) {
        const expr = assigned.expr.trim();
        const readable = NAME.test(assigned.name) && safe(expr);
        steps.push({
          line: row.line,
          name: assigned.name,
          expr: readable ? expr : "",
          shown: assigned.name,
          error: readable ? null : `Line ${row.line} could not be read as a calculation.`,
        });
        continue;
      }
      calc += 1;
      const expr = assigned.expr.trim();
      const readable = safe(expr);
      steps.push({
        line: row.line,
        name: `calc${calc}`,
        expr: readable ? expr : "",
        shown: expr || statement,
        error: readable ? null : `Line ${row.line} could not be read as a calculation.`,
      });
    }
  }
  if (!steps.some((step) => !step.declaration)) {
    return { ...empty, assumptions, notes, imports, error: "Write a calculation to run." };
  }
  steps.sort((left, right) => left.line - right.line);
  return { steps, assumptions, notes, imports, error: null };
}

export function seedCalculations(given: string[]): string {
  const parsed = parseDerivation(given.join("\n"));
  return parsed.steps
    .filter((step) => step.error === null && !step.declaration && step.shown === step.name)
    .map((step) => `${step.name} = ${step.expr}`)
    .join("\n");
}
