import {
  AppError,
  type AiStatus,
  classifyOpenRouterStatus,
  ModelReviewPackSchema,
  OpenRouterErrorCode,
  OutlineChapterSchema,
  passageExistsInSource,
  QuizQuestionSchema,
} from "@progress-island/shared";
import { z } from "zod";
import { aiConfigured, config } from "./config.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const AUTH_URL = "https://openrouter.ai/api/v1/key";
const MODELS_URL = "https://openrouter.ai/api/v1/models";

function requireAi(): { key: string; model: string } {
  if (!config.openRouterKey || !config.openRouterModel) {
    throw new AppError(
      "Configure OpenRouter to enable AI. Set OPENROUTER_API_KEY and OPENROUTER_MODEL in your local .env file.",
      OpenRouterErrorCode.missing_config,
      400,
    );
  }
  return { key: config.openRouterKey, model: config.openRouterModel };
}

export function getAiStatus(): AiStatus {
  return {
    configured: aiConfigured(),
    hasKey: Boolean(config.openRouterKey),
    model: config.openRouterModel || null,
    lastError: null,
  };
}

export async function testOpenRouterConnection(): Promise<{
  ok: true;
  modelAvailable: boolean;
}> {
  const { key, model } = requireAi();
  const res = await fetch(AUTH_URL, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  if (!res.ok) {
    const classified = classifyOpenRouterStatus(res.status, text);
    throw new AppError(classified.message, classified.code, res.status);
  }
  const modelsRes = await fetch(MODELS_URL, {
    headers: { Authorization: `Bearer ${key}` },
  });
  let modelAvailable = true;
  if (modelsRes.ok) {
    const body = (await modelsRes.json()) as { data?: { id: string }[] };
    modelAvailable = Boolean(body.data?.some((m) => m.id === model));
  }
  if (!modelAvailable) {
    throw new AppError(
      "The configured OPENROUTER_MODEL is unavailable. Choose a supported model identifier in .env.",
      OpenRouterErrorCode.unknown_model,
      400,
    );
  }
  return { ok: true, modelAvailable };
}

export async function chatJson<T>(
  schema: z.ZodType<T>,
  system: string,
  user: string,
): Promise<T> {
  const { key, model } = requireAi();
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://127.0.0.1",
      "X-Title": "Progress Island",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    const classified = classifyOpenRouterStatus(res.status, text);
    throw new AppError(classified.message, classified.code, res.status >= 400 ? res.status : 502);
  }
  let parsed: unknown;
  try {
    const body = JSON.parse(text) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("empty");
    parsed = JSON.parse(content);
  } catch {
    throw new AppError(
      "The model response was not valid JSON. No items were saved.",
      OpenRouterErrorCode.validation,
      502,
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      schemaMismatchMessage(result.error),
      OpenRouterErrorCode.validation,
      502,
      result.error.flatten(),
    );
  }
  return result.data;
}

function schemaMismatchMessage(error: z.ZodError): string {
  const issues = error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
    .join("; ");
  return issues
    ? `The model response did not match the required schema (${issues}).`
    : "The model response did not match the required schema.";
}

/** Accept a test, or explain an empty one instead of a bare schema failure. */
export function reviewPackFromModelJson(parsed: unknown): z.infer<typeof ModelReviewPackSchema> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(
      "The model response did not match the required schema.",
      OpenRouterErrorCode.validation,
      502,
    );
  }
  const body = parsed as { questions?: unknown; note?: unknown };
  const rawQuestions = asList(body.questions);
  const parsedQuestions = uniqueQuestionIds(
    rawQuestions
      .map(coerceQuestion)
      .filter((question): question is Record<string, unknown> => Boolean(question)),
  ).map((question) => QuizQuestionSchema.safeParse(question));
  const questions = parsedQuestions.filter((result) => result.success).map((result) => result.data);
  if (questions.length > 0) {
    return { flashcards: [], questions: questions.slice(0, 8) };
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (rawQuestions.length === 0) {
    throw new AppError(
      note || "The model did not return any test questions. Nothing was saved.",
      OpenRouterErrorCode.validation,
      502,
    );
  }
  const failed = parsedQuestions.find((result) => !result.success);
  throw new AppError(
    failed && !failed.success ? schemaMismatchMessage(failed.error) : "The model response did not match the required schema.",
    OpenRouterErrorCode.validation,
    502,
    failed && !failed.success ? failed.error.flatten() : undefined,
  );
}

function uniqueQuestionIds(questions: Record<string, unknown>[]): Record<string, unknown>[] {
  const used = new Set<string>();
  return questions.map((question, index) => {
    const requested = asText(question.id);
    let id = requested || `q${index + 1}`;
    if (used.has(id)) {
      let n = index + 1;
      id = `q${n}`;
      while (used.has(id)) {
        n += 1;
        id = `q${n}`;
      }
    }
    used.add(id);
    return { ...question, id };
  });
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function coerceQuestion(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const question = value as Record<string, unknown>;
  const choices = asList(question.choices)
    .map((choice, index) => {
      if (typeof choice === "string" && choice.trim()) {
        return { id: String.fromCharCode(97 + index), text: choice.trim() };
      }
      if (!choice || typeof choice !== "object") return null;
      const item = choice as Record<string, unknown>;
      const text = asText(item.text ?? item.label);
      if (!text) return null;
      return { id: asText(item.id) || String.fromCharCode(97 + index), text };
    })
    .filter((choice): choice is { id: string; text: string } => Boolean(choice));
  const correctIds = [
    ...asList(question.correctChoiceIds ?? question.correctAnswers).map(asText),
    ...asText(question.correctChoiceId)
      .split(",")
      .map((part) => part.trim()),
  ].filter(Boolean);
  const uniqueCorrect = [...new Set(correctIds)];
  const answer = asText(question.answer ?? question.expected ?? question.correctAnswer);
  const requested = asText(question.kind).toLowerCase();
  const kind =
    requested === "numeric" || requested === "calculation" || requested === "number" || requested === "text"
      ? "numeric"
      : requested === "multi" || requested === "multiple" || requested === "multiselect"
        ? "multi"
        : uniqueCorrect.length > 1
          ? "multi"
          : answer && choices.length < 2
            ? "numeric"
            : "single";
  const base = {
    id: asText(question.id) || "question",
    prompt: asText(question.prompt ?? question.question),
    explanation: asText(question.explanation),
    passage: asText(question.passage ?? question.quote),
    locator: asText(question.locator) || "section",
  };
  if (kind === "numeric") return { ...base, kind, answer };
  if (kind === "multi") return { ...base, kind, choices, correctChoiceIds: uniqueCorrect };
  return { ...base, kind: "single", choices, correctChoiceId: uniqueCorrect[0] ?? "" };
}

const ExtractedOutlineSchema = z.object({
  chapters: z.array(OutlineChapterSchema),
});

const ExtractedBookSchema = z.object({
  title: z.string().optional().default(""),
  author: z.string().nullable().optional().default(null),
  chapters: z.array(OutlineChapterSchema).optional().default([]),
});

export async function extractBookWithAi(sourceText: string) {
  return chatJson(
    ExtractedBookSchema,
    `You identify one book from PDF opening pages and any bookmark list included in the text.
Return JSON {"title":string,"author":string|null,"chapters":[{"number":string|null,"title":string,"pageStart":string|null,"pageEnd":string|null}]}.
Use only a title, author, and chapter titles that appear in the supplied text. Never invent a chapter. If the title or author is not in the text, use an empty title or null author. If a page number is not evidenced, use null.`,
    sourceText.slice(0, 24_000),
  );
}

export async function extractOutlineWithAi(sourceText: string): Promise<
  z.infer<typeof OutlineChapterSchema>[]
> {
  const data = await chatJson(
    ExtractedOutlineSchema,
    `You extract tables of contents or chapter headings from supplied text.
Return JSON {"chapters":[{"number":string|null,"title":string,"pageStart":string|null,"pageEnd":string|null}]}.
Use only titles that appear in the supplied text. Never invent chapters. If page numbers are not evidenced, use null. Do not guess.`,
    sourceText.slice(0, 24_000),
  );
  return data.chapters;
}

export async function generateReviewPackWithAi(input: {
  chapterTitle: string;
  chapterText: string;
}): Promise<z.infer<typeof ModelReviewPackSchema>> {
  if (input.chapterText.trim().length < 80) {
    throw new AppError(
      "Supply the chapter text before generating a review. A title is not enough.",
      "missing_source",
      400,
    );
  }
  const hasNumbers = /[=≈]|\d+\.\d+|\d+\s*\/\s*\d+/.test(input.chapterText);
  const pack = reviewPackFromModelJson(
    await chatJson(
      z.unknown(),
      `Write a closed-book test from ONLY the supplied chapter text. Do not write flashcards.
Return JSON {"questions":[...]} with 6 questions when the text supports them.
Each question is one of:
- kind "single": one correct option. choices:[{id,text}] with 4 options, correctChoiceId
- kind "multi": more than one correct option and at least one wrong option. correctChoiceIds is an array of the correct ids. The prompt must say to select every item that applies.
- kind "numeric": the learner computes a value. No choices. answer is the number or a simple fraction such as "0.5" or "1/2", nothing else.
Rules:
- The text is one chapter body. Lines like "--- PDF page N ---" are page markers, not content.
- Prefer worked numbers, equations, and what changes when an assumption is dropped. Do not ask something the chapter title alone answers.
- ${
  hasNumbers
    ? "The chapter contains numbers. At least two questions must be kind numeric, and each answer must follow from numbers in the passage by a direct calculation."
    : "The chapter has no worked numbers. Do not invent a calculation. Use single and multi only."
}
- Every passage MUST be a verbatim excerpt of the prose (at least 12 characters) and must not include a page-marker line.
- locator should be "PDF page N" when the passage sits under that marker, otherwise a short heading from the text.
- explanation states why the answer is right, without adding facts from outside the text.
- Do not use knowledge outside the supplied text.`,
      `Chapter title: ${input.chapterTitle}\n\n${input.chapterText.slice(0, 24_000)}`,
    ),
  );

  const validQuestions = pack.questions.filter((q) =>
    passageExistsInSource(q.passage, input.chapterText),
  );
  if (validQuestions.length < 1) {
    throw new AppError(
      "Generated items were not grounded in the supplied chapter text and were rejected.",
      OpenRouterErrorCode.grounding,
      502,
    );
  }
  return { flashcards: [], questions: validQuestions };
}
