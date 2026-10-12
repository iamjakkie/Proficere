export type QuestionMode = "single" | "multi" | "numeric";

type Gradable = {
  kind?: string;
  answer?: string;
  correctChoiceId?: string;
  correctChoiceIds?: string[];
  choices?: unknown[];
};

export function questionMode(question: Gradable): QuestionMode {
  if (question.kind === "numeric" || question.kind === "multi" || question.kind === "single") {
    return question.kind;
  }
  if (question.correctChoiceIds && question.correctChoiceIds.length > 1) return "multi";
  if (question.answer && !(question.choices && question.choices.length >= 2)) return "numeric";
  return "single";
}

/** Official check for one test item. The same function runs in the client after the server scores. */
export function gradeAnswer(question: Gradable, raw: string | undefined): boolean {
  const given = (raw ?? "").trim();
  const mode = questionMode(question);
  if (mode === "numeric") return valuesMatch(given, question.answer ?? "");
  if (mode === "multi") {
    const want = new Set(question.correctChoiceIds ?? []);
    const got = new Set(
      given
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    );
    if (want.size === 0 || got.size !== want.size) return false;
    for (const id of want) {
      if (!got.has(id)) return false;
    }
    return true;
  }
  return given.length > 0 && given === (question.correctChoiceId ?? "");
}

function valuesMatch(given: string, expected: string): boolean {
  if (!given || !expected) return false;
  if (compact(given) === compact(expected)) return true;
  const left = parseValue(given);
  const right = parseValue(expected);
  if (left == null || right == null) return false;
  const tolerance = Math.max(1e-4, Math.abs(right) * 0.01);
  return Math.abs(left - right) <= tolerance;
}

function compact(value: string): string {
  return value.trim().replace(/−/g, "-").replace(/\s+/g, "").toLowerCase();
}

function parseValue(value: string): number | null {
  const text = compact(value);
  const fraction = text.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (!Number.isFinite(denominator) || denominator === 0) return null;
    return Number(fraction[1]) / denominator;
  }
  const number = text.match(/^(-?\d+(?:\.\d+)?)(?:[a-z%]+)?$/);
  if (!number) return null;
  const parsed = Number(number[1]);
  return Number.isFinite(parsed) ? parsed : null;
}
