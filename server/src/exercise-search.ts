import {
  AppError,
  EXERCISE_SEARCH_UNCONFIGURED,
  exerciseHitsFromJson,
  searchIsDue,
  searchQueryFromTitles,
} from "@progress-island/shared";
import { config, exerciseSearchConfigured } from "./config.js";
import type { Db } from "./db.js";
import {
  exerciseSearchLastAt,
  exerciseSearchOptIn,
  finishedReadingTitles,
  listActiveSuggestions,
  setExerciseSearchLastAt,
  setExerciseSearchOptIn,
  storeExerciseHits,
} from "./shelf-store.js";
import { logActivity } from "./store.js";

export type ExerciseSearchState = {
  configured: boolean;
  optedIn: boolean;
  lastAt: string | null;
  willSend: string[];
  query: string;
  suggestions: ReturnType<typeof listActiveSuggestions>;
  message: string | null;
};

export function exerciseSearchState(db: Db): ExerciseSearchState {
  const willSend = finishedReadingTitles(db);
  return {
    configured: exerciseSearchConfigured(),
    optedIn: Boolean(exerciseSearchOptIn(db)),
    lastAt: exerciseSearchLastAt(db),
    willSend,
    query: searchQueryFromTitles(willSend),
    suggestions: listActiveSuggestions(db),
    message: exerciseSearchConfigured() ? null : EXERCISE_SEARCH_UNCONFIGURED,
  };
}

type SearchRun = {
  force?: boolean;
  now?: number;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  apiKey?: string;
};

export async function maybeSearch(
  db: Db,
  opts: SearchRun = {},
): Promise<{ ran: boolean; reason: string; added: number }> {
  const endpoint = opts.endpoint ?? config.exerciseSearchEndpoint;
  const apiKey = opts.apiKey ?? config.exerciseSearchApiKey;
  if (!endpoint || !apiKey) return { ran: false, reason: "unconfigured", added: 0 };
  if (!exerciseSearchOptIn(db)) return { ran: false, reason: "opt_in", added: 0 };
  if (!opts.force && !searchIsDue(exerciseSearchLastAt(db), opts.now ?? Date.now())) {
    return { ran: false, reason: "interval", added: 0 };
  }
  const titles = finishedReadingTitles(db);
  const query = searchQueryFromTitles(titles);
  if (!query) return { ran: false, reason: "nothing_finished", added: 0 };
  const before = listActiveSuggestions(db).length;
  setExerciseSearchLastAt(db);
  const hits = await fetchExerciseHits(endpoint, apiKey, query, opts.fetchImpl ?? fetch);
  storeExerciseHits(db, titles, hits);
  const added = Math.max(0, listActiveSuggestions(db).length - before);
  logActivity(db, "exercise_search", { titles: titles.length, added });
  return { ran: true, reason: "ok", added };
}

export async function fetchExerciseHits(
  endpoint: string,
  apiKey: string,
  query: string,
  fetchImpl: typeof fetch,
): Promise<ReturnType<typeof exerciseHitsFromJson>> {
  let target: URL;
  try {
    target = new URL(endpoint);
  } catch {
    throw new AppError("EXERCISE_SEARCH_ENDPOINT is not a valid URL.", "exercise_search", 400);
  }
  target.searchParams.set("q", query);
  let response: Response;
  try {
    response = await fetchImpl(target.toString(), {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });
  } catch {
    throw new AppError(
      "The search endpoint could not be reached. No suggestions were added.",
      "exercise_search",
      502,
    );
  }
  const text = await response.text();
  if (!response.ok) {
    throw new AppError(
      `The search endpoint returned ${response.status}. No suggestions were added.`,
      "exercise_search",
      502,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError("The search endpoint did not return a list of links.", "exercise_search", 502);
  }
  const hits = exerciseHitsFromJson(parsed);
  if (!Array.isArray(hits)) {
    throw new AppError("The search endpoint did not return a list of links.", "exercise_search", 502);
  }
  return hits;
}

export async function runManualExerciseSearch(db: Db, consent: boolean): Promise<ExerciseSearchState & { added: number }> {
  if (!exerciseSearchConfigured()) {
    throw new AppError(EXERCISE_SEARCH_UNCONFIGURED, "exercise_search_unconfigured", 400);
  }
  if (!consent && !exerciseSearchOptIn(db)) {
    const state = exerciseSearchState(db);
    throw new AppError(
      "Search sends finished chapter and lesson titles to the endpoint in EXERCISE_SEARCH_ENDPOINT. Confirm that before the first search.",
      "consent_required",
      400,
      { willSend: state.willSend, query: state.query },
    );
  }
  if (consent) setExerciseSearchOptIn(db);
  const titles = finishedReadingTitles(db);
  if (!searchQueryFromTitles(titles)) {
    throw new AppError(
      "Finish a book chapter or a course lesson before searching. Nothing was sent.",
      "nothing_finished",
      400,
    );
  }
  const result = await maybeSearch(db, { force: true });
  return { ...exerciseSearchState(db), added: result.added };
}

export function startExerciseSearch(db: Db): void {
  const tick = () => {
    void maybeSearch(db).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Exercise search failed.";
      console.error(message);
    });
  };
  tick();
  const timer = setInterval(tick, 6 * 60 * 60 * 1000);
  timer.unref();
}
