# Progress Island

Build your island. Keep what you learn.

A single-user, web-first learning companion for local use on a Mac. Add a book, confirm its chapters, log reading, generate source-grounded flashcards and quizzes, and watch trees grow on a round earth. This is a proof of concept: it is not a commercial platform, a full ebook reader, or an autonomous tutor.

## Requirements

- Node.js 20+
- [uv](https://docs.astral.sh/uv/) and Python 3.12+, used by the SymPy checker the first time you run a derivation
- A Mac for the documented local POC
- Optional: an [OpenRouter](https://openrouter.ai) account, API key, and model identifier for extraction, exams, and review generation

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

1. Load the first library with `npm run db:seed` (navigation, estimation, vision, fusion), or add a book by catalog search, by selecting its PDF, or with the labelled Navigation Notes fixture.
2. Confirm the edition. If Open Library has no contents list, select the PDF on the add-book page or on the book page. With consent, the opening pages go to OpenRouter. The title and chapters come from the PDF bookmarks and those pages. A title already saved from the catalog stays. You edit the chapter preview and save it; chapters are not stored before that confirmation. A pasted contents list remains under **Paste a contents list instead**.
3. Select the chapters that belong in the plan.
4. Log 50% or complete in two clicks. Undo restores the previous reading state. Reaching the next part of a book asks for an exam on the part you just finished.
5. In Settings, point the PDF library at the folder of your books. Selecting a PDF copies it into that folder and attaches it when the folder is set. Open PDF reads that file in the app and saves progress from the furthest page you open. When a chapter knows its PDF pages, only that chapter moves; otherwise the book tracks how far into the file you have gone. After a chapter is completed, generate a review pack (consent required). The app reads that chapter from the PDF instead of using the title alone.
6. Inspect passages, edit, reject, or report a poor item, answer the quiz (scored on the server), and note the next due date (1 / 3 / 7 / 14 days, or 1 day after a weak result).
7. Open Projects for an exam grounded in the chapters you read. The chapter list stays closed until you open it. A plane problem draws the points from the exam data. Run checks the calculation with SymPy. Submit sends it for a grade after you consent.
8. Each book is one voxel tree on a still, slightly rounded patch of earth. Chapter progress, weighted by page span when pages are known, sets how tall that tree grows. A later grouping can set `identifiers.treeGroup` to change the tree type.
9. Export JSON backup from Settings. `npm run db:backup` also writes a file under `data/`.

## Calculations

Each line in an exam is a calculation, such as `relation = Eq(x, y + 1)`. SymPy's mathematical names are available. A name is the SymPy function when you call it, and a symbol when you write it on its own. `from sympy import Name` adds another SymPy name, including a one-letter name such as `N`.

The checker parses the text as calculation data. Two results match when SymPy finds them equal, including a rewritten equation such as `Eq(x - y, 1)`. Plotting and printing names are unavailable. An exam that needs numbers states those numbers in the prompt or the given data.

## Persistence

SQLite lives at `data/progress-island.db` by default (gitignored). Schema migrations run on startup.

## PDF limits (POC)

Selecting a PDF accepts a file up to 150 MB. Bookmarks and the first opening pages supply the title and chapter list. The in-app reader opens an attached file one page at a time, up to 800 pages.

A PDF library folder (`LIBRARY_PATH` in `.env`, or Settings) is where that file is kept. Review generation still reads only the matching chapter, up to 40 PDF pages, and only from text-based PDFs. A scanned PDF can be viewed. Its pages have no text to extract, and OCR is out of scope.

## Tests

```bash
npm test
```

Covers progress math, review scheduling, quote grounding, outline extraction from the fixture, reward idempotency, quiz scoring, backup restore, PDF chapter choice, the SymPy derivation checker, and disabled AI without a key.

## Architecture

- `client/` React + Vite + Three.js island
- `server/` Express + SQLite + OpenRouter adapter
- `shared/` Zod schemas and domain rules
- `checker/` SymPy derivation checker, run with uv

One repo, one backend process, localhost by default. Do not expose this unauthenticated library on a public host.

## Known limitations

- Catalog contents exist only when Open Library has a table of contents for the selected edition. Otherwise select the PDF. A scanned file cannot supply a title or chapter list.
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
