import type { Express, NextFunction, Request, Response } from "express";
import path from "node:path";
import { z } from "zod";
import {
  AppError,
  WorkshopColumnSchema,
  WorkshopPlanSchema,
} from "@progress-island/shared";
import { aiConfigured } from "./config.js";
import type { Db } from "./db.js";
import { exerciseSearchState, runManualExerciseSearch } from "./exercise-search.js";
import { chatJson } from "./openrouter.js";
import {
  acceptSuggestion,
  addPlannedCards,
  articlePdfFile,
  attachArticlePdf,
  confirmLessons,
  setArticleCategory,
  setCourseCategory,
  createArticle,
  createCourse,
  createWorkshopCard,
  createWorkshopProject,
  getArticle,
  getCourse,
  getWorkshopProject,
  listArticles,
  listCourses,
  listLessons,
  listWorkshopCards,
  listWorkshopProjects,
  recordArticleReading,
  rejectSuggestion,
  setLessonDone,
  updateArticle,
  updateWorkshopCard,
  updateWorkshopProject,
} from "./shelf-store.js";
import { fetchLessonTitles } from "./syllabus.js";

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next);
  };
}

function requireConsent(consent: boolean | undefined): void {
  if (!consent) {
    throw new AppError(
      "Planning sends this description to OpenRouter and then to the selected model provider. Confirm that you understand this before continuing. Local SQLite storage does not mean processing stays on this Mac.",
      "consent_required",
      400,
    );
  }
}

export function registerShelfRoutes(app: Express, db: Db): void {
  app.get("/api/articles", (_req, res) => {
    res.json({ articles: listArticles(db) });
  });

  app.post(
    "/api/articles",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          title: z.string().min(1),
          kind: z.enum(["article", "workbook"]).optional(),
          note: z.string().optional().nullable(),
        })
        .parse(req.body);
      res.status(201).json({ article: createArticle(db, body) });
    }),
  );

  app.get(
    "/api/articles/:id",
    asyncHandler(async (req, res) => {
      res.json({ article: getArticle(db, req.params.id) });
    }),
  );

  app.patch(
    "/api/articles/:id",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          title: z.string().min(1).optional(),
          note: z.string().nullable().optional(),
          status: z.enum(["not_started", "reading", "completed"]).optional(),
        })
        .parse(req.body);
      res.json({ article: updateArticle(db, req.params.id, body) });
    }),
  );

  app.put(
    "/api/articles/:id/category",
    asyncHandler(async (req, res) => {
      const body = z.object({ category: z.string().min(1).max(40).nullable() }).parse(req.body);
      res.json({ article: setArticleCategory(db, req.params.id, body.category) });
    }),
  );

  app.put(
    "/api/articles/:id/library",
    asyncHandler(async (req, res) => {
      const body = z.object({ filename: z.string().nullable() }).parse(req.body);
      res.json({ article: attachArticlePdf(db, req.params.id, body.filename) });
    }),
  );

  app.post(
    "/api/articles/:id/reading",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          page: z.number().int().positive(),
          pageCount: z.number().int().positive(),
        })
        .parse(req.body);
      res.json({ article: recordArticleReading(db, req.params.id, body.page, body.pageCount) });
    }),
  );

  app.get("/api/articles/:id/pdf", (req, res, next) => {
    try {
      const file = articlePdfFile(db, req.params.id);
      const base = path.basename(file);
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(base)}`);
      res.sendFile(file, (err) => {
        if (!err || res.headersSent) return;
        next(err);
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/courses", (_req, res) => {
    const courses = listCourses(db).map((course) => {
      const lessons = listLessons(db, course.id);
      return {
        ...course,
        lessonCount: lessons.length,
        doneCount: lessons.filter((lesson) => lesson.done).length,
      };
    });
    res.json({ courses });
  });

  app.post(
    "/api/courses/syllabus",
    asyncHandler(async (req, res) => {
      const body = z.object({ url: z.string().min(1) }).parse(req.body);
      const titles = await fetchLessonTitles(body.url);
      res.json({ titles });
    }),
  );

  app.post(
    "/api/courses",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          title: z.string().min(1),
          url: z.string().min(1),
          note: z.string().optional().nullable(),
        })
        .parse(req.body);
      res.status(201).json({ course: createCourse(db, body) });
    }),
  );

  app.get(
    "/api/courses/:id",
    asyncHandler(async (req, res) => {
      const course = getCourse(db, req.params.id);
      res.json({ course, lessons: listLessons(db, course.id) });
    }),
  );

  app.put(
    "/api/courses/:id/category",
    asyncHandler(async (req, res) => {
      const body = z.object({ category: z.string().min(1).max(40).nullable() }).parse(req.body);
      res.json({ course: setCourseCategory(db, req.params.id, body.category) });
    }),
  );

  app.post(
    "/api/courses/:id/lessons/confirm",
    asyncHandler(async (req, res) => {
      const body = z.object({ titles: z.array(z.string()) }).parse(req.body);
      const titles = body.titles.map((title) => title.trim()).filter((title) => title.length > 0);
      res.json({ lessons: confirmLessons(db, req.params.id, titles) });
    }),
  );

  app.patch(
    "/api/courses/:id/lessons/:lessonId",
    asyncHandler(async (req, res) => {
      const body = z.object({ done: z.boolean() }).parse(req.body);
      res.json({ lesson: setLessonDone(db, req.params.id, req.params.lessonId, body.done) });
    }),
  );

  app.get("/api/workshop/projects", (_req, res) => {
    res.json({ projects: listWorkshopProjects(db), ai: { configured: aiConfigured() } });
  });

  app.post(
    "/api/workshop/projects",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          title: z.string().min(1),
          description: z.string().optional().nullable(),
          category: z.string().optional().nullable(),
          tags: z.array(z.string()).optional(),
        })
        .parse(req.body);
      res.status(201).json({ project: createWorkshopProject(db, body) });
    }),
  );

  app.get(
    "/api/workshop/projects/:id",
    asyncHandler(async (req, res) => {
      const project = getWorkshopProject(db, req.params.id);
      res.json({
        project,
        cards: listWorkshopCards(db, project.id),
        projects: listWorkshopProjects(db),
        ai: { configured: aiConfigured() },
      });
    }),
  );

  app.patch(
    "/api/workshop/projects/:id",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          title: z.string().min(1).optional(),
          description: z.string().nullable().optional(),
          category: z.string().nullable().optional(),
          tags: z.array(z.string()).optional(),
        })
        .parse(req.body);
      res.json({ project: updateWorkshopProject(db, req.params.id, body) });
    }),
  );

  app.post(
    "/api/workshop/projects/:id/cards",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          title: z.string().min(1),
          detail: z.string().optional().nullable(),
          column: WorkshopColumnSchema.optional(),
        })
        .parse(req.body);
      res.status(201).json({ card: createWorkshopCard(db, req.params.id, body) });
    }),
  );

  app.post(
    "/api/workshop/projects/:id/plan",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          description: z.string().min(1),
          consent: z.boolean().optional(),
        })
        .parse(req.body);
      if (!aiConfigured()) {
        throw new AppError(
          "Configure OpenRouter to enable AI. Add OPENROUTER_API_KEY and OPENROUTER_MODEL to .env. The board still works without a plan.",
          "missing_config",
          400,
        );
      }
      requireConsent(body.consent);
      const project = updateWorkshopProject(db, req.params.id, { description: body.description });
      const plan = await chatJson(
        WorkshopPlanSchema,
        [
          "Plan a personal learning project as kanban cards.",
          'Return JSON {"cards":[{"title":"short name","detail":"one or two sentences","column":"todo"}]}',
          "column must be todo, in_progress, test, or done.",
          "Return between 3 and 8 cards. Do not invent credentials, downloads, or accounts.",
        ].join(" "),
        [
          `Title: ${project.title}`,
          `Category: ${project.category ?? "none"}`,
          `Tags: ${project.tags.join(", ") || "none"}`,
          `Description:\n${body.description}`,
        ].join("\n"),
      );
      const cards = addPlannedCards(db, project.id, plan);
      res.json({ project, cards: listWorkshopCards(db, project.id), added: cards.length });
    }),
  );

  app.patch(
    "/api/workshop/cards/:id",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          title: z.string().min(1).optional(),
          detail: z.string().nullable().optional(),
          column: WorkshopColumnSchema.optional(),
          position: z.number().int().nonnegative().optional(),
        })
        .parse(req.body);
      res.json({ card: updateWorkshopCard(db, req.params.id, body) });
    }),
  );

  app.get("/api/exercise-search", (_req, res) => {
    res.json(exerciseSearchState(db));
  });

  app.post(
    "/api/exercise-search",
    asyncHandler(async (req, res) => {
      const body = z.object({ consent: z.boolean().optional() }).parse(req.body ?? {});
      res.json(await runManualExerciseSearch(db, Boolean(body.consent)));
    }),
  );

  app.post(
    "/api/exercise-suggestions/:id/accept",
    asyncHandler(async (req, res) => {
      res.json(acceptSuggestion(db, req.params.id));
    }),
  );

  app.post(
    "/api/exercise-suggestions/:id/reject",
    asyncHandler(async (req, res) => {
      rejectSuggestion(db, req.params.id);
      res.json({ suggestions: exerciseSearchState(db).suggestions });
    }),
  );
}
