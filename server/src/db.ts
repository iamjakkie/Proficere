import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config, ensureDataDir } from "./config.js";

type Migration = {
  version: number;
  sql: string;
  after?: (db: Database.Database) => void;
};

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  edition TEXT,
  isbn TEXT,
  identifiers TEXT NOT NULL DEFAULT '{}',
  catalog_url TEXT,
  contents_available INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE source_documents (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  provenance_type TEXT NOT NULL,
  provenance_label TEXT NOT NULL,
  url TEXT,
  filename TEXT,
  page_locator TEXT,
  edition_note TEXT,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  extraction_version TEXT NOT NULL,
  ai_consent_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  source_document_id TEXT,
  parent_id TEXT,
  number TEXT,
  title TEXT NOT NULL,
  outline_position INTEGER NOT NULL,
  page_start TEXT,
  page_end TEXT,
  pdf_page_start INTEGER,
  pdf_page_end INTEGER,
  source_span_start INTEGER,
  source_span_end INTEGER,
  selected INTEGER NOT NULL DEFAULT 1,
  printed INTEGER NOT NULL DEFAULT 0,
  progress_percent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'not_started',
  note TEXT,
  page_position TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE progress_events (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  old_state TEXT NOT NULL,
  new_state TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  undone_at TEXT
);

CREATE TABLE review_packs (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0,
  flashcards TEXT NOT NULL,
  questions TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE review_attempts (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  answers TEXT NOT NULL,
  correct_count INTEGER NOT NULL,
  total INTEGER NOT NULL,
  weak INTEGER NOT NULL,
  next_review_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE reward_events (
  id TEXT PRIMARY KEY,
  reward_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  unlock TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    sql: `ALTER TABLE source_documents ADD COLUMN outline_json TEXT;`,
  },
  {
    version: 3,
    sql: `ALTER TABLE books ADD COLUMN library_filename TEXT;`,
  },
  {
    version: 4,
    sql: `ALTER TABLE books ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;`,
    after(db) {
      const rows = db
        .prepare("SELECT id FROM books ORDER BY updated_at DESC")
        .all() as { id: string }[];
      const update = db.prepare("UPDATE books SET sort_order = ? WHERE id = ?");
      rows.forEach((row, index) => update.run(index, row.id));
    },
  },
  {
    version: 5,
    sql: `
CREATE TABLE project_batches (
  id TEXT PRIMARY KEY,
  context_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  proposals_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE project_dismissals (
  id TEXT PRIMARY KEY,
  proposal_key TEXT NOT NULL,
  title TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  batch_id TEXT,
  proposal_id TEXT NOT NULL,
  status TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  dismiss_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  brief_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  source_snapshot_json TEXT NOT NULL,
  assessment_mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, version_number)
);

CREATE TABLE project_submissions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  submission_number INTEGER NOT NULL,
  artifacts_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, submission_number)
);

CREATE TABLE project_reviews (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  objective_json TEXT NOT NULL,
  reasoning_json TEXT,
  questions_json TEXT NOT NULL,
  answer_json TEXT,
  answer_review_json TEXT,
  label TEXT NOT NULL,
  next_action TEXT,
  operational_json TEXT,
  created_at TEXT NOT NULL
);
`,
  },
];

export type Db = Database.Database;

export function openDatabase(filePath = config.databasePath): Db {
  ensureDataDir();
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const current = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations")
    .get() as { v: number };
  for (const migration of MIGRATIONS) {
    if (migration.version <= current.v) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      migration.after?.(db);
      db.prepare(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      ).run(migration.version, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
