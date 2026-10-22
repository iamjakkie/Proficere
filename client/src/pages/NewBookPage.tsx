import { useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { BookSearchHit, OutlineChapter } from "@progress-island/shared";
import { api } from "../api";

export function NewBookPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<BookSearchHit[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [useAi, setUseAi] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingHit, setPendingHit] = useState<BookSearchHit | null>(null);

  async function createBlank(extra?: Partial<{ title: string; author: string | null; edition: string | null; isbn: string | null; catalogUrl: string | null; contentsAvailable: boolean }>) {
    const book = await api<{ book: { id: string } }>("/api/books", {
      method: "POST",
      body: JSON.stringify({
        title: extra?.title ?? (title || "Untitled book"),
        author: extra?.author ?? null,
        edition: extra?.edition ?? null,
        isbn: extra?.isbn ?? null,
        catalogUrl: extra?.catalogUrl ?? null,
        contentsAvailable: extra?.contentsAvailable ?? false,
      }),
    });
    return book.book.id;
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const data = await api<{ hits: BookSearchHit[]; note: string }>(
        `/api/catalog/search?q=${encodeURIComponent(query)}`,
      );
      setHits(data.hits);
      setNote(data.note);
      setPendingHit(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function confirmEdition() {
    const hit = pendingHit;
    if (!hit) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createBlank({
        title: hit.title,
        author: hit.author,
        edition: hit.edition,
        isbn: hit.isbn,
        catalogUrl: hit.catalogUrl,
        contentsAvailable: false,
      });
      if (hit.contentsAvailable && hit.contentsPreview && hit.catalogUrl) {
        await api(`/api/books/${id}/import/retrieved`, {
          method: "POST",
          body: JSON.stringify({
            outline: hit.contentsPreview,
            url: hit.catalogUrl,
            edition: hit.edition,
          }),
        });
      }
      navigate(`/books/${id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pasteImport(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!title.trim()) {
        setError("Enter a book title before importing pasted text.");
        return;
      }
      const id = await createBlank();
      await api<{
        sourceId: string;
        outline: OutlineChapter[];
        message?: string;
      }>(`/api/books/${id}/import/paste`, {
        method: "POST",
        body: JSON.stringify({ text: paste, useAi, consent }),
      });
      navigate(`/books/${id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function loadFixture() {
    setBusy(true);
    try {
      const data = await api<{ book: { id: string }; sourceText: string }>("/api/books/fixture", {
        method: "POST",
      });
      await api(`/api/books/${data.book.id}/import/paste`, {
        method: "POST",
        body: JSON.stringify({ text: data.sourceText, useAi: false }),
      });
      navigate(`/books/${data.book.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadPdf(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!consent) {
      setError("Confirm that the opening pages may be sent to OpenRouter before selecting a PDF.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("consent", "true");
      const data = await api<{ book: { id: string }; message: string }>("/api/books/from-pdf", {
        method: "POST",
        body: form,
      });
      navigate(`/books/${data.book.id}`, { state: { importMessage: data.message } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>Add a book</h1>
      {error && <p className="banner danger">{error}</p>}
      <div className="card stack">
        <h2>1. Search title, author, or ISBN</h2>
        <p className="muted">
          Real Open Library retrieval. Metadata is not a table of contents. If a record has no contents, select the PDF.
        </p>
        <form className="row" onSubmit={search}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Probabilistic Robotics" />
          <button className="btn primary" type="submit">
            Search
          </button>
        </form>
        {note && <p className="banner">{note}</p>}
        {hits.map((hit) => (
          <button
            key={hit.catalogId}
            className="card"
            disabled={busy}
            onClick={() => setPendingHit(hit)}
            type="button"
            style={{ textAlign: "left" }}
          >
            <strong>{hit.title}</strong>
            <div className="muted">
              {hit.author} {hit.year ? `· ${hit.year}` : ""} {hit.edition ? `· ${hit.edition}` : ""}
            </div>
            <div>{hit.contentsAvailable ? "Contents list available for this edition" : "No contents list — select the PDF"}</div>
          </button>
        ))}
        {pendingHit && (
          <div className="card stack">
            <h3>Confirm this edition</h3>
            <p>
              <strong>{pendingHit.title}</strong>
            </p>
            <p className="muted">
              {pendingHit.author ?? "Unknown author"}
              {pendingHit.year ? ` · ${pendingHit.year}` : ""}
              {pendingHit.edition ? ` · ${pendingHit.edition}` : " · edition not stated"}
            </p>
            <p>
              {pendingHit.contentsAvailable
                ? `Open Library lists ${pendingHit.contentsPreview?.length ?? 0} contents entries for this edition. Chapters are not saved until you confirm the preview.`
                : "This record is metadata only. No chapter list will be invented. After saving, select the PDF and the chapters are read from the file."}
            </p>
            <div className="row">
              <button className="btn primary" type="button" disabled={busy} onClick={() => void confirmEdition()}>
                Save this edition
              </button>
              <button className="btn ghost" type="button" onClick={() => setPendingHit(null)}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card stack">
        <h2>2. Or select the PDF</h2>
        <p className="muted">
          Choose the file. The title and chapters are read from its bookmarks and opening pages. You
          confirm the chapter list before it is saved. A scanned PDF with no text cannot be read.
        </p>
        <label>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I
          understand the opening pages of this PDF will be sent to OpenRouter and the selected model
          provider. A local database does not keep AI processing on this Mac.
        </label>
        <label>
          Select PDF
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={!consent || busy}
            onChange={(e) => void uploadPdf(e)}
          />
        </label>
        <details>
          <summary>Paste a contents list instead</summary>
          <form className="stack" onSubmit={(e) => void pasteImport(e)}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Book title" />
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="Paste a table of contents or chapter text"
            />
            <label>
              <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} /> Use
              OpenRouter to extract headings
            </label>
            <button className="btn" disabled={busy} type="submit">
              Import pasted source
            </button>
          </form>
        </details>
      </div>

      <div className="card">
        <h2>Labelled test source</h2>
        <p className="muted">Loads the Navigation Notes fixture used in acceptance tests. Not a commercial book.</p>
        <button className="btn" disabled={busy} onClick={() => void loadFixture()}>
          Load fixture book
        </button>
      </div>
    </div>
  );
}
