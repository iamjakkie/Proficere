import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Article, BookCategory, ExerciseSuggestion } from "@progress-island/shared";
import { api } from "../api";
import { CategorySelect } from "../CategorySelect";

type SearchState = {
  configured: boolean;
  optedIn: boolean;
  lastAt: string | null;
  willSend: string[];
  query: string;
  suggestions: ExerciseSuggestion[];
  message: string | null;
  added?: number;
};

function percentLabel(article: Article): string {
  if (article.status === "completed") return "Finished";
  if (!article.libraryFilename && article.kind === "article") return article.note ? "Note" : "No PDF yet";
  if (article.progressPercent > 0) return `${article.progressPercent}%`;
  return "Not started";
}

export function ArticlesPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<BookCategory[]>([]);
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState<SearchState | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api<{ articles: Article[] }>("/api/articles")
      .then((data) => setArticles(data.articles))
      .catch((err: Error) => setError(err.message));
    api<{ categories: BookCategory[] }>("/api/categories")
      .then((data) => setCategories(data.categories))
      .catch((err: Error) => setError(err.message));
    api<SearchState>("/api/exercise-search")
      .then(setSearch)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);

  async function addArticle(event: FormEvent) {
    event.preventDefault();
    const next = title.trim();
    if (!next) return;
    setError(null);
    const data = await api<{ article: Article }>("/api/articles", {
      method: "POST",
      body: JSON.stringify({ title: next, kind: "article" }),
    });
    setTitle("");
    setArticles((current) => [data.article, ...current]);
  }

  async function assignCategory(article: Article, category: string | null) {
    setError(null);
    const data = await api<{ article: Article }>(`/api/articles/${article.id}/category`, {
      method: "PUT",
      body: JSON.stringify({ category }),
    });
    setArticles((current) => current.map((item) => (item.id === article.id ? data.article : item)));
  }

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

  const readings = articles.filter((article) => article.kind === "article");
  const workbooks = articles.filter((article) => article.kind === "workbook");

  return (
    <div className="stack">
      <section className="card article-shelf">
        <h1>Articles</h1>
        <p className="muted">
          A short reading. Articles are not books, so they do not open an exam. The category sets the bar color on Home.
        </p>
        {error && <p className="banner danger">{error}</p>}
        <form className="category-add" onSubmit={(event) => void addArticle(event)}>
          <input
            aria-label="Article title"
            placeholder="Article title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <button className="btn primary" type="submit">
            Add article
          </button>
        </form>
        {readings.length === 0 ? (
          <p>No articles yet. Add a title, then attach a PDF from your library folder if you have one.</p>
        ) : (
          <ul className="shelf-list">
            {readings.map((article) => (
              <li key={article.id}>
                <Link to={`/articles/${article.id}`}>{article.title}</Link>
                <CategorySelect
                  label={`Category for ${article.title}`}
                  categories={categories}
                  value={article.category}
                  onChange={(category) => void assignCategory(article, category)}
                />
                <span className="muted">{percentLabel(article)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card workbook-shelf">
        <h2>Exercise sheets</h2>
        <p className="muted">
          Suggestions are public PDF links. Accepting one puts it on this shelf as a workbook. It is not added to the
          book library, and the file is not downloaded.
        </p>
        {search && !search.configured && <p className="banner">{search.message}</p>}
        {search && (
          <div className="stack">
            <p>
              Search runs only while this Mac’s server is running, at most about once a day after you opt in, plus when
              you press Search now. Nothing runs while the server is stopped.
            </p>
            <p>A search would send this text to the endpoint in your .env:</p>
            <p className="search-query">{search.query || "Finish a chapter or lesson first. Nothing will be sent until then."}</p>
            {search.willSend.length > 0 && (
              <ul>
                {search.willSend.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {search.configured && !search.optedIn && (
              <label className="check">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> I
                understand these finished chapter and lesson titles leave this Mac.
              </label>
            )}
            {search.lastAt && <p className="muted">Last search: {new Date(search.lastAt).toLocaleString()}</p>}
          </div>
        )}
        {notice && <p className="banner good">{notice}</p>}
        <button
          className="btn"
          type="button"
          disabled={busy || (search?.configured === true && !search.optedIn && !consent)}
          onClick={() => void searchNow()}
        >
          {busy ? "Searching…" : "Search now"}
        </button>
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
                    Add to exercise sheets
                  </button>
                  <button className="btn ghost" type="button" onClick={() => void reject(suggestion.id)}>
                    Reject
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {workbooks.length === 0 ? (
          <p>No exercise sheets saved yet.</p>
        ) : (
          <ul className="shelf-list">
            {workbooks.map((article) => (
              <li key={article.id}>
                <Link to={`/articles/${article.id}`}>{article.title}</Link>
                <CategorySelect
                  label={`Category for ${article.title}`}
                  categories={categories}
                  value={article.category}
                  onChange={(category) => void assignCategory(article, category)}
                />
                <span className="muted">{article.sourceHost ?? "Workbook"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
