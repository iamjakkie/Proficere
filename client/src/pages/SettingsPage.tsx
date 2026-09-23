import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { api } from "../api";

export function SettingsPage() {
  const [ai, setAi] = useState<{
    configured: boolean;
    hasKey: boolean;
    model: string | null;
    notice?: string;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [libraryPath, setLibraryPath] = useState("");
  const [libraryCount, setLibraryCount] = useState<number | null>(null);

  useEffect(() => {
    api<typeof ai>("/api/ai").then(setAi);
    api<{ path: string | null; files: unknown[]; error: string | null; configured: boolean }>(
      "/api/library",
    ).then((library) => {
      setLibraryPath(library.path ?? "");
      setLibraryCount(library.configured && !library.error ? library.files.length : null);
      if (library.error) setError(library.error);
    });
  }, []);

  async function saveLibrary(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const library = await api<{
        path: string | null;
        files: unknown[];
        error: string | null;
      }>("/api/library", {
        method: "PUT",
        body: JSON.stringify({ path: libraryPath }),
      });
      setLibraryPath(library.path ?? "");
      setLibraryCount(library.error ? null : library.files.length);
      setMessage(
        library.path
          ? `PDF library set. Found ${library.files.length} PDF file${library.files.length === 1 ? "" : "s"}.`
          : "PDF library folder cleared.",
      );
      if (library.error) setError(library.error);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function test() {
    setError(null);
    setMessage(null);
    try {
      await api("/api/ai/test", { method: "POST" });
      setMessage("OpenRouter accepted the key and the configured model is available. No completion tokens were spent.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function downloadBackup() {
    const data = await api<unknown>("/api/backup");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "progress-island-backup.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function restore(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      await api("/api/backup/restore", { method: "POST", body: text });
      setMessage("Backup restored.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="stack">
      <h1>Settings</h1>
      {error && <p className="banner danger">{error}</p>}
      {message && <p className="banner good">{message}</p>}
      <div className="card stack">
        <h2>OpenRouter</h2>
        <p className="muted">{ai?.notice}</p>
        <p>
          Key loaded: {ai?.hasKey ? "yes (server-side only)" : "no"} · Model:{" "}
          {ai?.model || "not set"}
        </p>
        {!ai?.configured && (
          <p className="banner">
            Configure OpenRouter to enable AI. Copy .env.example to .env, add your own key and model,
            then restart the server.
          </p>
        )}
        <button className="btn" onClick={() => void test()}>
          Test connection
        </button>
      </div>
      <form className="card stack" onSubmit={(event) => void saveLibrary(event)}>
        <h2>PDF library</h2>
        <p className="muted">
          A folder on this Mac that holds your book PDFs. Progress Island reads a chapter from the
          attached file when you generate a review. The file is not uploaded. The excerpt is sent to
          OpenRouter only after you consent.
        </p>
        <input
          value={libraryPath}
          onChange={(event) => setLibraryPath(event.target.value)}
          placeholder="/Users/you/Books"
        />
        {libraryCount != null && <p>{libraryCount} PDF files in this folder.</p>}
        <button className="btn primary" type="submit">
          Save folder
        </button>
      </form>
      <div className="card stack">
        <h2>Backup and restore</h2>
        <p className="muted">JSON export of books, chapters, progress, reviews, and island rewards.</p>
        <button className="btn primary" onClick={() => void downloadBackup()}>
          Export backup
        </button>
        <label>
          Restore backup
          <input type="file" accept="application/json" onChange={(e) => void restore(e)} />
        </label>
      </div>
    </div>
  );
}
