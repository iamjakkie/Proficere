import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Book, BookCategory } from "@progress-island/shared";
import { bookCategory } from "@progress-island/shared";
import { api } from "../api";

type LibraryBook = Book & {
  progressPercent: number;
  readPdfPage: number | null;
  pdfPageCount: number | null;
};

function progressLabel(book: LibraryBook): string {
  if (book.progressPercent > 0) return `${book.progressPercent}%`;
  if (book.readPdfPage) return "<1%";
  return "0%";
}

function progressWidth(book: LibraryBook): number {
  if (book.progressPercent > 0) return book.progressPercent;
  return book.readPdfPage ? 1 : 0;
}

function bookMatches(book: LibraryBook, query: string, categories: BookCategory[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const author = book.author?.toLowerCase() ?? "";
  const category = bookCategory(categories, book.identifiers.category)?.label.toLowerCase() ?? "";
  return book.title.toLowerCase().includes(needle) || author.includes(needle) || category.includes(needle);
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function applyVisibleMove(all: LibraryBook[], visible: LibraryBook[], fromId: string, toId: string): LibraryBook[] {
  const from = visible.findIndex((book) => book.id === fromId);
  const to = visible.findIndex((book) => book.id === toId);
  if (from < 0 || to < 0 || from === to) return all;
  const nextVisible = moveItem(visible, from, to);
  const visibleIds = new Set(visible.map((book) => book.id));
  let index = 0;
  return all.map((book) => (visibleIds.has(book.id) ? nextVisible[index++] : book));
}

export function LibraryPage() {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [categories, setCategories] = useState<BookCategory[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  useEffect(() => {
    api<{ books: LibraryBook[] }>("/api/books")
      .then((d) => setBooks(d.books))
      .catch((err: Error) => setError(err.message));
    api<{ categories: BookCategory[] }>("/api/categories")
      .then((d) => setCategories(d.categories))
      .catch((err: Error) => setError(err.message));
  }, []);

  const started = books.filter((book) => book.progressPercent > 0).length;
  const libraryPercent = books.length
    ? books.reduce((sum, book) => sum + (book.progressPercent || 0), 0) / books.length
    : 0;
  const libraryLabel =
    libraryPercent >= 1
      ? `${Math.round(libraryPercent)}% of the library read`
      : started
        ? `${started} of ${books.length} books started`
        : "Nothing read yet";
  const visible = books.filter((book) => bookMatches(book, query, categories));

  async function assignCategory(book: LibraryBook, category: string) {
    const previous = books;
    setBooks((current) =>
      current.map((item) => {
        if (item.id !== book.id) return item;
        const identifiers = { ...item.identifiers };
        if (category) identifiers.category = category;
        else delete identifiers.category;
        return { ...item, identifiers };
      }),
    );
    try {
      const data = await api<{ book: Book }>(`/api/books/${book.id}/category`, {
        method: "PUT",
        body: JSON.stringify({ category: category || null }),
      });
      setBooks((current) =>
        current.map((item) =>
          item.id === book.id ? { ...item, identifiers: data.book.identifiers } : item,
        ),
      );
    } catch (err) {
      setBooks(previous);
      setError((err as Error).message);
    }
  }

  async function persistOrder(next: LibraryBook[]) {
    const previous = books;
    setBooks(next);
    try {
      const data = await api<{ books: LibraryBook[] }>("/api/books/order", {
        method: "PUT",
        body: JSON.stringify({ ids: next.map((book) => book.id) }),
      });
      setBooks(data.books);
    } catch (err) {
      setBooks(previous);
      setError((err as Error).message);
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <h1>Library</h1>
        <Link className="btn primary" to="/library/new">
          Add book
        </Link>
      </div>
      {books.length > 0 && (
        <div className="card library-summary">
          <p>{libraryLabel}</p>
          <p className="muted">
            Drag the handle to rank books. Set a category to move that tree onto its region of the globe.
          </p>
          <div className="progress-bar" aria-label="Library reading progress">
            <span style={{ width: `${libraryPercent >= 1 ? Math.round(libraryPercent) : started ? 1 : 0}%` }} />
          </div>
        </div>
      )}
      {error && <p className="banner danger">{error}</p>}
      {books.length === 0 && (
        <div className="card">
          <p>No books yet. Search a catalog title, paste a contents list, or load the labelled fixture.</p>
        </div>
      )}
      {books.length > 0 && (
        <input
          className="library-search"
          value={query}
          placeholder="Find a book"
          aria-label="Find a book"
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      {books.length > 0 && visible.length === 0 && <p className="muted">No books match that search.</p>}
      <div className="book-list">
        {visible.map((book) => (
          <div
            key={book.id}
            className={`card book-row${draggingId === book.id ? " dragging" : ""}${overId === book.id ? " drop-target" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              if (draggingId && draggingId !== book.id) setOverId(book.id);
            }}
            onDragLeave={() => {
              if (overId === book.id) setOverId(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const fromId = event.dataTransfer.getData("text/plain") || draggingId;
              setDraggingId(null);
              setOverId(null);
              if (!fromId || fromId === book.id) return;
              void persistOrder(applyVisibleMove(books, visible, fromId, book.id));
            }}
          >
            <button
              className="drag-handle"
              type="button"
              draggable
              aria-label={`Reorder ${book.title}`}
              title="Drag to change importance"
              onClick={(event) => event.preventDefault()}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", book.id);
                setDraggingId(book.id);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setOverId(null);
              }}
            >
              ⋮⋮
            </button>
            {book.identifiers.coverUrl ? (
              <img className="cover" src={book.identifiers.coverUrl} alt="" />
            ) : (
              <div className="cover missing" aria-hidden="true" />
            )}
            <Link to={`/books/${book.id}`} className="book-title">
              {book.title}
            </Link>
            <span className="muted book-author">{book.author ?? "Unknown author"}</span>
            <select
              className="category-select"
              aria-label={`Category for ${book.title}`}
              value={bookCategory(categories, book.identifiers.category)?.id ?? ""}
              onChange={(event) => void assignCategory(book, event.target.value)}
            >
              <option value="">Unassigned</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
            <span className="book-meter">
              <span className="progress-bar" aria-label={`${book.title} progress`}>
                <span style={{ width: `${progressWidth(book)}%` }} />
              </span>
              <span className="muted">{progressLabel(book)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
