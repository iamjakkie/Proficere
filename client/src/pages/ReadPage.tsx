import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { Book, Chapter } from "@progress-island/shared";
import { resumePdfPage } from "@progress-island/shared";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api } from "../api";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;

type ExamGate = {
  chapterId: string;
  title: string;
  bookId: string;
  projectId: string | null;
  message: string;
  resumePage: number;
  failure: string | null;
};

function pdfErrorMessage(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "PasswordException") return "This PDF is password protected, so it cannot be opened here.";
  if (name === "InvalidPDFException") return "That file is not a readable PDF.";
  if (name === "RenderingCancelledException") return "";
  if (error instanceof Error && error.message) return error.message;
  return "Could not open this PDF.";
}

function trackingLabel(book: Book, chapters: Chapter[], page: number, pageCount: number | null): string {
  const located = chapters.some((chapter) => chapter.pdfPageStart != null);
  if (located) {
    const current = chapters.find((chapter) => chapter.id === chapterCovering(chapters, page));
    if (current) return `${current.title} · ${current.progressPercent}% read`;
    return "This page is outside the saved chapters, so it does not change their progress.";
  }
  const read = Number(book.identifiers.readPdfPage);
  const total = Number(book.identifiers.pdfPageCount) || pageCount;
  if (Number.isInteger(read) && read > 0 && total) {
    return `Tracked through page ${read} of ${total}. Opening a later page counts it as read.`;
  }
  return "Reading progress is saved as you turn pages.";
}

/** Odd page on the left, the following page on the right. */
function pairStart(page: number): number {
  return page % 2 === 0 ? Math.max(1, page - 1) : page;
}

function chapterCovering(chapters: Chapter[], page: number): string | null {
  let current: string | null = null;
  const known = chapters
    .filter((chapter) => chapter.pdfPageStart != null)
    .sort((a, b) => (a.pdfPageStart ?? 0) - (b.pdfPageStart ?? 0));
  for (const chapter of known) {
    if ((chapter.pdfPageStart ?? 0) <= page) current = chapter.id;
    else break;
  }
  return current;
}

export function ReadPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(() => {
    const requested = Number(params.get("page"));
    return Number.isInteger(requested) && requested > 0 ? requested : 1;
  });
  const [pageDraft, setPageDraft] = useState(String(page));
  const [zoom, setZoom] = useState(1);
  const [spread, setSpread] = useState(false);
  const [stageBox, setStageBox] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);
  const [examGate, setExamGate] = useState<ExamGate | null>(null);
  const [examBusy, setExamBusy] = useState(false);
  const [placed, setPlaced] = useState(() => params.has("page"));
  const stageRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const rightRef = useRef<HTMLCanvasElement>(null);
  const renderChain = useRef<Promise<void>>(Promise.resolve());
  const docRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    setPageDraft(String(page));
  }, [page]);

  useEffect(() => {
    let cancelled = false;
    api<{ book: Book; chapters: Chapter[] }>(`/api/books/${id}`)
      .then((data) => {
        if (cancelled) return;
        setBook(data.book);
        setChapters(data.chapters);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!book || placed) return;
    if (!params.has("page")) {
      const chapter = chapters.find((item) => item.id === params.get("chapter"));
      const resume = chapter ? resumePdfPage(chapter) : null;
      const last = Number(book.identifiers.lastPdfPage);
      if (resume) setPage(resume);
      else if (Number.isInteger(last) && last > 0) setPage(last);
    }
    setPlaced(true);
  }, [book, chapters, placed, params]);

  useEffect(() => {
    if (!placed || !doc || !book?.libraryFilename || !id) return;
    const pageCount = doc.numPages;
    const seen = spread ? Math.min(pageCount, pairStart(page) + 1) : page;
    const timer = window.setTimeout(() => {
      api<{ book: Book; chapters: Chapter[]; examLock: string | null; examGate: ExamGate | null }>(
        `/api/books/${id}/reading`,
        {
          method: "POST",
          body: JSON.stringify({ page: seen, pageCount }),
        },
      )
        .then((data) => {
          setBook(data.book);
          setChapters(data.chapters);
          setExamGate(data.examGate);
          if (data.examGate) setError(null);
          else if (data.examLock) setError(data.examLock);
          else setError((current) => (current === "Could not save reading progress." || current?.startsWith("Pass the exam") ? null : current));
        })
        .catch(() => setError("Could not save reading progress."));
      }, 400);
    return () => window.clearTimeout(timer);
  }, [placed, page, spread, doc, id, book?.libraryFilename]);

  useEffect(() => {
    if (!examGate || examGate.projectId || examGate.failure || !placed || !doc || !id) return;
    const pageCount = doc.numPages;
    const seen = spread ? Math.min(pageCount, pairStart(page) + 1) : page;
    const timer = window.setInterval(() => {
      api<{ examGate: ExamGate | null }>(`/api/books/${id}/reading`, {
        method: "POST",
        body: JSON.stringify({ page: seen, pageCount }),
      })
        .then((data) => {
          if (data.examGate) setExamGate(data.examGate);
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [examGate, placed, doc, id, page, spread]);

  useEffect(() => {
    if (!placed) return;
    if (params.get("page") === String(page)) return;
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    setParams(next, { replace: true });
  }, [page, placed, params, setParams]);

  useEffect(() => {
    if (!book?.libraryFilename) return;
    let cancelled = false;
    const task = pdfjs.getDocument({
      url: `/api/books/${id}/pdf`,
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      disableAutoFetch: true,
    });
    task.promise
      .then((loaded) => {
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        docRef.current = loaded;
        setDoc(loaded);
        setPage((current) => Math.min(loaded.numPages, Math.max(1, current)));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = pdfErrorMessage(err);
        if (message) setError(message);
      });
    return () => {
      cancelled = true;
      void task.destroy();
      const open = docRef.current;
      docRef.current = null;
      if (open) void open.destroy();
      setDoc(null);
    };
  }, [id, book?.libraryFilename]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setStageBox((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [book]);

  useEffect(() => {
    const leftCanvas = leftRef.current;
    const rightCanvas = rightRef.current;
    if (!doc || !leftCanvas || stageBox.width < 40 || stageBox.height < 40) return;
    const start = spread ? pairStart(page) : page;
    const numbers = spread && start < doc.numPages ? [start, start + 1] : [start];
    if (numbers.length > 1 && !rightCanvas) return;
    let cancelled = false;
    const tasks: RenderTask[] = [];
    const job = renderChain.current.catch(() => undefined).then(async () => {
      if (cancelled) return;
      const pdfPages = [];
      for (const number of numbers) {
        const pdfPage = await doc.getPage(number);
        if (cancelled) return;
        pdfPages.push(pdfPage);
      }
      if (cancelled || pdfPages.length !== numbers.length) return;
      const unscaled = pdfPages.map((pdfPage) => pdfPage.getViewport({ scale: 1 }));
      const gap = numbers.length > 1 ? 8 : 0;
      const fit = Math.min(
        (stageBox.width - 16 - gap) / unscaled.reduce((sum, view) => sum + view.width, 0),
        (stageBox.height - 16) / Math.max(...unscaled.map((view) => view.height)),
      );
      const scale = Math.max(0.1, fit) * zoom;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvases = [leftCanvas, rightCanvas];
      const viewports = pdfPages.map((pdfPage, index) => {
        const canvas = canvases[index];
        const viewport = pdfPage.getViewport({ scale });
        if (!canvas) return null;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        return viewport;
      });
      if (cancelled || viewports.some((viewport) => viewport == null)) return;
      await Promise.all(
        pdfPages.map((pdfPage, index) => {
          const canvas = canvases[index];
          const viewport = viewports[index];
          const context = canvas?.getContext("2d");
          if (!canvas || !viewport || !context || cancelled) return Promise.resolve();
          const task = pdfPage.render({
            canvasContext: context,
            viewport,
            transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
          });
          tasks.push(task);
          return task.promise;
        }),
      );
    });
    renderChain.current = job.then(
      () => undefined,
      () => undefined,
    );
    job.catch((err: unknown) => {
      if (cancelled) return;
      const message = pdfErrorMessage(err);
      if (message) setError(message);
    });
    stageRef.current?.scrollTo({ top: 0, left: 0 });
    return () => {
      cancelled = true;
      for (const task of tasks) task.cancel();
    };
  }, [doc, page, spread, zoom, stageBox.width, stageBox.height]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        turn(1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        turn(-1);
      } else if (event.key === "+" || event.key === "=") {
        setZoom((current) => Math.min(MAX_ZOOM, current * 1.15));
      } else if (event.key === "-" || event.key === "_") {
        setZoom((current) => Math.max(MIN_ZOOM, current / 1.15));
      } else if (event.key === "0") {
        setZoom(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, spread, examGate, page]);

  async function retryExam() {
    if (!id || !examGate || !doc) return;
    setExamBusy(true);
    try {
      const seen = spread ? Math.min(doc.numPages, pairStart(page) + 1) : page;
      const data = await api<{ examGate: ExamGate | null }>(`/api/books/${id}/reading/exam`, {
        method: "POST",
        body: JSON.stringify({ page: seen, pageCount: doc.numPages, chapterId: examGate.chapterId }),
      });
      setExamGate(data.examGate);
    } catch (err) {
      const message = err instanceof Error ? err.message : "The exam was not created.";
      setExamGate((current) => (current ? { ...current, failure: message } : current));
    } finally {
      setExamBusy(false);
    }
  }

  function pastExam(target: number): boolean {
    return examGate != null && target > examGate.resumePage;
  }

  function turn(delta: number) {
    const last = doc?.numPages;
    if (!last) return;
    setPage((current) => {
      const next = spread ? pairStart(current) + delta * 2 : current + delta;
      const clamped = Math.min(last, Math.max(1, next));
      if (delta > 0 && pastExam(clamped)) return current;
      return clamped;
    });
  }

  function commitPage() {
    const requested = Number(pageDraft);
    if (!Number.isInteger(requested) || pastExam(requested)) {
      setPageDraft(String(page));
      return;
    }
    const last = doc?.numPages ?? requested;
    setPage(Math.min(last, Math.max(1, requested)));
  }

  function openChapter(chapter: Chapter) {
    const resume = resumePdfPage(chapter);
    if (resume == null || pastExam(resume)) return;
    setPage(resume);
  }

  if (!book && !error) return <p>Opening PDF…</p>;
  if (!book) return <p className="banner danger">{error}</p>;

  const currentChapter = chapterCovering(chapters, page);
  const pages = doc?.numPages ?? null;
  const spreadStart = spread ? pairStart(page) : page;
  const spreadEnd = spread && pages != null && spreadStart < pages ? spreadStart + 1 : spreadStart;

  return (
    <div className="reader-page">
      <div className="reader-toolbar">
        <Link className="btn ghost" to={`/books/${book.id}`}>
          Back to book
        </Link>
        <strong className="reader-title">{book.title}</strong>
        <div className="row">
          <button className="btn" type="button" disabled={!doc || spreadStart <= 1} onClick={() => turn(-1)}>
            Previous
          </button>
          <label className="reader-page-label">
            Page
            <input
              value={pageDraft}
              inputMode="numeric"
              aria-label="Page number"
              onChange={(event) => setPageDraft(event.target.value)}
              onBlur={commitPage}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitPage();
              }}
            />
            of {pages ?? "…"}
          </label>
          <button
            className="btn"
            type="button"
            disabled={!doc || spreadEnd >= (pages ?? page) || pastExam(page + (spread ? 2 : 1))}
            onClick={() => turn(1)}
          >
            Next
          </button>
        </div>
        <div className="row">
          <button
            className={spread ? "btn primary" : "btn"}
            type="button"
            aria-pressed={spread}
            disabled={!doc}
            onClick={() => setSpread((current) => !current)}
          >
            Two pages
          </button>
          <button className="btn" type="button" onClick={() => setZoom((current) => Math.max(MIN_ZOOM, current / 1.15))}>
            Zoom out
          </button>
          <button className="btn" type="button" onClick={() => setZoom(1)}>
            {zoom === 1 ? "Fit page" : `${Math.round(zoom * 100)}%`}
          </button>
          <button className="btn" type="button" onClick={() => setZoom((current) => Math.min(MAX_ZOOM, current * 1.15))}>
            Zoom in
          </button>
        </div>
      </div>
      <p className="reader-track">{trackingLabel(book, chapters, page, pages)}</p>
      {error && <p className="banner danger">{error}</p>}
      {!book.libraryFilename && (
        <p className="banner">Attach a PDF on the book page before opening it here.</p>
      )}
      <div className="reader">
        <aside className="reader-chapters">
          <h2>Chapters</h2>
          {chapters.length === 0 && <p className="muted">No chapters saved yet.</p>}
          {chapters.map((chapter) => (
            <button
              key={chapter.id}
              type="button"
              className={chapter.id === currentChapter ? "reader-chapter current" : "reader-chapter"}
              disabled={chapter.pdfPageStart == null}
              onClick={() => openChapter(chapter)}
            >
              <span>
                {chapter.number ? `${chapter.number}. ` : ""}
                {chapter.title}
              </span>
              <span className="muted">
                {chapter.pdfPageStart == null ? "page unknown" : `p. ${chapter.pdfPageStart}`}
                {chapter.progressPercent > 0 ? ` · ${chapter.progressPercent}%` : ""}
              </span>
            </button>
          ))}
        </aside>
        <div className="reader-stage" ref={stageRef}>
          {book.libraryFilename && !doc && !error && <p className="reader-status">Opening PDF…</p>}
          <div className="reader-spread">
            <canvas ref={leftRef} aria-label={`Page ${spreadStart}`} />
            {spreadEnd > spreadStart && <canvas ref={rightRef} aria-label={`Page ${spreadEnd}`} />}
          </div>
        </div>
      </div>
      {examGate && (
        <div className="reader-gate" role="dialog" aria-modal="true" aria-labelledby="reader-gate-title">
          <div className="reader-gate-card">
            <h2 id="reader-gate-title">Pass this exam before continuing</h2>
            <p>{examGate.message}</p>
            {examGate.projectId ? (
              <p>This exam is ready.</p>
            ) : examGate.failure ? (
              <p>{examGate.failure} It is not in the list of exams you have already passed.</p>
            ) : (
              <p className="muted">This exam is still being written. It is not in your exam list yet.</p>
            )}
            <div className="row">
              {examGate.projectId ? (
                <Link className="btn primary" to={`/projects?project=${examGate.projectId}`}>
                  Open the exam
                </Link>
              ) : (
                <button className="btn primary" type="button" disabled={examBusy || !examGate.failure} onClick={() => void retryExam()}>
                  {examBusy ? "Writing the exam…" : examGate.failure ? "Try again" : "Writing the exam…"}
                </button>
              )}
              <button className="btn" type="button" onClick={() => setPage(examGate.resumePage)}>
                Stay on this chapter
              </button>
              <Link className="btn" to={`/books/${id}`}>
                Back to the book
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
