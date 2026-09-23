import { useEffect, useState, type FormEvent } from "react";
import type { BookCategory, Dashboard } from "@progress-island/shared";
import { categoryColorCss } from "@progress-island/shared";
import { api } from "../api";
import { IslandView } from "../IslandView";

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
  if (!data) return <p>Loading island…</p>;

  async function saveCategories(path: string, init: RequestInit) {
    setError(null);
    try {
      const result = await api<{ categories: BookCategory[] }>(path, init);
      setCategories(result.categories);
      setData((current) =>
        current
          ? {
              ...current,
              categories: result.categories,
              trees: current.trees.map((tree) =>
                tree.category && result.categories.some((category) => category.id === tree.category)
                  ? tree
                  : { ...tree, category: null },
              ),
            }
          : current,
      );
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }

  return (
    <div className="island-page">
      <IslandView trees={data.trees} categories={categories} />
      <aside className="island-overlay stack">
        {!data.ai.configured && (
          <div className="banner">
            Configure OpenRouter to enable AI. Tracking still works.
          </div>
        )}
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
      </aside>
    </div>
  );
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
    <div className="card">
      <h2>Categories</h2>
      <p className="muted">
        Assign a book and its tree is painted that color. Size still follows how far you have read.
      </p>
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
