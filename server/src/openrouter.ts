import {
  AppError,
  type AiStatus,
  classifyOpenRouterStatus,
  ModelReviewPackSchema,
  OpenRouterErrorCode,
  OutlineChapterSchema,
  passageExistsInSource,
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

async function chatJson<T>(
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
      "The model response did not match the required schema.",
      OpenRouterErrorCode.validation,
      502,
      result.error.flatten(),
    );
  }
  return result.data;
}

const ExtractedOutlineSchema = z.object({
  chapters: z.array(OutlineChapterSchema),
});

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
  const pack = await chatJson(
    ModelReviewPackSchema,
    `Create source-grounded study items from ONLY the supplied chapter text.
Return JSON with:
- flashcards: about 5 items {id, front, back, passage, locator}
- questions: about 3 multiple-choice items {id, prompt, choices:[{id,text}], correctChoiceId, explanation, passage, locator}
Rules:
- The text is one chapter body. Lines like "--- PDF page N ---" are page markers, not content.
- Test explanations, distinctions, assumptions, and what fails when an assumption is dropped. Do not ask something that the chapter title alone answers.
- If the chapter contains mathematics, keep that notation and include at least one item that uses it.
- Every passage MUST be a verbatim excerpt of the prose (at least 12 characters) and must not include a page-marker line.
- locator should be "PDF page N" when the passage sits under that marker, otherwise a short heading from the text.
- Do not use knowledge outside the supplied text.`,
    `Chapter title: ${input.chapterTitle}\n\n${input.chapterText.slice(0, 24_000)}`,
  );

  const validCards = pack.flashcards.filter((c) =>
    passageExistsInSource(c.passage, input.chapterText),
  );
  const validQuestions = pack.questions.filter((q) =>
    passageExistsInSource(q.passage, input.chapterText),
  );
  if (validCards.length < 1 || validQuestions.length < 1) {
    throw new AppError(
      "Generated items were not grounded in the supplied chapter text and were rejected.",
      OpenRouterErrorCode.grounding,
      502,
    );
  }
  return { flashcards: validCards, questions: validQuestions };
}
