import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Article } from "@progress-island/shared";
import { api } from "../api";

type LibraryFile = { name: string; size: number };

export function ArticlePage() {
  const { id } = useParams();
  const [article, setArticle] = useState<Article | null>(null);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<{ article: Article }>(`/api/articles/${id}`)
      .then((data) => {
        setArticle(data.article);
        setNote(data.article.note ?? "");
      })
      .catch((err: Error) => setError(err.message));
    api<{ configured: boolean; files: LibraryFile[] }>("/api/library")
      .then((data) => {
        setLibraryReady(data.configured);
        setFiles(data.files);
      })
      .catch(() => setLibraryReady(false));
  }, [id]);

  async function saveNote() {
    if (!article) return;
    setError(null);
    const data = await api<{ article: Article }>(`/api/articles/${article.id}`, {
      method: "PATCH",
      body: JSON.stringify({ note }),
    });
    setArticle(data.article);
  }

  async function chooseFile(filename: string) {
    if (!article) return;
    setError(null);
    try {
      const data = await api<{ article: Article }>(`/api/articles/${article.id}/library`, {
        method: "PUT",
        body: JSON.stringify({ filename: filename || null }),
      });
      setArticle(data.article);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setStatus(status: Article["status"]) {
    if (!article) return;
    const data = await api<{ article: Article }>(`/api/articles/${article.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    setArticle(data.article);
  }

  if (error && !article) return <p className="banner danger">{error}</p>;
  if (!article) return <p>Loading article…</p>;

  const missingPdf = !article.libraryFilename;
  const finished = article.status === "completed";

  return (
    <div className="stack">
      <p>
        <Link to={article.kind === "workbook" ? "/exercises" : "/articles"}>
          {article.kind === "workbook" ? "Exercises" : "Articles"}
        </Link>
      </p>
      <section className={article.kind === "workbook" ? "card workbook-shelf" : "card article-shelf"}>
        <p className="muted">{article.kind === "workbook" ? "Exercise sheet" : "Article"}</p>
        <h1>{article.title}</h1>
        {finished && <p className="banner good">Finished.</p>}
        {missingPdf && article.kind === "article" && (
          <p className="banner">No PDF attached. You can still keep a short note, or choose a file from the library folder.</p>
        )}
        {missingPdf && article.kind === "workbook" && (
          <p className="banner">
            This workbook is a link. It was not copied into the book library.
            {article.externalUrl && (
              <>
                {" "}
                <a href={article.externalUrl} target="_blank" rel="noreferrer">
                  Open the PDF
                </a>
              </>
            )}
          </p>
        )}
        {error && <p className="banner danger">{error}</p>}
        {!libraryReady && <p className="muted">Set a PDF library folder in Settings to attach a file.</p>}
        {libraryReady && (
          <label className="stack">
            PDF in the library folder
            <select
              aria-label="Article PDF"
              value={article.libraryFilename ?? ""}
              onChange={(event) => void chooseFile(event.target.value)}
            >
              <option value="">No PDF</option>
              {article.libraryFilename && !files.some((file) => file.name === article.libraryFilename) && (
                <option value={article.libraryFilename}>{article.libraryFilename} (missing)</option>
              )}
              {files.map((file) => (
                <option key={file.name} value={file.name}>
                  {file.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {article.libraryFilename && (
          <p>
            <Link className="btn primary" to={`/articles/${article.id}/read`}>
              Read
            </Link>
            <span className="muted">
              {" "}
              {article.pageCount
                ? `Page ${article.pagePosition} of ${article.pageCount}`
                : "Progress follows the furthest page you open."}
            </span>
          </p>
        )}
        {article.externalUrl && article.kind === "workbook" && (
          <p className="muted">{article.sourceHost}</p>
        )}
        <label className="stack">
          Note
          <textarea aria-label="Article note" rows={5} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <p className="row-actions">
          <button className="btn" type="button" onClick={() => void saveNote()}>
            Save note
          </button>
          {finished ? (
            <button className="btn" type="button" onClick={() => void setStatus("reading")}>
              Still reading
            </button>
          ) : (
            <button className="btn good" type="button" onClick={() => void setStatus("completed")}>
              Mark finished
            </button>
          )}
        </p>
      </section>
    </div>
  );
}
