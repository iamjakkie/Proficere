import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { Book, Chapter, IslandState, OutlineChapter } from "@progress-island/shared";
import { api } from "../api";
import { OutlineEditor, type OutlineRow } from "../OutlineEditor";

type SourceInfo = {
  id: string;
  provenanceLabel: string;
};

type UnmatchedChapter = {
  existingId: string;
  title: string;
  status: string;
};

function pageLabel(chapter: Pick<Chapter, "pageStart" | "pageEnd">): string {
  if (chapter.pageStart && chapter.pageEnd) return `pages ${chapter.pageStart}–${chapter.pageEnd}`;
  if (chapter.pageStart) return `pages ${chapter.pageStart}`;
  if (chapter.pageEnd) return `pages through ${chapter.pageEnd}`;
  return "page range unknown";
}

function attachExistingIds(
  outline: OutlineChapter[],
  keep: { existingId: string; incomingTitle: string }[],
): OutlineRow[] {
  const used = new Set<string>();
  return outline.map((row) => {
    const match = keep.find(
      (item) =>
        !used.has(item.existingId) &&
        item.incomingTitle.trim().toLowerCase() === row.title.trim().toLowerCase(),
    );
    if (!match) return row;
    used.add(match.existingId);
    return { ...row, existingId: match.existingId };
  });
}

export function BookPage() {
  const { id } = useParams();
  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, setIsland] = useState<IslandState | null>(null);
  const [paste, setPaste] = useState("");
  const [consent, setConsent] = useState(false);
  const [draft, setDraft] = useState<OutlineRow[] | null>(null);
  const [draftSourceId, setDraftSourceId] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState<UnmatchedChapter[]>([]);
  const [manualTitle, setManualTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [libraryConfigured, setLibraryConfigured] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryFiles, setLibraryFiles] = useState<{ name: string; size: number }[]>([]);
  const [suggestedFiles, setSuggestedFiles] = useState<{ name: string; size: number }[]>([]);

  async function reload() {
    const data = await api<{
      book: Book;
      chapters: Chapter[];
      source: SourceInfo | null;
      draftOutline: OutlineChapter[] | null;
      dismissedSourceId: string | null;
    }>(`/api/books/${id}`);
    setBook(data.book);
    setChapters(data.chapters);
    setSource(data.source);
    await loadLibrary(data.book.title);
    const sourceUnused =
      data.source != null &&
      data.dismissedSourceId !== data.source.id &&
      data.chapters.every((chapter) => chapter.sourceDocumentId !== data.source?.id);
    if (!sourceUnused || !data.source) {
      setDraft(null);
      setUnmatched([]);
      return;
    }
    const rows = data.draftOutline ?? [];
    if (data.chapters.length === 0) {
      setDraft(rows.length ? rows : [{ number: null, title: "", pageStart: null, pageEnd: null }]);
      setDraftSourceId(data.source.id);
      setUnmatched([]);
      return;
    }
    if (!rows.length) {
      setDraft(null);
      return;
    }
    const preview = await api<{
      mergePreview: {
        keep: { existingId: string; incomingTitle: string }[];
        drop: UnmatchedChapter[];
      };
    }>(`/api/books/${id}/chapters/confirm`, {
      method: "POST",
      body: JSON.stringify({ outline: rows, dryRun: true }),
    });
    setDraft(attachExistingIds(rows, preview.mergePreview.keep));
    setDraftSourceId(data.source.id);
    setUnmatched(preview.mergePreview.drop);
  }

  async function loadLibrary(title: string) {
    try {
      const library = await api<{
        configured: boolean;
        error: string | null;
        files: { name: string; size: number }[];
        suggested: { name: string; size: number }[];
      }>(`/api/library?match=${encodeURIComponent(title)}`);
      setLibraryConfigured(library.configured);
      setLibraryError(library.error);
      setLibraryFiles(library.files);
      setSuggestedFiles(library.suggested);
    } catch (err) {
      setLibraryError((err as Error).message);
    }
  }

  useEffect(() => {
    reload().catch((err: Error) => setError(err.message));
  }, [id]);

  async function patch(chapterId: string, body: Record<string, unknown>) {
    const data = await api<{ chapter: Chapter; island: IslandState }>(`/api/chapters/${chapterId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setChapters((list) => list.map((c) => (c.id === data.chapter.id ? data.chapter : c)));
    setIsland(data.island);
  }

  async function complete(chapterId: string) {
    const data = await api<{ chapter: Chapter; island: IslandState }>(`/api/chapters/${chapterId}`, {
      method: "PATCH",
      body: JSON.stringify({ progressPercent: 100, note: note.trim() ? note.trim() : null }),
    });
    setChapters((list) => list.map((c) => (c.id === data.chapter.id ? data.chapter : c)));
    setIsland(data.island);
  }

  async function undo(chapterId: string) {
    const data = await api<{ chapter: Chapter }>(`/api/chapters/${chapterId}/undo`, {
      method: "POST",
    });
    setChapters((list) => list.map((c) => (c.id === data.chapter.id ? data.chapter : c)));
  }

  async function addManual(event: FormEvent) {
    event.preventDefault();
    const title = manualTitle.trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/books/${id}/chapters/confirm`, {
        method: "POST",
        body: JSON.stringify({
          outline: [
            ...chapters.map((chapter) => ({
              existingId: chapter.id,
              number: chapter.number,
              title: chapter.title,
              pageStart: chapter.pageStart,
              pageEnd: chapter.pageEnd,
              pdfPageStart: chapter.pdfPageStart,
              pdfPageEnd: chapter.pdfPageEnd,
              sourceSpanStart: chapter.sourceSpanStart,
              sourceSpanEnd: chapter.sourceSpanEnd,
            })),
            { number: null, title, pageStart: null, pageEnd: null },
          ],
          merge: chapters.length > 0,
        }),
      });
      setManualTitle("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pasteMore(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(`/api/books/${id}/import/paste`, {
        method: "POST",
        body: JSON.stringify({ text: paste, useAi: false, consent }),
      });
      setPaste("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    const outline = draft.filter((row) => row.title.trim());
    if (!outline.length) {
      setError("Add at least one chapter title before saving.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/books/${id}/chapters/confirm`, {
        method: "POST",
        body: JSON.stringify({
          sourceId: draftSourceId,
          outline,
          merge: chapters.length > 0,
        }),
      });
      setDraft(null);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function readChaptersFromPdf() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ outline?: { title: string }[]; message?: string }>(
        `/api/books/${id}/import/library`,
        { method: "POST" },
      );
      if (!data.outline?.length && data.message) setError(data.message);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function attachPdf(filename: string | null) {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{
        book: Book;
        outline?: { title: string }[];
        message?: string | null;
      }>(`/api/books/${id}/library`, {
        method: "PUT",
        body: JSON.stringify({ filename }),
      });
      setBook(data.book);
      if (!data.outline?.length && data.message) setError(data.message);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function dismissDraft() {
    setBusy(true);
    try {
      await api(`/api/books/${id}/import/dismiss`, { method: "POST" });
      setDraft(null);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!book) return <p>{error ?? "Loading…"}</p>;

  const selected = chapters.filter((chapter) => chapter.selected);
  const completedSelected = selected.filter((chapter) => chapter.status === "completed").length;
  const completedBook = chapters.filter((chapter) => chapter.status === "completed").length;

  return (
    <div className="stack">
      <Link className="back-link" to="/library" aria-label="Back to library">
        ←
      </Link>
      <div className="book-hero">
        {book.identifiers.coverUrl ? (
          <img
            className="cover"
            src={coverSrc(book)}
            alt=""
          />
        ) : (
          <div className="cover missing" aria-hidden="true" />
        )}
        <div>
          <h1>{book.title}</h1>
          <p className="muted">
            {book.author} {book.edition ? `· ${book.edition}` : ""} {book.isbn ? `· ${book.isbn}` : ""}
          </p>
          {book.libraryFilename && (
            <p>
              <Link className="btn primary" to={`/books/${book.id}/read`}>
                Open PDF
              </Link>
            </p>
          )}
          {book.catalogUrl && (
            <p>
              <a className="btn" href={book.catalogUrl} target="_blank" rel="noreferrer">
                Open site
              </a>
            </p>
          )}
          {chapters.length > 0 && (
            <p>
              <Link className="btn" to={`/projects?book=${book.id}`}>
                Suggest a project
              </Link>
            </p>
          )}
          {book.identifiers.readPdfPage && book.identifiers.pdfPageCount && (
            <p className="muted">
              Tracked through PDF page {book.identifiers.readPdfPage} of {book.identifiers.pdfPageCount}.
            </p>
          )}
        </div>
      </div>
      <CoverEditor
        key={book.id}
        book={book}
        busy={busy}
        onBusy={setBusy}
        onError={setError}
        onBook={setBook}
      />
      {source && <p>Source: {source.provenanceLabel}</p>}
      <LibraryPdf
        configured={libraryConfigured}
        error={libraryError}
        filename={book.libraryFilename}
        files={libraryFiles}
        suggested={suggestedFiles}
        busy={busy}
        onAttach={(filename) => void attachPdf(filename)}
        onReadChapters={() => void readChaptersFromPdf()}
        onRefresh={() => loadLibrary(book.title)}
      />
      {!chapters.length && !draft && (
        <div className="banner">
          No contents list yet. Paste a table of contents, upload a text PDF, or enter chapters
          manually. Discovery did not invent a chapter structure.
        </div>
      )}
      {error && <p className="banner danger">{error}</p>}
      <p>
        Plan {completedSelected}/{selected.length} completed. Whole book {completedBook}/
        {chapters.length} completed.
      </p>

      {draft && (
        <section className="card stack">
          <h2>{chapters.length ? "Merge preview" : "Confirm chapters"}</h2>
          <p className="muted">
            Edit titles and page labels before saving. Unknown pages stay blank. This preview
            is not saved until you confirm it.
          </p>
          {unmatched.length > 0 && (
            <div className="banner">
              These existing chapters are not in the new outline. Their progress and rewards stay:
              <ul>
                {unmatched.map((chapter) => (
                  <li key={chapter.existingId}>
                    {chapter.title} ({chapter.status.replace("_", " ")})
                  </li>
                ))}
              </ul>
            </div>
          )}
          <OutlineEditor rows={draft} onChange={setDraft} />
          <div className="row">
            <button className="btn primary" type="button" disabled={busy} onClick={() => void saveDraft()}>
              Save chapters
            </button>
            <button className="btn ghost" type="button" disabled={busy} onClick={() => void dismissDraft()}>
              Not now
            </button>
          </div>
        </section>
      )}

      {chapters.map((chapter) => (
        <article key={chapter.id} className="chapter">
          <div>
            <strong>
              {chapter.number ? `${chapter.number}. ` : ""}
              {chapter.title}
            </strong>
            <div className="muted">
              {chapter.status.replace("_", " ")} · {chapter.progressPercent}%
              {` · ${pageLabel(chapter)}`}
              {chapter.pdfPageStart != null ? ` · PDF page ${chapter.pdfPageStart}` : ""}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn good" onClick={() => void complete(chapter.id)}>
                Complete
              </button>
              <button className="btn" onClick={() => void patch(chapter.id, { progressPercent: 50, note })}>
                Log 50%
              </button>
              <button className="btn ghost" onClick={() => void undo(chapter.id)}>
                Undo
              </button>
              {book.libraryFilename && (
                <Link className="btn" to={`/books/${book.id}/read?chapter=${chapter.id}`}>
                  Open PDF
                </Link>
              )}
              {chapter.status === "completed" && (
                <Link className="btn primary" to={`/review/${chapter.id}`}>
                  Review pack
                </Link>
              )}
              <Link className="btn" to={`/projects?book=${book.id}&chapters=${chapter.id}`}>
                Use in a project
              </Link>
            </div>
          </div>
          <div className="stack">
            <label>
              <input
                type="checkbox"
                checked={chapter.selected}
                onChange={(event) => void patch(chapter.id, { selected: event.target.checked })}
              />{" "}
              In plan
            </label>
          </div>
        </article>
      ))}

      <form className="card stack" onSubmit={(event) => void addManual(event)}>
        <h3>Optional note for the next log</h3>
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Short note" />
        <h3>Add a chapter manually</h3>
        <input
          value={manualTitle}
          onChange={(event) => setManualTitle(event.target.value)}
          placeholder="Chapter title"
        />
        <button className="btn" disabled={busy} type="submit">
          Add chapter
        </button>
      </form>

      <form className="card stack" onSubmit={(event) => void pasteMore(event)}>
        <h3>Correct the import</h3>
        <p className="muted">
          Paste a revised contents list. You will see a merge preview before any chapter history
          changes.
        </p>
        <textarea value={paste} onChange={(event) => setPaste(event.target.value)} />
        <label>
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />{" "}
          Consent if you later enable AI on this text
        </label>
        <button className="btn primary" disabled={busy} type="submit">
          Preview pasted outline
        </button>
      </form>
    </div>
  );
}

function coverSrc(book: Book): string {
  const url = book.identifiers.coverUrl ?? "";
  if (!url) return "";
  const glue = url.includes("?") ? "&" : "?";
  return `${url}${glue}v=${encodeURIComponent(book.updatedAt)}`;
}

function CoverEditor({
  book,
  busy,
  onBusy,
  onError,
  onBook,
}: {
  book: Book;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onError: (value: string | null) => void;
  onBook: (book: Book) => void;
}) {
  const [url, setUrl] = useState(book.identifiers.coverUrl?.startsWith("http") ? book.identifiers.coverUrl : "");
  const [isbn, setIsbn] = useState(book.isbn ?? "");

  async function saveUrl(event: FormEvent) {
    event.preventDefault();
    onBusy(true);
    onError(null);
    try {
      const data = await api<{ book: Book }>(`/api/books/${book.id}/cover`, {
        method: "PUT",
        body: JSON.stringify({ coverUrl: url.trim() }),
      });
      onBook(data.book);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      onBusy(false);
    }
  }

  async function lookupIsbn() {
    onBusy(true);
    onError(null);
    try {
      const data = await api<{ book: Book }>(`/api/books/${book.id}/cover`, {
        method: "PUT",
        body: JSON.stringify({ isbn: isbn.trim() || null }),
      });
      onBook(data.book);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      onBusy(false);
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    onBusy(true);
    onError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const data = await api<{ book: Book }>(`/api/books/${book.id}/cover`, {
        method: "POST",
        body: form,
      });
      onBook(data.book);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      onBusy(false);
    }
  }

  async function remove() {
    onBusy(true);
    onError(null);
    try {
      const data = await api<{ book: Book }>(`/api/books/${book.id}/cover`, {
        method: "PUT",
        body: JSON.stringify({ coverUrl: null }),
      });
      onBook(data.book);
      setUrl("");
    } catch (err) {
      onError((err as Error).message);
    } finally {
      onBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Cover</h2>
      <p className="muted">Replace the library thumbnail with an image URL, an Open Library ISBN lookup, or a file from this Mac.</p>
      <form className="stack" onSubmit={(event) => void saveUrl(event)}>
        <label>
          Image URL
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://"
          />
        </label>
        <button className="btn" disabled={busy} type="submit">
          Use this URL
        </button>
      </form>
      <div className="row">
        <label>
          ISBN
          <input value={isbn} onChange={(event) => setIsbn(event.target.value)} placeholder="978…" />
        </label>
        <button className="btn" type="button" disabled={busy} onClick={() => void lookupIsbn()}>
          Look up on Open Library
        </button>
      </div>
      <label>
        Upload an image
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={(event) => void upload(event)} />
      </label>
      {book.identifiers.coverUrl && (
        <button className="btn ghost" type="button" disabled={busy} onClick={() => void remove()}>
          Remove cover
        </button>
      )}
    </section>
  );
}

function pdfLabel(name: string): string {
  const base = name.split("/").pop() ?? name;
  const folder = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
  const short = base.length > 72 ? `${base.slice(0, 69)}…` : base;
  return folder ? `${folder} / ${short}` : short;
}

function LibraryPdf({
  configured,
  error,
  filename,
  files,
  suggested,
  busy,
  onAttach,
  onReadChapters,
  onRefresh,
}: {
  configured: boolean;
  error: string | null;
  filename: string | null;
  files: { name: string; size: number }[];
  suggested: { name: string; size: number }[];
  busy: boolean;
  onAttach: (filename: string | null) => void;
  onReadChapters: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const known = new Set(files.map((file) => file.name));
  const options =
    filename && !known.has(filename) ? [{ name: filename, size: 0 }, ...files] : files;
  const needle = query.trim().toLowerCase();
  const visible = options.filter(
    (file) => file.name === filename || !needle || file.name.toLowerCase().includes(needle),
  );
  return (
    <section className="card stack">
      <div className="row">
        <h2>PDF library</h2>
        {configured && (
          <button
            className="btn ghost"
            type="button"
            disabled={busy || refreshing}
            onClick={() => {
              setRefreshing(true);
              void onRefresh().finally(() => setRefreshing(false));
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh list"}
          </button>
        )}
      </div>
      {!configured && (
        <p className="muted">
          Set the folder of your book PDFs in Settings, then open the attached file in the reader.
        </p>
      )}
      {error && <p className="banner danger">{error}</p>}
      {filename && (
        <div className="row">
          <p>Attached: {filename}</p>
          <button className="btn primary" type="button" disabled={busy} onClick={onReadChapters}>
            Read chapters from PDF
          </button>
        </div>
      )}
      {suggested.length > 0 && (
        <div className="row">
          {suggested.map((file) => (
            <button
              key={file.name}
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => onAttach(file.name)}
            >
              Use {file.name.split("/").pop()}
            </button>
          ))}
        </div>
      )}
      {options.length > 0 && (
        <label>
          Find a PDF by filename
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type part of the filename"
          />
        </label>
      )}
      {options.length > 0 && (
        <label>
          Choose a PDF
          <select
            value={filename ?? ""}
            disabled={busy}
            onChange={(event) => onAttach(event.target.value || null)}
          >
            <option value="">No PDF attached</option>
            {visible.map((file) => (
              <option key={file.name} value={file.name}>
                {pdfLabel(file.name)}
              </option>
            ))}
          </select>
        </label>
      )}
      {configured && options.length === 0 && !error && (
        <p className="muted">No PDF files were found in the library folder.</p>
      )}
    </section>
  );
}
