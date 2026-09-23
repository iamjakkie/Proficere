# Progress Island

## Project description

**Repository name:** `progress-island`

**GitHub description:** AI-powered learning companion that turns reading, chapter progress, and spaced recall into a growing voxel island.

**Tagline:** Build your island. Keep what you learn.

Progress Island is a personal, web-first learning companion for people studying demanding material, often from printed chapters rather than a screen. Add a book, let AI help identify its edition and chapter structure, choose what to study, and log progress without maintaining a complicated task system. Turn the material you actually read into source-grounded flashcards and quizzes, then watch a beautiful pixelated 3D island grow as you return to learning.

The first release is a single-user proof of concept developed and run on a Mac. It must contain working AI features, persistent progress, and a real interactive island, not just attractive screens or mocked AI responses. Reading is the initial activity; the name deliberately leaves room for courses, papers, and practical projects later.

## Problem statement

The intended user studies technical books across robotics, navigation, mathematics, and programming. They want to print only the chapters needed now, but manually entering every chapter into a task app creates too much administrative work. Reading on a general-purpose device is distracting, and a tracker that is out of sight is easy to forget.

The product should make the next learning action obvious, keep setup lightweight, and offer a rewarding reason to return. It should support learning away from the screen rather than trying to become another place to consume content indefinitely.

## Goals

These are proposed POC acceptance targets, not measured product results:

- **Low-effort setup:** A supported book can become a confirmed chapter checklist without typing chapter titles individually.
- **Quick logging:** After opening a chapter, logging progress takes at most two interactions, excluding optional notes.
- **Useful recall:** A completed chapter with supplied content can produce an editable review pack grounded in that content.
- **Visible progress:** A qualifying learning action produces a deterministic island change that survives reloads.
- **Reliable continuity:** Reading history, chapter selections, review dates, and island rewards survive server restarts.

## Non-goals

- **Native mobile and widgets:** No Android/iOS application or native home-screen widget in this POC. The future widget remains important, but a web shortcut is not an equivalent replacement.
- **A complete reading application:** No PDF annotation suite, ebook renderer, audiobook player, or automatic detection of what was read on paper.
- **A commercial platform:** No subscriptions, payments, public profiles, social feed, leaderboards, or multi-user permissions.
- **An autonomous tutor:** No unbounded agent loops, general-purpose chatbot, or invented assessments based only on chapter titles.
- **A full simulation game:** No survival mechanics, resource economy, building editor, punitive streaks, or island deterioration.

## Priority user stories

- **Book setup:** As a learner, I want to add a title, ISBN, or document and confirm the resulting edition and chapter list instead of entering every chapter.
- **Selective study:** As a learner using printed material, I want to select only relevant chapters and remember which ones I have printed.
- **Fast resumption:** As a returning learner, I want to see my next chapter and due reviews immediately.
- **Grounded practice:** As a learner, I want questions based on the material I supplied, with a way to inspect why each answer is correct.
- **Gentle motivation:** As a learner, I want reading and recall to improve my island without being punished for taking a break.
- **Correction and recovery:** As a learner, I want to correct an import, undo a mistaken progress entry, and recover my data without losing history.

## Requirements

### P0: Book discovery and chapter import

Support three entry paths:

1. Search by title, author, or ISBN.
2. Upload a text-based PDF.
3. Paste a table of contents or chapter text.

Book search must perform real retrieval. Separate discovering a catalog record from obtaining an actual table of contents: metadata does not establish chapter structure. Prefer the selected edition's official contents, a lawful preview, or the supplied document; do not silently substitute another edition.

When a reliable contents list is available, extract chapter numbers, titles, hierarchy where practical, and page boundaries where evidenced. Display an editable preview before saving. When no contents list is available, retain the book metadata and ask for a PDF, contents page, or pasted text.

Every import needs a provenance label:

- Retrieved contents, with URL and edition.
- Extracted from an uploaded document, with filename and page locator.
- Extracted from pasted text.
- Manually entered or corrected.

Page numbers are optional. Store PDF page indices separately from printed page labels; front matter and differing editions can make them disagree. Unknown boundaries must remain unknown, not plausible guesses.

**Acceptance criteria**

- Given an ambiguous title, when search returns multiple candidates, then the user chooses the intended book and confirms its edition before saving chapters.
- Given a valid contents list, when extraction finishes, then the preview includes supported chapter titles and no invented titles.
- Given metadata without a contents list, when discovery ends, then the UI explicitly requests a source instead of claiming chapter import succeeded.
- Given an unreadable, image-only, oversized, or malformed PDF, when import fails, then the UI explains the limitation and offers paste/manual recovery.
- Given a corrected import, when it is applied to an existing book, then completed chapters and history are preserved through an explicit merge preview.

### P0: Chapter tracking and print workflow

Store the full imported outline, but let the user select a study subset. Show selected-plan progress separately from whole-book progress. Support chapter states derived from progress: not started, in progress, and completed.

Allow one-tap completion and simple percentage logging, with optional page position and a short note. Store progress events so an accidental update can be undone. A “printed” flag is separate from reading progress.

Provide a small print queue listing book, edition, chapter, and known page range. The POC may print this checklist; it must not imply that it has extracted or printed the corresponding book pages.

**Acceptance criteria**

- Given a selected chapter, when completion is logged, then its progress, next action, and reward update without a page reload.
- Given unselected chapters, when plan progress is calculated, then those chapters do not inflate the denominator.
- Given a completed chapter, when it is deselected from the plan, then its historical completion and earned island reward remain.
- Given a printed chapter, when its printed flag changes, then reading progress is unchanged.
- Given a mistaken update, when the user chooses undo, then the previous reading state is restored without creating duplicate rewards.

### P0: Real AI flashcards and quizzes

Generate a review pack from the actual text of a completed chapter or selected excerpt. A book title, contents list, or model familiarity with a book is insufficient evidence.

Each pack should contain approximately five flashcards and three multiple-choice questions. Prioritize explanation, distinctions, assumptions, and application over trivia. For technical material, preserve mathematical notation and do not reduce the pack to vocabulary alone.

Each card and question must have a supporting passage and source locator. Programmatically verify that quoted passages exist in the supplied text. This verifies provenance, not correctness: the user must still be able to edit, reject, or report a poor item.

Keep “read” and “reviewed” distinct. Passing three questions is not proof of mastery, and the UI must not label it as such.

**Acceptance criteria**

- Given sufficient chapter text, when generation is requested, then a real model response produces a schema-validated pack.
- Given only a chapter title or contents entry, when generation is requested, then the app asks for content.
- Given a generated quotation absent from the source, when validation runs, then the invalid item is rejected or regenerated, not silently accepted.
- Given a quiz submission, when it is scored, then correctness is computed by the backend rather than trusted from a client-supplied score.
- Given changed source text, when an older pack exists, then it is marked stale and regeneration is offered.
- Given an API failure, when the request ends, then the app shows an actionable error and retains previously saved work.

### P0: Periodic recall

Use a simple, transparent review schedule rather than an elaborate adaptive learning system. Suggested defaults are one, three, seven, and fourteen days after successive successful reviews; a weak result schedules a sooner revisit.

Persist `nextReviewAt` and show due items on app launch and refresh. For the local POC, do not require background jobs or claim reminders will fire while the Mac server is stopped. Generate packs on request or through an explicit opt-in after completion, then reuse them instead of spending tokens on every visit.

**Acceptance criteria**

- Given a completed review, when results are saved, then the next due date follows the documented rule.
- Given a due date in the past, when the app opens, then the review appears in the due queue.
- Given a restart, when the library loads, then attempts, scores, and due dates are unchanged.

### P0: A growing voxel island

Build a real Three.js scene with an orthographic or gently isometric camera. Aim for polished voxel/pixel-art scenery: soft light, clear silhouettes, layered terrain, water, trees, a cottage, and an unlockable landmark.

The island is the main emotional reward, but must not obscure the next useful action. It should look intentional from the empty state rather than becoming attractive only after weeks of activity.

Use a small deterministic reward system:

- First chapter completion adds a modest permanent improvement.
- Further distinct completed chapters unlock plants, paths, or buildings.
- A completed due review adds a separate recall-related improvement.
- Milestones unlock a recognizable landmark such as a lighthouse.

Reward rules belong in application logic, not in an LLM. Log reward events with unique keys so refreshing, retrying, or toggling completion cannot farm rewards. Cosmetic growth represents activity, not comparative learning value across books.

**Acceptance criteria**

- Given the same reward history, when the scene reloads, then the same island state is reconstructed.
- Given a repeated completion request, when it is processed, then no second reward is created.
- Given a break from study, when the user returns, then the island has not deteriorated.
- Given reduced-motion preferences or unavailable WebGL, when the dashboard opens, then tracking remains usable through a simplified/static fallback.

### P0: Persistence, privacy, and portability

Use local server-side persistence for the POC. Reading data must survive browser reloads and app restarts; a component state object is not persistence.

All generative AI requests must use **OpenRouter with a user-supplied API key**. This is a fixed requirement, not a provider-selection suggestion. Do not use direct model-provider APIs, platform-injected credentials, shared developer keys, or a silent fallback provider.

Keep the OpenRouter API key server-side, loaded from the local environment. Never expose it in frontend code, browser storage, API responses, logs, analytics, exported backups, or Git history. Before sending uploaded text through OpenRouter to the selected model provider, clearly explain what is sent and require user opt-in. “Local database” must never be marketed as “all processing stays local” when AI requests leave the device.

Include JSON backup and restore, a database backup procedure, OpenRouter configuration through environment variables, and a readable setup guide. Store source hashes and extraction versions so later corrections do not silently invalidate content provenance.

Required configuration:

```dotenv
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
```

The setup guide must explain how the user supplies their own OpenRouter key in an ignored local `.env` file and chooses a supported model identifier. Keep `.env.example` blank of secrets. Route generative requests through a backend OpenRouter adapter; model selection must remain configurable without editing application code.

Without a key or selected model, disable AI actions and display a clear “Configure OpenRouter to enable AI” state. Book-catalog search, manual chapter entry, progress tracking, and existing saved reviews should remain usable. Include a user-triggered connection test; distinguish invalid credentials, unavailable models, insufficient credits, rate limits, and transient failures without exposing raw secrets. Do not spend tokens automatically at startup or switch models silently.

Bind to localhost by default. Do not expose an unauthenticated personal library publicly; remote deployment needs a separate authentication and storage decision.

**Acceptance criteria**

- Given a fresh clone and configured credentials, when the documented install/start steps are followed, then the app runs on a Mac.
- Given a database restart, when the app loads, then saved state is intact.
- Given an exported backup, when it is restored to an empty database, then books, chapters, progress, reviews, and island rewards are reconstructed.
- Given a missing OpenRouter key or model, when the app opens, then tracking still works, AI actions are disabled, and configuration instructions are visible.
- Given a valid user-supplied OpenRouter key and supported model, when extraction or review generation runs, then the request uses the backend OpenRouter adapter.
- Given an invalid key or insufficient credits, when an AI request fails, then the user sees an actionable error and no fallback provider is invoked.
- Given a production build, when client assets and logs are inspected, then no secret or full private chapter text appears unintentionally.

### P1: Next iteration

- **OCR:** Contents-page photographs and scanned PDFs.
- **Section-level selection:** Better handling of nested headings, appendices, and partial chapter reading.
- **Study bundles:** Group selected chapters from several books under one learning objective.
- **More expressive recall:** Free-text answers, worked problems, and carefully qualified AI feedback.
- **Reminder delivery:** Opt-in notifications only after deployment and scheduling behavior are defined.

### P2: Later possibilities

- Native mobile app and a glanceable home-screen island widget.
- Courses, research papers, coding exercises, and measurable projects.
- Multiple islands or themed regions.
- More sophisticated scheduling, integrations, and cross-device synchronization.

None of these should delay the first working reading-to-recall loop.

## Success metrics

Run a one-week personal pilot after functional acceptance. Instrument local events only; third-party analytics are unnecessary.

| Measure | Proposed target | How to measure |
|---|---|---|
| Supported import | No manual title entry for chapters | Test a verified contents list and a text-based PDF |
| Import integrity | No unsupported titles in the acceptance fixtures | Compare extracted outline with fixture ground truth |
| Quick logging | Two interactions or fewer after chapter opening | Count interactions in the happy path |
| Grounding | Every accepted review item has a valid source passage | Automated quote matching plus human answer review |
| Persistence | No state lost in restart and restore tests | Compare saved entities and relationships |
| Personal usefulness | Used on at least four days in the pilot | Local activity log; not a retention claim |
| Administration burden | Setup does not feel harder than the current manual approach | Record setup time and user notes; establish baseline first |

## Open questions and defaults

- **AI configuration, owner: project owner; blocking for live AI integration.** OpenRouter is mandatory. The user supplies their own API key and chooses the model; agents must not substitute another provider or embedded credentials.
- **Search provider, owner: integration agent; non-blocking.** Pick one bounded book-catalog integration initially. Report where contents retrieval succeeds and where source upload remains necessary.
- **PDF limits, owner: integration agent; non-blocking.** Start with selected chapters and text-based PDFs; choose and document file/page/text limits after testing.
- **Hosting, owner: project owner; non-blocking.** Default to localhost on Mac. A remote preview is not the production deployment decision.
- **Reward thresholds, owner: product/UI agent; non-blocking.** Use a small configurable table, then tune after the pilot.

## Recommended implementation

These are architecture choices for this project, not a requirement to introduce every library:

- **Frontend:** React, TypeScript, and Vite.
- **Island:** Three.js; direct integration is fine. Do not rewrite a working scene just to add a wrapper.
- **Backend:** Node.js and Express, with a thin server-only OpenRouter adapter requiring the user's API key.
- **Persistence:** SQLite with versioned schema migrations.
- **Validation:** Shared schemas for API input and model output.
- **Testing:** Unit tests for progress, scheduling, source validation, and rewards; browser tests for the complete user flow.

Keep one repository, one backend process, and a small number of comprehensible modules. Avoid microservices, a vector database, a general agent framework, and an authentication service for the local-only POC.

Suggested entities:

```text
Book             identity, author, edition, identifiers
SourceDocument   provenance, page mapping, text/hash, consent state
Chapter          stable identity, book, outline position, source span
StudySelection   selected chapters and ordering
ProgressEvent    chapter, old/new state, timestamp, undo reference
ReviewPack       chapter/source version, validated cards and questions
ReviewAttempt    answers, result, timestamp, next due date
RewardEvent      qualifying action, unique reward key, cosmetic unlock
```

Stable chapter IDs must not be derived solely from title or list position. Reimporting a book must not turn renamed or reordered chapters into unrelated learning history.

## Agent handoff and build order

### Shared instruction for every coding agent

> Build Progress Island, a single-user web-first learning companion for local use on a Mac. Follow this brief as the scope contract. Real AI book/chapter extraction and source-grounded review generation are essential, not stretch goals. All generative AI must use OpenRouter with the user's own server-side API key; no other provider or shared credential fallback is permitted. Use a polished interactive voxel island as persistent positive feedback. Do not substitute mocked AI, invented chapter structures, or unsupported quiz content for working features. Preserve existing code where useful, document uncertainties, and deliver tested vertical slices rather than disconnected mockups.

### Milestone: One complete learning loop

First implement one pasted source becoming a confirmed chapter, a persisted progress update, a real generated review, and an island reward. Validate that full path before expanding discovery providers or decorative features.

### Agent ownership

| Workstream | Ownership | Depends on | Required handoff |
|---|---|---|---|
| Integrator | Architecture, shared contracts, migrations, merges | Initial repository audit | Agreed schemas, commands, fixture source, integration checklist |
| AI and imports | Catalog retrieval, parsing, extraction, grounding | Shared source/chapter contract | Working APIs, source fixtures, negative tests, provider configuration |
| Learning backend | Progress, review scheduling, rewards, backup | Shared entity contracts | Persistence tests, idempotency tests, restore test |
| UI and island | Dashboard, library, review flow, scene, accessibility | Stable API contracts | Responsive UI, scene fallback, documented reward visualization |
| Verification | End-to-end flows and failure cases | Integrated vertical slices | Reproducible test results and remaining limitations |

These are workstreams, not a requirement to launch five agents at once. Parallelize only after interfaces are agreed, and assign non-overlapping file ownership; one integrator should own shared schemas and dependency changes.

### Delivery sequence

1. Audit the repository and establish a reproducible local run.
2. Agree on shared types and the smallest realistic source fixture.
3. Complete the pasted-source learning loop with real AI.
4. Add book search, PDF extraction, edition confirmation, and recovery states.
5. Add print queue, scheduled recall, backup/restore, and merge-safe reimports.
6. Polish the island and dashboard without changing working domain contracts.
7. Run functional, accessibility, privacy, and restart tests; write the handoff.

## Final acceptance demonstration

The implementing agents must demonstrate this sequence without editing the database manually:

1. Start the application from documented commands.
2. Search for a real book and distinguish metadata availability from contents availability.
3. Import a real or clearly labelled test source, confirm its chapters, and select a subset.
4. Mark a chapter printed, log partial reading, then complete it.
5. Configure a user-supplied OpenRouter key and model, generate a real review, and inspect its source passages.
6. Answer the quiz and verify the next due date.
7. Observe the corresponding island unlock without duplicate rewards.
8. Restart the app and verify persistence.
9. Export and restore a backup.
10. Demonstrate missing-source, missing-key, and failed OpenRouter request cases without losing data or invoking a fallback provider.

Deliver the repository, README, example environment file without secrets, schema/migrations, reproducible tests, and a short list of known limitations. Mark untested integrations explicitly; do not describe the POC as complete because its screens render.

## Existing prototype continuity

If an earlier `still-island` scaffold is supplied, treat it as a starting point rather than a completed product. Audit its API wiring, persistence, model calls, and tests before making completion claims, and rename user-facing branding and package metadata to Progress Island.

This brief specifies the intended implementation. It does not claim that those capabilities already exist or that a GitHub repository has been created.
