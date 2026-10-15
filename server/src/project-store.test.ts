import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { AppError, applyGrounding, assessmentLabel, type ProjectProposal } from "@progress-island/shared";
import { createApp } from "./app.js";
import { openDatabase } from "./db.js";
import {
  acceptProposal,
  addSubmission,
  approveProject,
  buildSuggestionContext,
  corpusForChapters,
  dismissSuggestion,
  findBatch,
  getSubmission,
  latestBatch,
  objectiveResultsFor,
  saveBatch,
  updateDraft,
} from "./project-store.js";
import { confirmChapters, createBook, insertSource, listChapters, updateChapter } from "./store.js";

const KALMAN = `The scalar update uses a gain K = P / (P + R). When the estimate variance P equals the measurement variance R, the gain is one half.`;
const ALGEBRA = `A linear equation ax + b = 0 has the solution x = -b / a when a is not zero. For a = 2 and b = -4 the solution is x = 2.`;

function tempDb() {
  const file = path.join(os.tmpdir(), `pi-proj-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const db = openDatabase(file);
  return {
    db,
    cleanup() {
      db.close();
      fs.rmSync(file, { force: true });
    },
  };
}

function seedSection(db: ReturnType<typeof openDatabase>, title: string, body: string) {
  const book = createBook(db, { title });
  const source = insertSource(db, {
    bookId: book.id,
    provenanceType: "pasted",
    provenanceLabel: "Pasted for a test",
    text: body,
  });
  const { chapters } = confirmChapters(
    db,
    book.id,
    source.id,
    [{ number: "1", title, sourceSpanStart: 0, sourceSpanEnd: body.length }],
    false,
  );
  return chapters[0];
}

function briefFor(chapterId: string, title: string, expression: string, good: string): ProjectProposal {
  return {
    id: "p1",
    title,
    fit: "apply",
    grounding: "source_grounded",
    problem: `Compute the worked value in ${title}.`,
    outcome: "One numeric answer and the assumption used.",
    whyItFits: "The section states the relation. Completing the section is not the same as computing it.",
    objectives: ["Compute the stated case."],
    familiarConcepts: ["Arithmetic."],
    newLearning: ["Substituting the stated values."],
    prerequisites: ["The selected section."],
    sources: [
      {
        bookId: "book",
        bookTitle: title,
        chapterId,
        chapterTitle: title,
        locator: "page 99",
        sourceHash: "invented",
        grounding: "source_grounded",
        passage: "this sentence was not in the source",
      },
    ],
    studySequence: [{ chapterId, title, locator: title, why: "The relation is stated in this section." }],
    deliverables: ["A line answer: <number> and the assumption."],
    checkpoints: ["Write the relation before substituting."],
    effortMinHours: 1,
    effortMaxHours: 2,
    assumptions: ["The stated values apply."],
    criteria: [
      {
        id: "value",
        statement: "The submitted value matches the frozen expression.",
        evidenceRequired: "A line of the form answer: <number>.",
        method: "numeric_tolerance",
        referenceExpression: expression,
        tolerance: 0.01,
        knownGood: good,
        faulty: ["0"],
        submissionField: "answer",
        coverage: "One comparison against the recomputed expression.",
      },
    ],
    beyondPrevious: "No earlier project computed this value.",
    verificationLimitations: [],
    predictionRequired: false,
    inventedExercise: "The substitution is the exercise. The source states the relation.",
    sourceSupported: ["The section states the relation used for the check."],
  };
}

describe("project process", () => {
  const handles: { cleanup: () => void }[] = [];
  afterEach(() => {
    while (handles.length) handles.pop()?.cleanup();
  });

  it("keeps suggestion context tied to progress and does not start a project from reading", () => {
    const h = tempDb();
    handles.push(h);
    const kalman = seedSection(h.db, "Scalar gain", KALMAN);
    const algebra = seedSection(h.db, "Linear equations", ALGEBRA);
    const outline = seedSection(h.db, "Outline only", "Outline only");
    const first = buildSuggestionContext(h.db, {
      chapterIds: [kalman.id, algebra.id],
      goal: "",
      hours: null,
      output: "",
      tools: "",
      instruction: "",
    });
    updateChapter(h.db, kalman.id, { progressPercent: 40 });
    const second = buildSuggestionContext(h.db, {
      chapterIds: [kalman.id, algebra.id],
      goal: "",
      hours: null,
      output: "",
      tools: "",
      instruction: "",
    });
    expect(second.hash).not.toBe(first.hash);
    const section = (first.packet as { sections: { topics: unknown[]; excerpt?: unknown }[] }).sections[0];
    expect(section?.excerpt).toBeUndefined();
    expect(section?.topics).toEqual([]);
    expect(latestBatch(h.db)).toBeNull();
    const corpus = corpusForChapters(h.db, [kalman.id, algebra.id, outline.id]);
    expect(corpus.find((item) => item.chapterId === outline.id)?.hasProse).toBe(false);
    expect(corpus.find((item) => item.chapterId === kalman.id)?.hasProse).toBe(true);
    const invented = applyGrounding(briefFor(kalman.id, "Scalar gain", "1/2", "0.5"), corpus);
    expect(invented.grounding).toBe("topic_based");
    expect(invented.sources[0]?.passage).toBeNull();
    expect(invented.sources[0]?.locator).not.toBe("page 99");
    const quoted = briefFor(kalman.id, "Scalar gain", "1/2", "0.5");
    quoted.sources = [{ ...quoted.sources[0]!, passage: "the gain is one half" }];
    const grounded = applyGrounding(quoted, corpus);
    expect(grounded.grounding).toBe("source_grounded");
    expect(grounded.sources[0]?.passage).toBe("the gain is one half");
    const topic = applyGrounding(briefFor(outline.id, "Outline only", "1/2", "0.5"), corpus);
    expect(topic.grounding).toBe("topic_based");
  });

  it("freezes a version, blocks a second focus, and keeps submission history", async () => {
    const h = tempDb();
    handles.push(h);
    const kalman = seedSection(h.db, "Scalar gain", KALMAN);
    const algebra = seedSection(h.db, "Linear equations", ALGEBRA);
    dismissSuggestion(h.db, "Too big", "That would take more than a weekend.");
    const context = buildSuggestionContext(h.db, {
      chapterIds: [kalman.id],
      goal: "practice",
      hours: 2,
      output: "a number",
      tools: "paper",
      instruction: "",
    });
    expect(JSON.stringify(context.packet)).toContain("That would take more than a weekend.");
    const kalmanBrief = applyGrounding(briefFor(kalman.id, "Scalar gain", "1/2", "0.5"), corpusForChapters(h.db, [kalman.id]));
    const batch = saveBatch(h.db, context.hash, { chapterIds: [kalman.id] }, [kalmanBrief]);
    expect(findBatch(h.db, context.hash)?.id).toBe(batch.id);
    const project = acceptProposal(h.db, batch.id, kalmanBrief.id, false);
    const app = createApp(h.db);
    const blocked = await request(app)
      .post("/api/projects")
      .send({ batchId: batch.id, proposalId: kalmanBrief.id });
    expect(blocked.status).toBe(409);

    const version = approveProject(h.db, project.id, "objective");
    expect(version.versionNumber).toBe(1);
    expect(version.sourceSnapshot[0]?.sourceHash).toBe(kalmanBrief.sources[0]?.sourceHash);
    expect(() => updateDraft(h.db, project.id, kalmanBrief)).toThrow(AppError);

    const first = addSubmission(h.db, project.id, {
      explanation: "P and R are equal, so the gain is one half.",
      assumptions: "Both variances are positive and equal.",
      deliverable: "answer: 0.5",
      prediction: null,
    });
    const again = addSubmission(h.db, project.id, {
      explanation: "A second attempt after checking the first.",
      assumptions: "Same equality.",
      deliverable: "answer: 0.9",
      prediction: null,
    });
    expect(getSubmission(h.db, first.id).artifacts.deliverable).toBe("answer: 0.5");
    expect(again.submissionNumber).toBe(2);
    expect(again.versionId).toBe(version.id);

    const objective = objectiveResultsFor(version, first.artifacts);
    expect(objective[0]?.status).toBe("passed");
    expect(
      assessmentLabel({
        assessmentMode: "objective",
        objective,
        reasoning: [{ criterionId: "value", judgment: "meets_rubric", explanation: "The assumption matches the case." }],
        operational: false,
      }),
    ).toBe("verified");

    const algebraBrief = applyGrounding(
      { ...briefFor(algebra.id, "Linear equations", "(4)/(2)", "2"), id: "p2", title: "Solve one equation" },
      corpusForChapters(h.db, [algebra.id]),
    );
    const algebraBatch = saveBatch(h.db, "algebra-context", { chapterIds: [algebra.id] }, [algebraBrief]);
    const algebraProject = acceptProposal(h.db, algebraBatch.id, algebraBrief.id, true);
    const algebraVersion = approveProject(h.db, algebraProject.id, "objective");
    const algebraSubmission = addSubmission(h.db, algebraProject.id, {
      explanation: "x = -b / a with a = 2 and b = -4.",
      assumptions: "a is not zero.",
      deliverable: "answer: 2",
      prediction: null,
    });
    expect(objectiveResultsFor(algebraVersion, algebraSubmission.artifacts)[0]?.status).toBe("passed");
    expect(listChapters(h.db, kalman.bookId)[0]?.status).not.toBe("mastered");
  });

  it("refuses an execution criterion as an objective verification", () => {
    const h = tempDb();
    handles.push(h);
    const chapter = seedSection(h.db, "Scalar gain", KALMAN);
    const brief = briefFor(chapter.id, "Scalar gain", "1/2", "0.5");
    brief.criteria = [
      {
        ...brief.criteria[0]!,
        id: "run",
        method: "execution",
        referenceExpression: null,
        tolerance: null,
        knownGood: null,
        faulty: [],
        statement: "The program prints the gain.",
      },
    ];
    const batch = saveBatch(h.db, "exec", {}, [brief]);
    const project = acceptProposal(h.db, batch.id, brief.id, false);
    expect(() => approveProject(h.db, project.id, "objective")).toThrow(AppError);
    const version = approveProject(h.db, project.id, "ai_reviewed");
    expect(version.assessmentMode).toBe("ai_reviewed");
    expect(version.brief.criteria.some((item) => item.method === "execution")).toBe(false);
    const submission = addSubmission(h.db, project.id, {
      explanation: "I would compute the gain by hand.",
      assumptions: "No program was run.",
      deliverable: "The gain is one half when the variances match.",
      prediction: null,
    });
    const objective = objectiveResultsFor(version, submission.artifacts);
    expect(objective.some((item) => item.method === "execution" && item.status !== "not_run")).toBe(false);
    expect(
      assessmentLabel({
        assessmentMode: version.assessmentMode,
        objective,
        reasoning: [
          {
            criterionId: version.brief.criteria[0]!.id,
            judgment: "meets_rubric",
            explanation: "The written scope matches the narrower review.",
          },
        ],
        operational: false,
      }),
    ).toBe("ai_reviewed");
  });
});
