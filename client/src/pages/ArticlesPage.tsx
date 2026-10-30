import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Article, BookCategory } from "@progress-island/shared";
import { api } from "../api";
import { CategorySelect } from "../CategorySelect";

function percentLabel(article: Article): string {
  if (article.status === "completed") return "Finished";
  if (!article.libraryFilename) return article.note ? "Note" : "No PDF yet";
  if (article.progressPercent > 0) return `${article.progressPercent}%`;
  return "Not started";
}

export function ArticlesPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<BookCategory[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<{ articles: Article[] }>("/api/articles")
      .then((data) => setArticles(data.articles.filter((article) => article.kind === "article")))
      .catch((err: Error) => setError(err.message));
    api<{ categories: BookCategory[] }>("/api/categories")
      .then((data) => setCategories(data.categories))
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

  return (
    <div className="stack">
      <section className="card article-shelf">
        <h1>Articles</h1>
        <p className="muted">
          A short reading. Articles are not books, so they do not open an exam. The category sets the bar color on Home.
          Exercise sheets are on Exercises.
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
        {articles.length === 0 ? (
          <p>No articles yet. Add a title, then attach a PDF from your library folder if you have one.</p>
        ) : (
          <ul className="shelf-list">
            {articles.map((article) => (
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
    </div>
  );
}
