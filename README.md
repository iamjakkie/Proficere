# Progress Island

Build your island. Keep what you learn.

A single-user, web-first learning companion for local use on a Mac. Add a book, confirm its chapters, log reading, generate source-grounded flashcards and quizzes, and watch trees grow on a round earth. This is a proof of concept: it is not a commercial platform, a full ebook reader, or an autonomous tutor.

## Requirements

- Node.js 20+
- A Mac for the documented local POC
- Optional: an [OpenRouter](https://openrouter.ai) account, API key, and model identifier for extraction and review generation

Book search, manual chapters, progress tracking, the island, and backup work without a key.

## Setup

```bash
git clone <this-repo>
cd progress-island
cp .env.example .env
# Edit .env and add YOUR OpenRouter key and model. Never commit .env.
npm install
npm run dev
```

Then open `http://127.0.0.1:5173`. The API binds to `127.0.0.1:3001`.

### OpenRouter

All generative AI uses **OpenRouter only**. There is no fallback provider and no shared developer key.

In `.env`:

```
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
```

Use your own key. Pick a model identifier OpenRouter supports (for example a small inexpensive chat model you already have access to). Restart the server after changing `.env`.

Without both values, AI buttons are disabled and the UI shows **Configure OpenRouter to enable AI**.

Before any upload or paste is sent to a model, the app asks for explicit consent. A local SQLite file does **not** mean AI processing stays on your Mac: opted-in text goes to OpenRouter and then to the selected model provider.

Use **Settings → Test connection** to check the key and model. The test uses the OpenRouter key and models endpoints and does not spend completion tokens. The app does not call the model at startup.

Never put the key in frontend code, backups, or git.

## Everyday use

1. Load the first library with `npm run db:seed` (navigation, estimation, vision, fusion), or add a book by catalog search, PDF, paste, or the labelled Navigation Notes fixture.
2. Confirm the edition, then edit the chapter preview and save it. Catalog metadata is not a table of contents, and chapters are not saved until you confirm that preview.
3. Select the chapters that belong in the plan.
4. Log 50% or complete in two clicks. Undo restores the previous reading state.
5. In Settings, point the PDF library at the folder of your books and attach the matching PDF on the book page. Open PDF reads that file in the app and saves progress from the furthest page you open. When a chapter knows its PDF pages, only that chapter moves; otherwise the book tracks how far into the file you have gone. After a chapter is completed, generate a review pack (consent required). The app reads that chapter from the PDF instead of using the title alone.
6. Inspect passages, edit, reject, or report a poor item, answer the quiz (scored on the server), and note the next due date (1 / 3 / 7 / 14 days, or 1 day after a weak result).
7. Each book is one voxel tree on a still, slightly rounded patch of earth. Chapter progress, weighted by page span when pages are known, sets how tall that tree grows. A later grouping can set `identifiers.treeGroup` to change the tree type.
8. Export JSON backup from Settings. `npm run db:backup` also writes a file under `data/`.

## Persistence

SQLite lives at `data/progress-island.db` by default (gitignored). Schema migrations run on startup.

## PDF limits (POC)

Uploads through the browser:

- 8 MB
- 40 pages

A PDF library folder (`LIBRARY_PATH` in `.env`, or Settings) can hold full books up to 150 MB and 800 pages. Attach a file on the book page; chapters are read from the PDF bookmarks when present, otherwise from numbered headings in the opening pages. The in-app reader opens the attached file one page at a time. Review generation still reads only the matching chapter, up to 40 PDF pages, and only from text-based PDFs. Image-only scans can be viewed, but their text needs a paste; OCR is out of scope.

## Tests

```bash
npm test
```

Covers progress math, review scheduling, quote grounding, outline extraction from the fixture, reward idempotency, quiz scoring, backup restore, and disabled AI without a key.

## Architecture

- `client/` React + Vite + Three.js island
- `server/` Express + SQLite + OpenRouter adapter
- `shared/` Zod schemas and domain rules

One repo, one backend process, localhost by default. Do not expose this unauthenticated library on a public host.

## Known limitations

- Catalog contents exist only when Open Library has a table of contents for the selected edition. Otherwise paste a source or attach the PDF from your library folder.
- Chapter text is found by searching the PDF for the confirmed chapter title. A title that does not appear in the file cannot be grounded.
- OpenRouter review quality depends on the model you choose; grounding checks reject quotes that are not in the source, not factual correctness.
- No background reminders while the Mac server is stopped.
- No native mobile app or home-screen widget.
- Reduced-motion / missing WebGL uses a static island fallback; tracking remains usable.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | API + Vite together |
| `npm start` | Production build served from the API |
| `npm test` | Unit and API tests |
| `npm run db:backup` | JSON dump of the SQLite library |
| `npm run db:seed` | Load the initial navigation/estimation book list (skips titles already in the library) |
