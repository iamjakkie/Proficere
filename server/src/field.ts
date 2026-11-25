import {
  articlePdfProgress,
  articleSegments,
  bookPdfProgress,
  bookSegments,
  cleanPriority,
  courseProvider,
  courseSegments,
  growthForBook,
  pageSegments,
  workshopSegments,
  type FieldResource,
} from "@progress-island/shared";
import type { Db } from "./db.js";
import { listArticles, listCourses, listLessons, listWorkshopCards, listWorkshopProjects } from "./shelf-store.js";
import { listBooks, listCategories, listChapters } from "./store.js";

function assigned(category: string | null, ids: Set<string>): string | null {
  if (!category || !ids.has(category)) return null;
  return category;
}

/** Books, articles, courses, and workshop projects for the home field. Exercise sheets and exams are not included. */
export function fieldResources(db: Db): FieldResource[] {
  const ids = new Set(listCategories(db).map((category) => category.id));
  const resources: FieldResource[] = [];

  for (const book of listBooks(db)) {
    const chapters = listChapters(db, book.id);
    const pdf = book.libraryFilename ? bookPdfProgress(chapters, book.identifiers) : null;
    resources.push({
      id: book.id,
      kind: "book",
      title: book.title,
      category: assigned(book.identifiers.category?.trim() || null, ids),
      href: book.libraryFilename ? `/books/${book.id}/read` : `/books/${book.id}`,
      priority: cleanPriority(book.identifiers.priority),
      provider: null,
      providerLabel: null,
      segments: pdf ? pageSegments(pdf.read, pdf.total) : bookSegments(chapters, growthForBook(chapters, book.identifiers)),
      pages: pdf != null,
    });
  }

  for (const article of listArticles(db)) {
    if (article.kind === "workbook") continue;
    const pdf = article.libraryFilename ? articlePdfProgress(article.pagePosition, article.pageCount) : null;
    resources.push({
      id: article.id,
      kind: "article",
      title: article.title,
      category: assigned(article.category, ids),
      href: article.libraryFilename ? `/articles/${article.id}/read` : `/articles/${article.id}`,
      priority: article.priority,
      provider: null,
      providerLabel: null,
      segments: pdf ? pageSegments(pdf.read, pdf.total) : articleSegments(article.progressPercent),
      pages: pdf != null,
    });
  }

  for (const course of listCourses(db)) {
    const lessons = listLessons(db, course.id);
    const provider = courseProvider(course.url);
    resources.push({
      id: course.id,
      kind: "course",
      title: course.title,
      category: assigned(course.category, ids),
      href: `/courses/${course.id}`,
      priority: course.priority,
      provider: provider.id,
      providerLabel: provider.label,
      segments: courseSegments(lessons),
    });
  }

  for (const project of listWorkshopProjects(db)) {
    const cards = listWorkshopCards(db, project.id);
    resources.push({
      id: project.id,
      kind: "workshop",
      title: project.title,
      category: assigned(project.category, ids),
      href: `/workshop/${project.id}`,
      priority: project.priority,
      provider: null,
      providerLabel: null,
      segments: workshopSegments(cards),
    });
  }

  return resources.sort((a, b) => a.title.localeCompare(b.title) || a.kind.localeCompare(b.kind));
}
