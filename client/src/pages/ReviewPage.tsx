import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { gradeAnswer, questionMode, type IslandState, type QuizQuestion, type ReviewPack } from "@progress-island/shared";
import { api } from "../api";

function expectedText(question: QuizQuestion): string {
  const mode = questionMode(question);
  if (mode === "numeric") return question.answer ?? "";
  const ids =
    mode === "multi" ? (question.correctChoiceIds ?? []) : question.correctChoiceId ? [question.correctChoiceId] : [];
  return (question.choices ?? [])
    .filter((choice) => ids.includes(choice.id))
    .map((choice) => choice.text)
    .join(" · ");
}

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
  const [bookId, setBookId] = useState<string | null>(null);
  const [libraryFilename, setLibraryFilename] = useState<string | null>(null);
  const [hasChapterBody, setHasChapterBody] = useState(false);
  const [willReadSite, setWillReadSite] = useState(false);
  const [excerptPreview, setExcerptPreview] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [reportNote, setReportNote] = useState("");

  async function load() {
    const data = await api<{
      pack: ReviewPack | null;
      bookId: string;
      libraryFilename: string | null;
      hasChapterBody: boolean;
      willReadSite?: boolean;
    }>(`/api/chapters/${chapterId}/reviews`);
    setPack(data.pack);
    setBookId(data.bookId);
    setLibraryFilename(data.libraryFilename);
    setHasChapterBody(data.hasChapterBody);
    setWillReadSite(Boolean(data.willReadSite));
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
      setWillReadSite(false);
      setResult(null);
      setAnswers({});
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

  function toggleMulti(questionId: string, choiceId: string) {
    setAnswers((current) => {
      const selected = new Set((current[questionId] ?? "").split(",").filter(Boolean));
      if (selected.has(choiceId)) selected.delete(choiceId);
      else selected.add(choiceId);
      return { ...current, [questionId]: [...selected].sort().join(",") };
    });
  }

  const liveQuestions = pack?.questions.filter((question) => !question.rejected) ?? [];

  return (
    <div className="stack">
      <h1>Chapter test</h1>
      <p className="muted">
        Pick one option, pick every option that applies, or type a calculated value. The key stays hidden
        until you score the test. Scoring happens on the server.
      </p>
      {pack?.stale && (
        <p className="banner">This pack is stale because the source text changed. Regenerate it.</p>
      )}

      <div className="card stack">
        <p className="muted">
          {libraryFilename
            ? `Attached PDF: ${libraryFilename}. Generating reads this chapter from that file, then sends the excerpt to OpenRouter.`
            : willReadSite
              ? "Only the section list is saved. Generating reads this section from the linked site, then sends that text to OpenRouter."
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
        {error && (
          <p className="banner danger" role="alert">
            {error}
          </p>
        )}
        <button
          className={`btn primary${busy ? " is-busy" : ""}`}
          type="button"
          aria-busy={busy}
          disabled={busy || !consent}
          onClick={() => void generate()}
        >
          {busy ? "Writing the test…" : "Generate test from this chapter"}
        </button>
        {busy && (
          <p className="banner" role="status">
            {willReadSite
              ? "Opening this section from the linked site, then writing the test. This usually takes a few seconds."
              : "Writing the test from this chapter. This usually takes a few seconds."}
          </p>
        )}
      </div>

      {pack && liveQuestions.length > 0 && (
        <form className="card stack" onSubmit={(event) => void submit(event)}>
          <h2>Test</h2>
          {liveQuestions.map((question, index) => {
            const mode = questionMode(question);
            const picked = new Set((answers[question.id] ?? "").split(",").filter(Boolean));
            const correctIds = new Set(
              mode === "multi"
                ? (question.correctChoiceIds ?? [])
                : question.correctChoiceId
                  ? [question.correctChoiceId]
                  : [],
            );
            const marked = Boolean(result);
            const right = marked && gradeAnswer(question, answers[question.id]);
            return (
              <fieldset key={question.id} style={{ border: "none", padding: 0 }}>
                <legend>
                  {index + 1}. {question.prompt}
                </legend>
                {mode === "multi" && <p className="muted">Select every item that applies.</p>}
                {mode === "numeric" ? (
                  <input
                    value={answers[question.id] ?? ""}
                    inputMode="decimal"
                    disabled={marked}
                    placeholder="Your value"
                    onChange={(event) =>
                      setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                    }
                  />
                ) : (
                  (question.choices ?? []).map((choice) => (
                    <label
                      className={`choice${marked && correctIds.has(choice.id) ? " right" : ""}${
                        marked && picked.has(choice.id) && !correctIds.has(choice.id) ? " wrong" : ""
                      }`}
                      key={choice.id}
                    >
                      <input
                        type={mode === "multi" ? "checkbox" : "radio"}
                        name={question.id}
                        checked={picked.has(choice.id)}
                        disabled={marked}
                        onChange={() => {
                          if (mode === "multi") toggleMulti(question.id, choice.id);
                          else setAnswers((current) => ({ ...current, [question.id]: choice.id }));
                        }}
                      />
                      {choice.text}
                    </label>
                  ))
                )}
                {marked && (
                  <>
                    <p className={right ? "banner good" : "banner danger"}>
                      {right ? "Correct." : `Answer: ${expectedText(question)}`} {question.explanation}
                    </p>
                    <p className="passage">
                      {question.locator}: {question.passage}
                    </p>
                  </>
                )}
                {question.reportNote && <p className="muted">Reported: {question.reportNote}</p>}
                <div className="row">
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => {
                      setEditingId(question.id);
                      setDraftPrompt(question.prompt);
                    }}
                  >
                    Edit prompt
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => void mutate({ kind: "question", id: question.id, action: "reject" })}
                  >
                    Reject
                  </button>
                  <button className="btn ghost" type="button" onClick={() => setReportFor(question.id)}>
                    Report
                  </button>
                </div>
                {editingId === question.id && (
                  <div className="stack">
                    <input value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} />
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        void mutate({
                          kind: "question",
                          id: question.id,
                          action: "edit",
                          prompt: draftPrompt,
                        })
                      }
                    >
                      Save prompt
                    </button>
                  </div>
                )}
                {reportFor === question.id && (
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
                          id: question.id,
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
            );
          })}
          {pack.questions
            .filter((question) => question.rejected)
            .map((question) => (
              <p key={question.id} className="muted">
                Rejected: {question.prompt}{" "}
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => void mutate({ kind: "question", id: question.id, action: "restore" })}
                >
                  Restore
                </button>
              </p>
            ))}
          <button className="btn primary" disabled={busy || Boolean(result)} type="submit">
            {busy ? "Scoring…" : "Score the test"}
          </button>
        </form>
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
