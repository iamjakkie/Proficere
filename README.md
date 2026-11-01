# Proficere

To advance.

A single-user, web-first learning companion for local use on a Mac. Add a book, confirm its chapters, log reading, and generate source-grounded flashcards and quizzes. Home is a field of category progress bars. The bar names the shelves in Latin: Home *domus*, Library *bibliotheca*, Articles *commentarii*, Exercises *exercitia*, Courses *cursus*, Workshop *officina*, Exams *examina*, Settings *optiones*. This is a proof of concept: it is not a commercial platform, a full ebook reader, or an autonomous tutor.

## Requirements

- Node.js 20+
- [uv](https://docs.astral.sh/uv/) and Python 3.12+, used by the SymPy checker the first time you run a derivation
- A Mac for the documented local POC
- Optional: an [OpenRouter](https://openrouter.ai) account, API key, and model identifier for extraction, exams, and review generation

Book search, manual chapters, progress tracking, the home field, and backup work without a key.

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
4. Log 50% or complete in two clicks. Undo restores the previous reading state. Reaching the next chapter asks for an exam on the chapter you just finished. Skip leaves that exam unfinished and lets you continue.
5. In Settings, point the PDF library at the folder of your books. Selecting a PDF copies it into that folder and attaches it when the folder is set. Open PDF reads that file two pages at a time and saves progress from the furthest page on screen. The Two pages button returns to one page. When a chapter knows its PDF pages, only that chapter moves; otherwise the book tracks how far into the file you have gone. After a chapter is completed, generate a review pack (consent required). The app reads that chapter from the PDF instead of using the title alone.
6. Inspect passages, edit, reject, or report a poor item, answer the quiz (scored on the server), and note the next due date (1 / 3 / 7 / 14 days, or 1 day after a weak result).
7. Open Exams for an exam grounded in the chapters you read. A new exam is one workbook of separate tasks, from a few items up to ten. Each calculation has its own script and Run. A written question has a text box. Submit at the bottom grades the exam as a count, such as 9/10. Seven out of ten passes. The chapter list stays closed until you open it. A plane problem draws the points from the exam data. Submit sends written answers for a grade after you consent.
8. Home is a field of category groups. Each category has one continuous bar, the share of its chapters, lessons, and workshop tasks that are done, printed as a percent. A book is a segmented bar, one segment per chapter, labelled with finished chapters over the chapter count. A course is one segment per lesson, labelled the same way. A workshop project is one segment per task, filled only when that task is in Done, labelled done over total. An article is one bar, labelled with a percent. A book with no outline yet is a single segment from how far you have read. A row shows the title. One mark before the title means high priority, two marks mean top, and none is the default. Items with no category stay on their own shelf and do not appear here. Exercise sheets and exams are not on the field. Hover a row for its kind, category, priority, and the same bar. A book or article with a library PDF opens the reader; otherwise it opens its own page. A course or workshop project opens its page. The field scales to the window.
9. Export JSON backup from Settings. `npm run db:backup` writes `data/backup-<timestamp>.json`. That dump includes books, chapters, progress, reviews, rewards, exam projects, articles, courses, workshop boards, and exercise suggestions. Restoring replaces those tables. Book and chapter rows are never dropped by a schema update.
10. Articles are readings that are not books. Attach a PDF from the library folder, keep a short note, and read it in the app. An article does not open an exam. Assign a category and a priority and it joins that group on Home.
11. Courses are a separate shelf. Paste a URL and title. A Udemy course link loads that course's public section titles into the confirm list. A Coursera specialization loads its course titles, and a Coursera course link loads its module titles. An MIT OpenCourseWare link loads the lecture titles from its notes page. Lectures, transcripts, and files stay on the course site. Any other public page can be read for headings, or paste a lesson list. Confirm the preview before lessons are stored. Open launches the real site in a new tab. Mark a lesson Done or Still here when you come back. Delete removes that course and its lessons. Assign a course a category and a priority and its lessons become segments on Home. If a course is in progress, Home offers a continue link.
12. Workshop is a kanban of projects you define, with columns TODO, In progress, Test, and Done. It is not the exam workbook under Exams. Assign a category and the project appears on Home, one segment per task, filled only when that task is Done. Priority is none, high, or top, the same marks used on books, articles, and courses. Planning a project can call OpenRouter after the same kind of consent used elsewhere, and only when you press Plan. Without a key, add and move cards yourself. Dropping a card on Done plays a short shine.
13. Exercise search builds a set of Google queries for PDF exercise sheets on university sites (`filetype:pdf`, `site:.edu` and other academic domains). Finished chapters and lessons are grouped when they are the same topic: a chapter title replaces its numbered sections, and similar titles such as “Products of Vectors” and “Algebra of Vectors” share one query. Each topic is its own query, up to eight. It runs only while the server is running, about once a day after you opt in, and when you press Search now. The page shows the queries that will be sent. Set `EXERCISE_SEARCH_ENDPOINT` and `EXERCISE_SEARCH_API_KEY` in `.env`. With no key, Search now explains that and does not invent results. Accepting a suggestion adds an exercise sheet on the Exercises page, not among articles. It is not attached as a book and the file is not downloaded. Rejecting removes it from the waiting list. Nothing searches while the Mac server is stopped.

## Calculations

Each line in an exam is a calculation, such as `relation = Eq(x, y + 1)`. SymPy's mathematical names are available. A name is the SymPy function when you call it, and a symbol when you write it on its own. `from sympy import Name` adds another SymPy name, including a one-letter name such as `N`.

The checker parses the text as calculation data. Two results match when SymPy finds them equal, including a rewritten equation such as `Eq(x - y, 1)`. Plotting and printing names are unavailable. An exam that needs numbers states those numbers in the prompt or the given data.

## Persistence

SQLite is gitignored. Schema migrations run on startup and only add tables and columns. The example `.env` sets `DATABASE_PATH=./data/progress-island.db`. `npm run dev` starts the server inside the `server` workspace, so that relative path is `server/data/progress-island.db`. Leave `DATABASE_PATH` unset to use `data/progress-island.db` at the repo root, or set an absolute path. `npm run db:backup` always writes `data/backup-<timestamp>.json` at the repo root.

## PDF limits (POC)

Selecting a PDF has no size cap. Bookmarks and the first opening pages supply the title and chapter list. The in-app reader opens an attached file two pages at a time. The Two pages button returns to one page. A chapter search scans up to 800 pages.

A PDF library folder (`LIBRARY_PATH` in `.env`, or Settings) is where that file is kept. Review generation still reads only the matching chapter, up to 40 PDF pages, and only from text-based PDFs. A scanned PDF can be viewed. Its pages have no text to extract, and OCR is out of scope.

## Tests

```bash
npm test
```

Covers progress math, review scheduling, quote grounding, outline extraction from the fixture, reward idempotency, quiz scoring, backup restore (including articles, courses, workshop cards, and exercise suggestions), PDF chapter choice, course lesson progress, the SymPy derivation checker, and disabled AI without a key.

## Architecture

- `client/` React + Vite home field
- `server/` Express + SQLite + OpenRouter adapter
- `shared/` Zod schemas and domain rules
- `checker/` SymPy derivation checker, run with uv

One repo, one backend process, localhost by default. Do not expose this unauthenticated library on a public host.

## Known limitations

- Catalog contents exist only when Open Library has a table of contents for the selected edition. Otherwise select the PDF. A scanned file cannot supply a title or chapter list.
- Chapter text is found by searching the PDF for the confirmed chapter title. A title that does not appear in the file cannot be grounded.
- OpenRouter review quality depends on the model you choose; grounding checks reject quotes that are not in the source, not factual correctness.
- No background reminders, and no exercise search, while the Mac server is stopped.
- Exercise search only calls the endpoint you configure. It does not sign in to a publisher, bypass a paywall, or download files into the book library.
- A Udemy link supplies public section titles. A Coursera specialization supplies its course titles, and a Coursera course link supplies its module titles. An MIT OpenCourseWare link supplies its lecture titles. Video, transcripts, and files stay on those sites.
- No native mobile app or home-screen widget.
- Reduced motion shows the finished bars and skips the fill-in animation. Tracking remains usable.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | API + Vite together |
| `npm start` | Production build served from the API |
| `npm test` | Unit and API tests |
| `npm run db:backup` | JSON dump of the SQLite library |
| `npm run db:seed` | Load the initial navigation/estimation book list (skips titles already in the library) |
