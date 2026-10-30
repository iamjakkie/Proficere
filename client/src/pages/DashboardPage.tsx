import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { BookCategory, Dashboard } from "@progress-island/shared";
import { categoryColorCss } from "@progress-island/shared";
import { api } from "../api";
import { FieldView } from "../FieldView";

export function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [categories, setCategories] = useState<BookCategory[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Dashboard>("/api/dashboard")
      .then((dashboard) => {
        setData(dashboard);
        setCategories(dashboard.categories);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error && !data) return <p className="banner danger">{error}</p>;
  if (!data) return <p>Loading home…</p>;

  async function saveCategories(path: string, init: RequestInit) {
    setError(null);
    try {
      await api(path, init);
      const dashboard = await api<Dashboard>("/api/dashboard");
      setData(dashboard);
      setCategories(dashboard.categories);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }

  const resume = continueTarget(data);

  return (
    <div className="field-page">
      <FieldView resources={data.field} categories={categories} />
      {resume && (
        <Link className="field-continue" to={resume.href}>
          Continue {resume.title}
        </Link>
      )}
      {!data.ai.configured && <p className="field-ai">Configure OpenRouter to enable AI. Tracking still works.</p>}
      <details className="field-editor">
        <summary>Categories</summary>
        <CategoryEditor
          categories={categories}
          error={error}
          onRename={(id, label) =>
            saveCategories(`/api/categories/${encodeURIComponent(id)}`, {
              method: "PATCH",
              body: JSON.stringify({ label }),
            })
          }
          onAdd={(label) =>
            saveCategories("/api/categories", {
              method: "POST",
              body: JSON.stringify({ label }),
            })
          }
          onRemove={(id) => saveCategories(`/api/categories/${encodeURIComponent(id)}`, { method: "DELETE" })}
        />
      </details>
    </div>
  );
}

function continueTarget(data: Dashboard): { href: string; title: string } | null {
  if (data.activeCourse) return { href: data.activeCourse.href, title: data.activeCourse.title };
  if (!data.nextChapter) return null;
  const tree = data.trees.find((item) => item.bookId === data.nextChapter?.bookId);
  const href = tree?.hasPdf ? `/books/${data.nextChapter.bookId}/read` : `/books/${data.nextChapter.bookId}`;
  return { href, title: data.nextChapter.title };
}

function CategoryEditor({
  categories,
  error,
  onRename,
  onAdd,
  onRemove,
}: {
  categories: BookCategory[];
  error: string | null;
  onRename: (id: string, label: string) => Promise<void>;
  onAdd: (label: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState("");

  async function add(event: FormEvent) {
    event.preventDefault();
    const label = adding.trim();
    if (!label) return;
    await onAdd(label);
    setAdding("");
  }

  return (
    <div className="stack">
      <p className="muted">Bar color follows the category. Assign a book, article, or course and its bar uses that color.</p>
      {error && <p className="banner danger">{error}</p>}
      <ul className="category-editor">
        {categories.map((category) => (
          <li key={category.id}>
            <span className="region-swatch" style={{ background: categoryColorCss(category.color) }} />
            <CategoryName category={category} onRename={onRename} />
            <button
              className="text-btn"
              type="button"
              aria-label={`Remove ${category.label}`}
              onClick={() => void onRemove(category.id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form className="category-add" onSubmit={(event) => void add(event)}>
        <input
          value={adding}
          aria-label="New category"
          placeholder="New category"
          onChange={(event) => setAdding(event.target.value)}
        />
        <button className="btn" type="submit">
          Add
        </button>
      </form>
    </div>
  );
}

function CategoryName({
  category,
  onRename,
}: {
  category: BookCategory;
  onRename: (id: string, label: string) => Promise<void>;
}) {
  const [value, setValue] = useState(category.label);

  useEffect(() => {
    setValue(category.label);
  }, [category.label]);

  return (
    <input
      aria-label={`Rename ${category.label}`}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={(event) => {
        const next = event.currentTarget.value.trim();
        if (!next || next === category.label) {
          setValue(category.label);
          return;
        }
        setValue(next);
        void onRename(category.id, next).catch(() => setValue(category.label));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
