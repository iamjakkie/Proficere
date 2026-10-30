import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Article } from "@progress-island/shared";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api } from "../api";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function pdfErrorMessage(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "PasswordException") return "This PDF is password protected, so it cannot be opened here.";
  if (name === "InvalidPDFException") return "That file is not a readable PDF.";
  if (name === "RenderingCancelledException") return "";
  if (error instanceof Error && error.message) return error.message;
  return "That PDF is missing from the library folder or could not be opened.";
}

export function ArticleReadPage() {
  const { id } = useParams();
  const [article, setArticle] = useState<Article | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderChain = useRef<Promise<void>>(Promise.resolve());
  const docRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api<{ article: Article }>(`/api/articles/${id}`)
      .then((data) => {
        if (cancelled) return;
        setArticle(data.article);
        setPage(Math.max(1, data.article.pagePosition));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!article?.libraryFilename || !id) return;
    let cancelled = false;
    const task = pdfjs.getDocument({
      url: `/api/articles/${id}/pdf`,
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
  }, [id, article?.libraryFilename]);

  useEffect(() => {
    if (!doc || !article || !id) return;
    const timer = window.setTimeout(() => {
      api<{ article: Article }>(`/api/articles/${id}/reading`, {
        method: "POST",
        body: JSON.stringify({ page, pageCount: doc.numPages }),
      })
        .then((data) => setArticle(data.article))
        .catch(() => setError("Could not save reading progress."));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [doc, page, id, article?.libraryFilename]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!doc || !canvas || !stage) return;
    let cancelled = false;
    const tasks: RenderTask[] = [];
    const job = renderChain.current.catch(() => undefined).then(async () => {
      if (cancelled) return;
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const unscaled = pdfPage.getViewport({ scale: 1 });
      const fit = Math.min((stage.clientWidth - 24) / unscaled.width, (stage.clientHeight - 24) / unscaled.height);
      const viewport = pdfPage.getViewport({ scale: Math.max(0.1, fit) });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d");
      if (!context || cancelled) return;
      const task = pdfPage.render({
        canvasContext: context,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      tasks.push(task);
      await task.promise;
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
    return () => {
      cancelled = true;
      for (const task of tasks) task.cancel();
    };
  }, [doc, page]);

  if (!article && error) return <p className="banner danger">{error}</p>;
  if (!article) return <p>Loading article…</p>;

  if (!article.libraryFilename) {
    return (
      <div className="stack">
        <p className="banner">No PDF attached. Choose one from the article page, or keep this as a note.</p>
        <Link to={`/articles/${article.id}`}>Back to {article.title}</Link>
      </div>
    );
  }

  const pageCount = doc?.numPages ?? article.pageCount;

  return (
    <div className="reader-page article-reader">
      <header className="reader-toolbar">
        <Link to={`/articles/${article.id}`}>{article.title}</Link>
        <span className="muted">{article.kind === "workbook" ? "Exercise sheet" : "Article"} · not a book</span>
        <span className="reader-page-label">
          Page
          <input
            aria-label="Page number"
            value={page}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isInteger(next) && next > 0) setPage(pageCount ? Math.min(pageCount, next) : next);
            }}
          />
          {pageCount ? ` of ${pageCount}` : ""}
        </span>
        <button className="btn" type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
          Previous
        </button>
        <button
          className="btn"
          type="button"
          disabled={pageCount != null && page >= pageCount}
          onClick={() => setPage((current) => current + 1)}
        >
          Next
        </button>
        {article.status === "completed" && <span className="banner good">Finished</span>}
      </header>
      {error && <p className="banner danger">{error}</p>}
      <div className="reader-stage" ref={stageRef}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
