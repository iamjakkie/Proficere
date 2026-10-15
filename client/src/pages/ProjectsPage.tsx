import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { seedCalculations, type ProjectProposal } from "@progress-island/shared";
import { ApiError, api } from "../api";
import { Markdown } from "../markdown";

type ChapterOption = {
  id: string;
  title: string;
  status: string;
  progressPercent: number;
  hasProse: boolean;
  locator: string;
};

type ProjectRow = {
  id: string;
  status: string;
  brief: ProjectProposal;
  dismissReason: string | null;
  grade: string | null;
  passed: boolean | null;
};

type Options = {
  books: { id: string; title: string; chapters: ChapterOption[] }[];
  focused: ProjectRow | null;
  projects: ProjectRow[];
  batch: { id: string; proposals: ProjectProposal[]; createdAt: string } | null;
};

type Plan = {
  activation: "ready" | "needs_validation" | "unsupported";
  issues: { criterionId: string | null; severity: "block" | "limit"; message: string }[];
  executionAvailable: false;
};

type Review = {
  id: string;
  submissionId: string;
  versionId: string;
  objective: {
    criterionId: string;
    method: string;
    status: "passed" | "failed" | "not_run";
    explanation: string;
    coverage: string | null;
    operational: boolean;
  }[];
  reasoning: { criterionId: string; judgment: string; explanation: string }[] | null;
  questions: { id: string; prompt: string }[];
  answers: Record<string, string> | null;
  answerReview: { id: string; judgment: string; explanation: string }[] | null;
  label: string;
  nextAction: string | null;
  operational: { message: string } | null;
  grade: string | null;
  passed: boolean | null;
  notes: { line: number; text: string }[] | null;
};

type Detail = {
  project: { id: string; status: string; brief: ProjectProposal; dismissReason: string | null };
  versions: { id: string; versionNumber: number; assessmentMode: string; createdAt: string }[];
  submissions: {
    id: string;
    submissionNumber: number;
    versionId: string;
    artifacts: { explanation: string; assumptions: string; deliverable: string; prediction: string | null };
    createdAt: string;
  }[];
  reviews: Review[];
  plan: Plan;
};

export function ProjectsPage() {
  const [options, setOptions] = useState<Options | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [gradeConsent, setGradeConsent] = useState(false);
  const [batch, setBatch] = useState<Options["batch"]>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openProposal, setOpenProposal] = useState<string | null>(null);
  const [deliverable, setDeliverable] = useState("");
  const [filter, setFilter] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [searchParams] = useSearchParams();
  const [scriptFor, setScriptFor] = useState<string | null>(null);

  async function load(focusId?: string | null) {
    const next = await api<Options>("/api/projects/options");
    setOptions(next);
    if (focusId) {
      setDetail(await api<Detail>(`/api/projects/${focusId}`));
      setOpenId(focusId);
    }
    if (!seeded) {
      const requested = (searchParams.get("chapters") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => next.books.some((book) => book.chapters.some((chapter) => chapter.id === item)));
      if (requested.length > 0) setSelected(requested.slice(0, 6));
      const projectId = searchParams.get("project");
      if (!focusId && projectId && next.projects.some((project) => project.id === projectId)) {
        setDetail(await api<Detail>(`/api/projects/${projectId}`));
        setOpenId(projectId);
      }
      setSeeded(true);
    }
  }

  useEffect(() => {
    void load().catch((err: unknown) => setError(messageOf(err)));
  }, []);

  useEffect(() => {
    const exam = detail?.project.brief.exam;
    if (!detail || !exam || scriptFor === detail.project.id) return;
    const starter = exam.starter.trim();
    setDeliverable(starter || seedCalculations(exam.given ?? []));
    setScriptFor(detail.project.id);
  }, [detail, scriptFor]);

  async function openProject(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setDetail(await api<Detail>(`/api/projects/${id}`));
      setOpenId(id);
      setRunResult(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function suggest() {
    setBusy(true);
    setError(null);
    try {
      const response = await api<{ batch: Options["batch"]; reused: boolean }>("/api/projects/suggestions", {
        method: "POST",
        body: JSON.stringify({
          consent,
          chapterIds: selected,
          goal: "",
          hours: null,
          output: "",
          tools: "",
          instruction: "",
          refresh: true,
        }),
      });
      setBatch(response.batch);
      setOpenProposal(response.batch?.proposals[0]?.id ?? null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function dismissSuggestion(title: string) {
    setBusy(true);
    setError(null);
    try {
      await api("/api/projects/dismiss-suggestion", {
        method: "POST",
        body: JSON.stringify({ title, reason: "Skipped" }),
      });
      if (batch) setBatch({ ...batch, proposals: batch.proposals.filter((item) => item.title !== title) });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function accept(proposalId: string) {
    if (!batch) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api<{ project: { id: string } }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ batchId: batch.id, proposalId, setAside: Boolean(options?.focused) }),
      });
      setBatch(null);
      await load(response.project.id);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function runExam() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      setRunResult(
        await api<RunResult>(`/api/projects/${detail.project.id}/run`, {
          method: "POST",
          body: JSON.stringify({ deliverable }),
        }),
      );
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitExam() {
    if (!detail) return;
    if (!gradeConsent) {
      setError("Confirm the OpenRouter notice before submitting.");
      return;
    }
    const notes: string[] = [];
    const assumed: string[] = [];
    for (const line of deliverable.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) notes.push(trimmed.slice(1).trim());
      else if (/^assume\b/i.test(trimmed)) assumed.push(trimmed.replace(/^assume\s+/i, ""));
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await api<{ submission: { id: string } }>(`/api/projects/${detail.project.id}/submissions`, {
        method: "POST",
        body: JSON.stringify({
          explanation: notes.join("\n"),
          assumptions: assumed.join("\n"),
          deliverable,
          prediction: null,
        }),
      });
      await api(`/api/projects/${detail.project.id}/submissions/${saved.submission.id}/verify`, {
        method: "POST",
        body: JSON.stringify({ consent: true }),
      });
      await load(detail.project.id);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  const needle = filter.trim().toLowerCase();
  const matches =
    needle.length < 2
      ? []
      : (options?.books.flatMap((book) =>
          book.chapters
            .filter(
              (chapter) =>
                !selected.includes(chapter.id) &&
                (book.title.toLowerCase().includes(needle) || chapter.title.toLowerCase().includes(needle)),
            )
            .map((chapter) => ({ book, chapter })),
        ) ?? []
        ).slice(0, 8);

  const brief = openId && detail?.project.id === openId ? detail.project.brief : null;
  const latestReview = detail?.reviews.at(-1) ?? null;

  return (
    <div className="stack">
      <div>
        <h1>Projects</h1>
        <p className="muted">Each row is an exam. Open it to write the derivation.</p>
      </div>
      {error && (
        <p className="banner danger" role="alert">
          {error}
        </p>
      )}

      <section className="stack">
        {selected.length > 0 && (
          <p className="project-sources">
            {selected.map((id) => {
              const found = findChapter(options, id);
              if (!found) return null;
              return (
                <span key={id}>
                  <Link to={`/books/${found.book.id}`}>{found.book.title}</Link>
                  <span className="muted"> · {found.chapter.title}</span>{" "}
                  <button className="btn" type="button" onClick={() => setSelected((current) => current.filter((item) => item !== id))}>
                    Remove
                  </button>
                </span>
              );
            })}
          </p>
        )}
        <label>
          Add a section
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Book or section title" />
        </label>
        {matches.length > 0 && (
          <div className="stack">
            {matches.map(({ book, chapter }) => (
              <button
                key={chapter.id}
                className="btn"
                type="button"
                onClick={() => {
                  setSelected((current) => [...current, chapter.id].slice(0, 6));
                  setFilter("");
                }}
              >
                {book.title} · {chapter.title}
              </button>
            ))}
          </div>
        )}
        <label className="row">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          Send the selected section text to OpenRouter for this request
        </label>
        <button className={`btn primary${busy ? " is-busy" : ""}`} type="button" disabled={busy || !consent || selected.length === 0} onClick={() => void suggest()}>
          {busy ? "Working…" : "Suggest an exam"}
        </button>
      </section>

      {batch && batch.proposals.length > 0 && (
        <ul className="project-list">
          {batch.proposals.map((proposal) => (
            <li key={proposal.id}>
              <div className="project-row">
                <div className="project-main">
                  <button className="project-title" type="button" onClick={() => setOpenProposal(openProposal === proposal.id ? null : proposal.id)}>
                    {proposal.title}
                  </button>
                  <SourceLinks sources={proposal.sources} />
                </div>
                <span className="row">
                  <button className="btn primary" type="button" disabled={busy} onClick={() => void accept(proposal.id)}>
                    Start
                  </button>
                  <button className="btn" type="button" disabled={busy} onClick={() => void dismissSuggestion(proposal.title)}>
                    Dismiss
                  </button>
                </span>
              </div>
              {openProposal === proposal.id && (
                <div className="project-body stack">
                  <ExamStatement prompt={proposal.exam?.prompt || proposal.problem} given={proposal.exam?.given} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {options && options.projects.length > 0 && (
        <ul className="project-list">
          {options.projects.map((project) => {
            const open = openId === project.id && brief;
            return (
              <li key={project.id} className={project.passed === false ? "exam-fail" : undefined}>
                <div className="project-row">
                  <div className="project-main">
                    <button className="project-title" type="button" onClick={() => void openProject(project.id)}>
                      {project.brief.title}
                    </button>
                    <SourceLinks sources={project.brief.sources} />
                  </div>
                  <span className="muted">{statusText(project)}</span>
                </div>
                {open && detail && (
                  <div className="project-body stack">
                    <ExamStatement
                      prompt={detail.project.brief.exam?.prompt || detail.project.brief.problem}
                      given={detail.project.brief.exam?.given}
                    />
                    {detail.project.status === "paused" && (
                      <button
                        className="btn"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void api(`/api/projects/${detail.project.id}/resume`, { method: "POST" })
                            .then(() => load(detail.project.id))
                            .catch((err: unknown) => setError(messageOf(err)))
                        }
                      >
                        Resume this project
                      </button>
                    )}
                    {detail.project.status === "active" && (
                      <form
                        className="stack"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitExam();
                        }}
                      >
                        <p className="muted">
                          Each line is a calculation. <code>F*x + G*u</code> is enough, and <code>x = F*x + G*u</code> keeps
                          the result. <code>#</code> is a note. Run checks it with SymPy. Submit sends it for a grade.
                        </p>
                        <div className="exam-work">
                          <textarea
                            className="exam-editor"
                            value={deliverable}
                            onChange={(event) => setDeliverable(event.target.value)}
                            spellCheck={false}
                            placeholder={"x = F*x + G*u"}
                            required
                          />
                          {runResult ? (
                            <RunReport result={runResult} source={deliverable} />
                          ) : (
                            <div className="exam-output exam-output-empty">Run to check this calculation.</div>
                          )}
                        </div>
                        <label className="row">
                          <input type="checkbox" checked={gradeConsent} onChange={(event) => setGradeConsent(event.target.checked)} />
                          Send this derivation to OpenRouter for a grade
                        </label>
                        <div className="row">
                          <button className="btn" type="button" disabled={busy} onClick={() => void runExam()}>
                            Run
                          </button>
                          <button className="btn primary" type="submit" disabled={busy || !gradeConsent}>
                            Submit
                          </button>
                        </div>
                      </form>
                    )}
                    {latestReview && <ReviewReport review={latestReview} />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type RunResult = {
  error: string | null;
  operational: string | null;
  target: string;
  summary: string;
  steps: { line: number | null; name: string; status: string; explanation: string; value: string | null }[];
  requiredFound: number;
  requiredTotal: number;
};

function sourceAt(source: string, line: number | null, nextLine: number | null): string {
  if (!line) return "";
  const rows = source.split("\n");
  const end = nextLine && nextLine > line ? nextLine - 1 : line;
  return rows.slice(line - 1, end).join("\n").trimEnd();
}

function RunReport({ result, source }: { result: RunResult; source: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const failures = result.steps.filter((step) => step.status === "failed");
  const failed = Boolean(result.error) || failures.length > 0 || result.summary.includes("does not match");
  const heading = result.error
    ? result.error
    : failures.length > 0
      ? `${failures.length} ${failures.length === 1 ? "error" : "errors"}`
      : result.summary;
  useEffect(() => {
    const pane = scroller.current;
    const row = pane?.querySelector(".exam-output-row.failed");
    if (row instanceof HTMLElement) row.scrollIntoView({ block: "nearest" });
  }, [result]);
  return (
    <div className="exam-output" ref={scroller} role="region" aria-label="Run output">
      <div className={failed ? "exam-output-summary failed" : "exam-output-summary"} role={failed ? "alert" : undefined}>
        <p>{heading}</p>
        {result.operational && <p className="exam-output-note">{result.operational}</p>}
        {failures.length > 0 && result.summary && <p className="exam-output-note">{result.summary}</p>}
      </div>
      {result.steps.map((step, index) => {
        const next = result.steps[index + 1]?.line ?? null;
        const code = sourceAt(source, step.line, next);
        const isFailed = step.status === "failed";
        return (
          <div key={`${step.line}-${step.name}-${index}`} className={isFailed ? "exam-output-row failed" : "exam-output-row"}>
            <span className="exam-output-line">{step.line ?? ""}</span>
            <span>
              <span className="exam-output-code">{code || step.name}</span>
              {!isFailed && step.value ? <span className="exam-output-value">{" = "}{step.value}</span> : null}
              {isFailed && <span className="exam-output-error">{step.explanation}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ExamStatement({ prompt, given }: { prompt: string; given: string[] | undefined }) {
  const promptHasData = prompt.includes("\\begin{bmatrix}");
  return (
    <>
      <Markdown source={prompt} />
      {!promptHasData && <ExamData given={given} />}
    </>
  );
}

function ExamData({ given }: { given: string[] | undefined }) {
  if (!given?.length) return null;
  return (
    <div className="stack">
      <h3>Data</h3>
      {given.map((item) => (
        <Markdown key={item} source={`\\[${item}\\]`} />
      ))}
    </div>
  );
}

function SourceLinks({ sources }: { sources: ProjectProposal["sources"] }) {
  const seen = new Set<string>();
  const items = sources.filter((source) => {
    const key = `${source.bookId}:${source.chapterId}`;
    if (!source.bookId || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (items.length === 0) return null;
  return (
    <span className="project-sources">
      {items.map((source, index) => (
        <span key={`${source.bookId}-${source.chapterId}`}>
          {index > 0 && ", "}
          <Link to={`/books/${source.bookId}`}>{source.bookTitle || "Book"}</Link>
          {source.chapterTitle ? <span> · {source.chapterTitle}</span> : null}
        </span>
      ))}
    </span>
  );
}

function findChapter(options: Options | null, chapterId: string) {
  for (const book of options?.books ?? []) {
    const chapter = book.chapters.find((item) => item.id === chapterId);
    if (chapter) return { book, chapter };
  }
  return null;
}

function statusText(project: { status: string; grade: string | null; passed: boolean | null }): string {
  if (project.passed === true) return project.grade ? `Passed · ${project.grade}` : "Passed";
  if (project.passed === false) return project.grade ? `Failed · ${project.grade}` : "Failed";
  if (project.status === "active") return "In progress";
  if (project.status === "paused") return "Paused";
  if (project.status === "draft") return "Draft";
  return project.status;
}

function ReviewReport({ review }: { review: Review }) {
  return (
    <div className="stack">
      <p
        className={
          review.passed === false
            ? "banner danger"
            : review.label === "passed" || review.label === "verified" || review.label === "ai_reviewed"
              ? "banner good"
              : "banner"
        }
      >
        {review.grade ? `Grade ${review.grade}. ` : ""}
        {labelText(review.label)}
      </p>
      {(review.notes ?? []).map((note) => (
        <p key={`${note.line}-${note.text}`}>
          Line {note.line}: {note.text}
        </p>
      ))}
      {review.operational && <p className="banner">{review.operational.message}</p>}
      {(review.grade || review.passed != null) && review.nextAction && (
        <p>
          <strong>Next.</strong> {review.nextAction}
        </p>
      )}
    </div>
  );
}

function labelText(label: string): string {
  if (label === "passed") return "Passed";
  if (label === "failed") return "Failed";
  if (label === "verified") return "Verified against this rubric";
  if (label === "ai_reviewed") return "AI-reviewed against this rubric";
  if (label === "needs_revision") return "Needs revision";
  if (label === "operational_failure") return "Check did not finish";
  return "Unverified";
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "The project request failed.";
}
