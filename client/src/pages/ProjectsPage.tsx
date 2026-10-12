import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ProjectProposal } from "@progress-island/shared";
import { ApiError, api } from "../api";

type ChapterOption = {
  id: string;
  title: string;
  status: string;
  progressPercent: number;
  hasProse: boolean;
  locator: string;
};

type Options = {
  books: { id: string; title: string; chapters: ChapterOption[] }[];
  focused: { id: string; status: string; brief: ProjectProposal } | null;
  projects: { id: string; status: string; brief: ProjectProposal; dismissReason: string | null }[];
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

const FIT_LABEL: Record<ProjectProposal["fit"], string> = {
  reinforce: "Reinforce a concept",
  apply: "Apply it",
  combine: "Combine sources",
  stretch: "Limited stretch",
};

export function ProjectsPage() {
  const [options, setOptions] = useState<Options | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [goal, setGoal] = useState("");
  const [hours, setHours] = useState("");
  const [output, setOutput] = useState("");
  const [tools, setTools] = useState("");
  const [instruction, setInstruction] = useState("");
  const [consent, setConsent] = useState(false);
  const [batch, setBatch] = useState<Options["batch"]>(null);
  const [reused, setReused] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [setAside, setSetAside] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [assumptions, setAssumptions] = useState("");
  const [deliverable, setDeliverable] = useState("");
  const [prediction, setPrediction] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchParams] = useSearchParams();
  const fromBook = searchParams.get("book");

  async function load(focusId?: string | null) {
    const next = await api<Options>("/api/projects/options");
    setOptions(next);
    setBatch(next.batch);
    const id = focusId === undefined ? next.focused?.id : focusId;
    if (id) {
      setDetail(await api<Detail>(`/api/projects/${id}`));
    }
    if (!seeded) {
      const requested = (searchParams.get("chapters") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => next.books.some((book) => book.chapters.some((chapter) => chapter.id === item)));
      if (requested.length > 0) setSelected(requested.slice(0, 6));
      setSeeded(true);
    }
  }

  useEffect(() => {
    void load().catch((err: unknown) => setError(messageOf(err)));
  }, []);

  async function suggest() {
    setBusy(true);
    setError(null);
    try {
      const response = await api<{ batch: Options["batch"]; reused: boolean }>("/api/projects/suggestions", {
        method: "POST",
        body: JSON.stringify({
          consent,
          chapterIds: selected,
          goal,
          hours: hours.trim() ? Number(hours) : null,
          output,
          tools,
          instruction,
          refresh: Boolean(instruction.trim()),
        }),
      });
      setBatch(response.batch);
      setReused(response.reused);
      setInstruction("");
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
        body: JSON.stringify({ title, reason: dismissReason }),
      });
      setDismissReason("");
      if (batch) {
        setBatch({ ...batch, proposals: batch.proposals.filter((item) => item.title !== title) });
      }
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
        body: JSON.stringify({ batchId: batch.id, proposalId, setAside }),
      });
      setSetAside(false);
      await load(response.project.id);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!detail || detail.project.status !== "draft") return;
    setBusy(true);
    setError(null);
    try {
      const response = await api<{ project: Detail["project"]; plan: Plan }>(`/api/projects/${detail.project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ brief: detail.project.brief }),
      });
      setDetail({ ...detail, project: response.project, plan: response.plan });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function approve(assessmentMode: "objective" | "ai_reviewed") {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      if (detail.project.status === "draft") {
        await api(`/api/projects/${detail.project.id}`, {
          method: "PATCH",
          body: JSON.stringify({ brief: detail.project.brief }),
        });
      }
      await api(`/api/projects/${detail.project.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ assessmentMode }),
      });
      await load(detail.project.id);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitWork() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${detail.project.id}/submissions`, {
        method: "POST",
        body: JSON.stringify({
          explanation,
          assumptions,
          deliverable,
          prediction: prediction.trim() ? prediction : null,
        }),
      });
      setExplanation("");
      setAssumptions("");
      setDeliverable("");
      setPrediction("");
      await load(detail.project.id);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(submissionId: string) {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${detail.project.id}/submissions/${submissionId}/verify`, {
        method: "POST",
        body: JSON.stringify({ consent }),
      });
      await load(detail.project.id);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendAnswers(reviewId: string) {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${detail.project.id}/reviews/${reviewId}/answers`, {
        method: "POST",
        body: JSON.stringify({ consent, answers }),
      });
      await load(detail.project.id);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  function patchBrief(patch: Partial<ProjectProposal>) {
    if (!detail) return;
    setDetail({ ...detail, project: { ...detail.project, brief: { ...detail.project.brief, ...patch } } });
  }

  const brief = detail?.project.brief;
  const draft = detail?.project.status === "draft";

  return (
    <div className="stack">
      <div>
        <h1>Projects</h1>
        <p className="muted">
          Suggestions use the sections you select, your reading progress, and earlier project results. Reading a
          section does not count as demonstrating the skill. One project stays in focus.
        </p>
      </div>
      {error && (
        <p className="banner danger" role="alert">
          {error}
        </p>
      )}

      {detail && brief && (
        <section className="card stack">
          <p className="muted">
            Focused project · {detail.project.status} · {brief.grounding === "source_grounded" ? "Source-grounded" : "Topic-based"}
          </p>
          {draft ? (
            <input value={brief.title} onChange={(event) => patchBrief({ title: event.target.value })} />
          ) : (
            <h2>{brief.title}</h2>
          )}
          <BriefFields brief={brief} editable={draft} onChange={patchBrief} />
          <PlanPanel plan={detail.plan} />
          {draft && (
            <div className="row">
              <button className="btn" type="button" disabled={busy} onClick={() => void saveDraft()}>
                Save draft
              </button>
              <button
                className="btn primary"
                type="button"
                disabled={busy || detail.plan.activation !== "ready"}
                onClick={() => void approve("objective")}
              >
                Approve objective checks
              </button>
              <button className="btn" type="button" disabled={busy} onClick={() => void approve("ai_reviewed")}>
                Approve narrower AI review
              </button>
            </div>
          )}
          {detail.project.status === "active" && (
            <div className="row">
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() =>
                  void api(`/api/projects/${detail.project.id}/revise`, { method: "POST" }).then(() =>
                    load(detail.project.id),
                  )
                }
              >
                Edit scope as a new version
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() =>
                  void api(`/api/projects/${detail.project.id}/finish`, { method: "POST" }).then(() =>
                    load(detail.project.id),
                  )
                }
              >
                Mark finished
              </button>
            </div>
          )}
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
          {detail.versions.length > 0 && (
            <p className="muted">
              Frozen versions:{" "}
              {detail.versions.map((version) => `v${version.versionNumber} (${version.assessmentMode})`).join(", ")}
            </p>
          )}
          {detail.project.status === "active" && (
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void submitWork();
              }}
            >
              <h3>Submit this version</h3>
              <label>
                Approach
                <textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} required />
              </label>
              <label>
                Assumptions
                <textarea value={assumptions} onChange={(event) => setAssumptions(event.target.value)} required />
              </label>
              <label>
                Deliverable
                <textarea
                  value={deliverable}
                  onChange={(event) => setDeliverable(event.target.value)}
                  placeholder="For a numeric check, include a line such as answer: 0.5"
                  required
                />
              </label>
              {brief.predictionRequired && (
                <label>
                  Prediction, saved before any result is shown
                  <textarea value={prediction} onChange={(event) => setPrediction(event.target.value)} required />
                </label>
              )}
              <button className="btn primary" type="submit" disabled={busy}>
                Save submission
              </button>
            </form>
          )}
          {detail.submissions.map((submission) => {
            const review = detail.reviews.find((item) => item.submissionId === submission.id);
            const version = detail.versions.find((item) => item.id === submission.versionId);
            return (
              <article key={submission.id} className="stack">
                <h3>
                  Submission {submission.submissionNumber}
                  {version ? ` · rubric v${version.versionNumber}` : ""}
                </h3>
                <p>{submission.artifacts.deliverable}</p>
                <p className="muted">{submission.artifacts.explanation}</p>
                {submission.artifacts.prediction && <p>Prediction: {submission.artifacts.prediction}</p>}
                {!review && detail.project.status !== "draft" && (
                  <button className="btn" type="button" disabled={busy || !consent} onClick={() => void verify(submission.id)}>
                    Check this submission
                  </button>
                )}
                {review && <ReviewReport review={review} />}
                {review && review.questions.length > 0 && !review.answerReview && (
                  <form
                    className="stack"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendAnswers(review.id);
                    }}
                  >
                    {review.questions.map((question) => (
                      <label key={question.id}>
                        {question.prompt}
                        <textarea
                          value={answers[question.id] ?? ""}
                          onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}
                          required
                        />
                      </label>
                    ))}
                    <button className="btn" type="submit" disabled={busy || !consent}>
                      Submit answers
                    </button>
                  </form>
                )}
              </article>
            );
          })}
        </section>
      )}

      <section className="card stack">
        <h2>Suggest projects</h2>
        <p className="muted">
          Choose sections. A section with only a title produces a topic-based suggestion. The model runs when you ask,
          and the same context is reused. A book you opened stays listed here. Use the filter to add sections from
          other books to the same project.
        </p>
        <label>
          Filter sources
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Book or section title" />
        </label>
        {filter.trim().length < 2 && !fromBook && selected.length === 0 && (
          <p className="muted">Open a book and choose Suggest a project, or type at least two characters here.</p>
        )}
        {options?.books.filter((book) => {
          const needle = filter.trim().toLowerCase();
          const pinned = book.id === fromBook || book.chapters.some((chapter) => selected.includes(chapter.id));
          if (pinned) return book.chapters.length > 0;
          if (needle.length < 2) return false;
          return (
            book.title.toLowerCase().includes(needle) ||
            book.chapters.some((chapter) => chapter.title.toLowerCase().includes(needle))
          );
        }).map((book) => (
          <fieldset key={book.id}>
            <legend>{book.title}</legend>
            {book.chapters.filter((chapter) => {
              const needle = filter.trim().toLowerCase();
              const pinned = book.id === fromBook || selected.includes(chapter.id);
              if (pinned || needle.length < 2 || book.title.toLowerCase().includes(needle)) return true;
              return chapter.title.toLowerCase().includes(needle);
            }).map((chapter) => (
              <label key={chapter.id} className="row">
                <input
                  type="checkbox"
                  checked={selected.includes(chapter.id)}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(chapter.id)
                        ? current.filter((id) => id !== chapter.id)
                        : [...current, chapter.id].slice(0, 6),
                    )
                  }
                />
                <span>
                  {chapter.title} · {chapter.status} {chapter.progressPercent}% ·{" "}
                  {chapter.hasProse ? "source text available" : "title or outline only"}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
        <label>
          Goal
          <input value={goal} onChange={(event) => setGoal(event.target.value)} />
        </label>
        <label>
          Time budget, hours
          <input value={hours} onChange={(event) => setHours(event.target.value)} inputMode="decimal" />
        </label>
        <label>
          Preferred output
          <input value={output} onChange={(event) => setOutput(event.target.value)} />
        </label>
        <label>
          Tools you have
          <input value={tools} onChange={(event) => setTools(event.target.value)} />
        </label>
        <label>
          Ask for a smaller or different version
          <input value={instruction} onChange={(event) => setInstruction(event.target.value)} />
        </label>
        <label className="row">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          Send the selected section text to OpenRouter for this request
        </label>
        {options?.focused && (
          <label className="row">
            <input type="checkbox" checked={setAside} onChange={(event) => setSetAside(event.target.checked)} />
            Set aside “{options.focused.brief.title}” before starting another
          </label>
        )}
        <button className={`btn primary${busy ? " is-busy" : ""}`} type="button" disabled={busy || !consent || selected.length === 0} onClick={() => void suggest()}>
          {busy ? "Working…" : "Suggest projects"}
        </button>
        {reused && <p className="banner">These suggestions were reused. The selected context has not changed.</p>}
      </section>

      {batch && batch.proposals.length > 0 && (
        <section className="stack">
          {batch.proposals.map((proposal) => (
            <article key={proposal.id} className="card stack">
              <p className="muted">
                {FIT_LABEL[proposal.fit]} · {proposal.grounding === "source_grounded" ? "Source-grounded" : "Topic-based"} ·{" "}
                {proposal.effortMinHours}–{proposal.effortMaxHours} hours
              </p>
              <h2>{proposal.title}</h2>
              <ProposalBody proposal={proposal} />
              <label>
                Dismiss reason
                <input value={dismissReason} onChange={(event) => setDismissReason(event.target.value)} />
              </label>
              <div className="row">
                <button className="btn primary" type="button" disabled={busy} onClick={() => void accept(proposal.id)}>
                  Accept and review the brief
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={busy || dismissReason.trim().length < 3}
                  onClick={() => void dismissSuggestion(proposal.title)}
                >
                  Dismiss
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {options && options.projects.length > 0 && (
        <section className="card stack">
          <h2>Earlier projects</h2>
          {options.projects.map((project) => (
            <div key={project.id} className="row">
              <span>
                {project.brief.title} · {project.status}
                {project.dismissReason ? ` · ${project.dismissReason}` : ""}
              </span>
              <button className="btn" type="button" onClick={() => void load(project.id)}>
                Open
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function ProposalBody({ proposal }: { proposal: ProjectProposal }) {
  return (
    <>
      <p>
        <strong>Problem.</strong> {proposal.problem}
      </p>
      <p>
        <strong>Outcome.</strong> {proposal.outcome}
      </p>
      <p>
        <strong>Why it fits.</strong> {proposal.whyItFits}
      </p>
      <p>
        <strong>From the source.</strong> {proposal.sourceSupported.join("; ") || "No source-supported concept was confirmed."}
      </p>
      <p>
        <strong>Exercise added for practice.</strong> {proposal.inventedExercise}
      </p>
      <p>
        <strong>Familiar.</strong> {proposal.familiarConcepts.join("; ") || "None listed."}
      </p>
      <p>
        <strong>New.</strong> {proposal.newLearning.join("; ") || "None listed."}
      </p>
      <p>
        <strong>Prerequisites.</strong> {proposal.prerequisites.join("; ") || "None listed."}
      </p>
      <ul>
        {proposal.sources.map((source) => (
          <li key={`${source.chapterId}-${source.locator}`}>
            {source.bookTitle} — {source.chapterTitle} ({source.locator})
            {source.passage ? `: “${source.passage}”` : ""}
          </li>
        ))}
      </ul>
      <ol>
        {proposal.studySequence.map((step) => (
          <li key={`${step.title}-${step.why}`}>
            {step.title}
            {step.locator ? ` (${step.locator})` : ""} — {step.why}
          </li>
        ))}
      </ol>
      <p>
        <strong>Deliverables.</strong> {proposal.deliverables.join("; ")}
      </p>
      <p>
        <strong>Checkpoints.</strong> {proposal.checkpoints.join("; ")}
      </p>
      <p>
        <strong>Assumptions.</strong> {proposal.assumptions.join("; ") || "None listed."}
      </p>
      <p>
        <strong>Beyond previous projects.</strong> {proposal.beyondPrevious}
      </p>
      {proposal.verificationLimitations.map((item) => (
        <p key={item} className="banner">
          {item}
        </p>
      ))}
    </>
  );
}

function BriefFields({
  brief,
  editable,
  onChange,
}: {
  brief: ProjectProposal;
  editable: boolean;
  onChange: (patch: Partial<ProjectProposal>) => void;
}) {
  return (
    <>
      <ProposalBody proposal={brief} />
      {editable && (
        <>
          <label>
            Outcome
            <textarea value={brief.outcome} onChange={(event) => onChange({ outcome: event.target.value })} />
          </label>
          <label>
            Objectives, one per line
            <textarea
              value={brief.objectives.join("\n")}
              onChange={(event) =>
                onChange({ objectives: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) })
              }
            />
          </label>
          <label>
            Effort range, hours
            <input
              value={`${brief.effortMinHours}`}
              onChange={(event) => onChange({ effortMinHours: Number(event.target.value) || brief.effortMinHours })}
            />
          </label>
          {brief.criteria.map((criterion, index) => (
            <fieldset key={criterion.id}>
              <legend>
                {criterion.method} · {criterion.id}
              </legend>
              <textarea
                value={criterion.statement}
                onChange={(event) => {
                  const criteria = brief.criteria.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, statement: event.target.value } : item,
                  );
                  onChange({ criteria });
                }}
              />
              {criterion.method === "numeric_tolerance" && (
                <>
                  <input
                    value={criterion.referenceExpression ?? ""}
                    onChange={(event) => {
                      const criteria = brief.criteria.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, referenceExpression: event.target.value } : item,
                      );
                      onChange({ criteria });
                    }}
                  />
                  <input
                    value={criterion.knownGood ?? ""}
                    onChange={(event) => {
                      const criteria = brief.criteria.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, knownGood: event.target.value } : item,
                      );
                      onChange({ criteria });
                    }}
                  />
                </>
              )}
            </fieldset>
          ))}
        </>
      )}
    </>
  );
}

function PlanPanel({ plan }: { plan: Plan }) {
  return (
    <div className="stack">
      <p>
        Verification plan: {plan.activation}. Execution available: {plan.executionAvailable ? "yes" : "no"}.
      </p>
      {plan.issues.map((issue) => (
        <p key={`${issue.criterionId}-${issue.message}`} className={issue.severity === "block" ? "banner danger" : "banner"}>
          {issue.message}
        </p>
      ))}
    </div>
  );
}

function ReviewReport({ review }: { review: Review }) {
  return (
    <div className="stack">
      <p className={review.label === "verified" || review.label === "ai_reviewed" ? "banner good" : "banner"}>
        {labelText(review.label)}
      </p>
      {review.operational && <p className="banner">{review.operational.message}</p>}
      <h3>Objective checks</h3>
      {review.objective.map((item) => (
        <p key={item.criterionId}>
          {item.criterionId}: {item.status}. {item.explanation}
          {item.coverage ? ` Coverage: ${item.coverage}` : ""}
        </p>
      ))}
      <h3>Reasoning review</h3>
      {(review.reasoning ?? []).length === 0 && <p className="muted">Not reviewed.</p>}
      {(review.reasoning ?? []).map((item) => (
        <p key={item.criterionId}>
          {item.criterionId}: {item.judgment}. {item.explanation}
        </p>
      ))}
      {review.answerReview && (
        <>
          <h3>Answer review</h3>
          {review.answerReview.map((item) => (
            <p key={item.id}>
              {item.id}: {item.judgment}. {item.explanation}
            </p>
          ))}
        </>
      )}
      {review.nextAction && (
        <p>
          <strong>Next.</strong> {review.nextAction}
        </p>
      )}
    </div>
  );
}

function labelText(label: string): string {
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
