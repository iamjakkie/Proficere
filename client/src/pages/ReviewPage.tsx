import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { IslandState, ReviewPack } from "@progress-island/shared";
import { api } from "../api";

export function ReviewPage() {
  const { chapterId } = useParams();
  const [pack, setPack] = useState<ReviewPack | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{
    correctCount: number;
    total: number;
    weak: boolean;
    nextReviewAt: string;
    island: IslandState;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassages, setShowPassages] = useState(false);
  const [bookId, setBookId] = useState<string | null>(null);
  const [libraryFilename, setLibraryFilename] = useState<string | null>(null);
  const [hasChapterBody, setHasChapterBody] = useState(false);
  const [excerptPreview, setExcerptPreview] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftFront, setDraftFront] = useState("");
  const [draftBack, setDraftBack] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [reportNote, setReportNote] = useState("");

  async function load() {
    const data = await api<{
      pack: ReviewPack | null;
      bookId: string;
      libraryFilename: string | null;
      hasChapterBody: boolean;
    }>(`/api/chapters/${chapterId}/reviews`);
    setPack(data.pack);
    setBookId(data.bookId);
    setLibraryFilename(data.libraryFilename);
    setHasChapterBody(data.hasChapterBody);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [chapterId]);

  async function readExcerpt() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ preview: string; characters: number; pdfPageStart: number | null }>(
        `/api/chapters/${chapterId}/library-excerpt`,
        { method: "POST" },
      );
      const pages = data.pdfPageStart != null ? ` PDF page ${data.pdfPageStart}.` : "";
      setExcerptPreview(`${data.preview} (${data.characters} characters.${pages} This read stayed on this Mac.)`);
      setHasChapterBody(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ pack: ReviewPack }>(`/api/chapters/${chapterId}/reviews/generate`, {
        method: "POST",
        body: JSON.stringify({ consent }),
      });
      setPack(data.pack);
      setHasChapterBody(true);
      setResult(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pack) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{
        correctCount: number;
        total: number;
        weak: boolean;
        nextReviewAt: string;
        island: IslandState;
      }>(`/api/reviews/${pack.id}/attempt`, {
        method: "POST",
        body: JSON.stringify({ answers }),
      });
      setResult(data);
      setShowPassages(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function mutate(body: Record<string, unknown>) {
    if (!pack) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ pack: ReviewPack }>(`/api/reviews/${pack.id}/items`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setPack(data.pack);
      setEditingId(null);
      setReportFor(null);
      setReportNote("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>Review pack</h1>
      <p className="muted">
        Passing these questions is practice, not mastery. Scoring happens on the server.
      </p>
      {error && <p className="banner danger">{error}</p>}
      {pack?.stale && (
        <p className="banner">This pack is stale because the source text changed. Regenerate it.</p>
      )}

      <div className="card stack">
        <p className="muted">
          {libraryFilename
            ? `Attached PDF: ${libraryFilename}. Generating reads this chapter from that file, then sends the excerpt to OpenRouter.`
            : hasChapterBody
              ? "A chapter excerpt is already saved. Generating sends that text to OpenRouter."
              : "Attach the book PDF from your library folder, or paste the chapter. A title is not enough."}
        </p>
        <label>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I
          understand the chapter text will be sent to OpenRouter and the selected model. Local storage
          is not the same as local AI processing.
        </label>
        {libraryFilename && bookId && (
          <div className="row">
            <Link className="btn" to={`/books/${bookId}/read?chapter=${chapterId}`}>
              Open PDF
            </Link>
            <button className="btn" type="button" disabled={busy} onClick={() => void readExcerpt()}>
              Load chapter text from the PDF
            </button>
          </div>
        )}
        {excerptPreview && <p className="passage">{excerptPreview}</p>}
        <button className="btn primary" disabled={busy || !consent} onClick={() => void generate()}>
          Generate review from this chapter
        </button>
      </div>

      {pack && (
        <>
          <div className="card stack">
            <h2>Flashcards</h2>
            {pack.flashcards.map((card) => (
              <article key={card.id} className={card.rejected ? "muted" : undefined}>
                {editingId === card.id ? (
                  <div className="stack">
                    <input value={draftFront} onChange={(event) => setDraftFront(event.target.value)} />
                    <textarea value={draftBack} onChange={(event) => setDraftBack(event.target.value)} />
                    <button
                      className="btn primary"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void mutate({
                          kind: "flashcard",
                          id: card.id,
                          action: "edit",
                          front: draftFront,
                          back: draftBack,
                        })
                      }
                    >
                      Save card
                    </button>
                  </div>
                ) : (
                  <>
                    <strong>{card.front}</strong>
                    <p>{card.back}</p>
                  </>
                )}
                {card.rejected && <p>Rejected. It stays out of study until you restore it.</p>}
                {card.reportNote && <p className="muted">Reported: {card.reportNote}</p>}
                {showPassages && (
                  <p className="passage">
                    {card.locator}: {card.passage}
                  </p>
                )}
                <div className="row">
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => {
                      setEditingId(card.id);
                      setDraftFront(card.front);
                      setDraftBack(card.back);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() =>
                      void mutate({
                        kind: "flashcard",
                        id: card.id,
                        action: card.rejected ? "restore" : "reject",
                      })
                    }
                  >
                    {card.rejected ? "Restore" : "Reject"}
                  </button>
                  <button className="btn ghost" type="button" onClick={() => setReportFor(card.id)}>
                    Report
                  </button>
                </div>
                {reportFor === card.id && (
                  <div className="stack">
                    <input
                      value={reportNote}
                      onChange={(event) => setReportNote(event.target.value)}
                      placeholder="What is wrong with this item?"
                    />
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        void mutate({
                          kind: "flashcard",
                          id: card.id,
                          action: "report",
                          reportNote,
                        })
                      }
                    >
                      Save report
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
          <form className="card stack" onSubmit={(e) => void submit(e)}>
            <h2>Quiz</h2>
            {pack.questions.filter((q) => !q.rejected).map((q) => (
              <fieldset key={q.id} style={{ border: "none", padding: 0 }}>
                <legend>{q.prompt}</legend>
                {editingId === q.id ? (
                  <div className="stack">
                    <input value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} />
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        void mutate({
                          kind: "question",
                          id: q.id,
                          action: "edit",
                          prompt: draftPrompt,
                        })
                      }
                    >
                      Save prompt
                    </button>
                  </div>
                ) : null}
                {q.choices.map((choice) => (
                  <label className="choice" key={choice.id}>
                    <input
                      type="radio"
                      name={q.id}
                      checked={answers[q.id] === choice.id}
                      onChange={() => setAnswers((a) => ({ ...a, [q.id]: choice.id }))}
                    />
                    {choice.text}
                  </label>
                ))}
                {showPassages && (
                  <p className="passage">
                    {q.locator}: {q.passage}
                    <br />
                    {q.explanation}
                  </p>
                )}
                <div className="row">
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => {
                      setEditingId(q.id);
                      setDraftPrompt(q.prompt);
                    }}
                  >
                    Edit prompt
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => void mutate({ kind: "question", id: q.id, action: "reject" })}
                  >
                    Reject
                  </button>
                  <button className="btn ghost" type="button" onClick={() => setReportFor(q.id)}>
                    Report
                  </button>
                </div>
                {q.reportNote && <p className="muted">Reported: {q.reportNote}</p>}
                {reportFor === q.id && (
                  <div className="stack">
                    <input
                      value={reportNote}
                      onChange={(event) => setReportNote(event.target.value)}
                      placeholder="What is wrong with this question?"
                    />
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        void mutate({
                          kind: "question",
                          id: q.id,
                          action: "report",
                          reportNote,
                        })
                      }
                    >
                      Save report
                    </button>
                  </div>
                )}
              </fieldset>
            ))}
            {pack.questions.filter((q) => q.rejected).map((q) => (
              <p key={q.id} className="muted">
                Rejected question: {q.prompt}{" "}
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => void mutate({ kind: "question", id: q.id, action: "restore" })}
                >
                  Restore
                </button>
              </p>
            ))}
            <button className="btn primary" disabled={busy} type="submit">
              Score on server
            </button>
          </form>
          <button className="btn ghost" onClick={() => setShowPassages((v) => !v)}>
            {showPassages ? "Hide" : "Inspect"} source passages
          </button>
        </>
      )}

      {result && (
        <div className="banner good">
          {result.correctCount}/{result.total} correct
          {result.weak ? " · weak result, review sooner" : ""}. Next review {result.nextReviewAt.slice(0, 10)}.
          This is not a mastery certificate.
        </div>
      )}
      <Link to="/">Back to island</Link>
    </div>
  );
}
