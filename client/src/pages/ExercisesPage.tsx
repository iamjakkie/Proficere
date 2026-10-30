import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Article, ExerciseSuggestion } from "@progress-island/shared";
import { api } from "../api";

type SearchState = {
  configured: boolean;
  optedIn: boolean;
  lastAt: string | null;
  willSend: string[];
  queries: string[];
  suggestions: ExerciseSuggestion[];
  message: string | null;
  added?: number;
};

export function ExercisesPage() {
  const [sheets, setSheets] = useState<Article[]>([]);
  const [search, setSearch] = useState<SearchState | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api<{ articles: Article[] }>("/api/articles")
      .then((data) => setSheets(data.articles.filter((article) => article.kind === "workbook")))
      .catch((err: Error) => setError(err.message));
    api<SearchState>("/api/exercise-search")
      .then(setSearch)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);

  async function searchNow() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api<SearchState>("/api/exercise-search", {
        method: "POST",
        body: JSON.stringify({ consent: consent || search?.optedIn === true }),
      });
      setSearch(data);
      if (data.added === 0 && data.configured) setNotice("Search finished. No new public PDF links were added.");
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function accept(id: string) {
    setError(null);
    await api(`/api/exercise-suggestions/${id}/accept`, { method: "POST" });
    load();
  }

  async function reject(id: string) {
    setError(null);
    await api(`/api/exercise-suggestions/${id}/reject`, { method: "POST" });
    load();
  }

  return (
    <div className="stack">
      <section className="card workbook-shelf">
        <h1>Exercises</h1>
        <p className="muted">
          Exercise sheets stay on this page. They are not articles, and they do not join a category on Home. A suggestion
          is a public PDF link. Accepting one does not download the file or add it to the book library.
        </p>
        {error && <p className="banner danger">{error}</p>}
        {search && !search.configured && <p className="banner">{search.message}</p>}
        {search && (
          <div className="stack">
            <p>
              Search runs only while this Mac’s server is running, at most about once a day after you opt in, plus when
              you press Search now. Nothing runs while the server is stopped.
            </p>
            {search.configured && !search.optedIn && (
              <label className="check">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> I
                understand these search queries leave this Mac.
              </label>
            )}
            <button
              className="btn"
              type="button"
              disabled={busy || (search.configured && !search.optedIn && !consent)}
              onClick={() => void searchNow()}
            >
              {busy ? "Searching…" : "Search now"}
            </button>
            <p>A search sends one Google query per topic. Similar finished chapters are grouped.</p>
            {(search.queries ?? []).length === 0 ? (
              <p className="search-query">Finish a chapter or lesson first. Nothing will be sent until then.</p>
            ) : (
              (search.queries ?? []).map((query) => (
                <p key={query} className="search-query">
                  {query}
                </p>
              ))
            )}
            {search.lastAt && <p className="muted">Last search: {new Date(search.lastAt).toLocaleString()}</p>}
          </div>
        )}
        {notice && <p className="banner good">{notice}</p>}
        {(search?.suggestions.length ?? 0) === 0 ? (
          <p className="muted">No exercise sheets waiting.</p>
        ) : (
          <ul className="shelf-list">
            {search?.suggestions.map((suggestion) => (
              <li key={suggestion.id}>
                <a href={suggestion.url} target="_blank" rel="noreferrer">
                  {suggestion.title}
                </a>
                <span className="muted">
                  {suggestion.sourceHost} · {suggestion.reason}
                </span>
                <span className="row-actions">
                  <button className="btn" type="button" onClick={() => void accept(suggestion.id)}>
                    Add to exercises
                  </button>
                  <button className="btn ghost" type="button" onClick={() => void reject(suggestion.id)}>
                    Reject
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {sheets.length === 0 ? (
          <p>No exercise sheets saved yet.</p>
        ) : (
          <ul className="shelf-list">
            {sheets.map((sheet) => (
              <li key={sheet.id}>
                <Link to={`/articles/${sheet.id}`}>{sheet.title}</Link>
                <span className="muted">{sheet.sourceHost ?? "Exercise sheet"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
