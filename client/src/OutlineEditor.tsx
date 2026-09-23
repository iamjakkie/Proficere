import type { OutlineChapter } from "@progress-island/shared";

export type OutlineRow = OutlineChapter;

export function OutlineEditor({
  rows,
  onChange,
}: {
  rows: OutlineRow[];
  onChange: (rows: OutlineRow[]) => void;
}) {
  function update(index: number, patch: Partial<OutlineRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="stack">
      {rows.map((row, index) => (
        <div className="outline-row" key={`${row.existingId ?? "new"}-${index}`}>
          <input
            aria-label={`Chapter ${index + 1} number`}
            value={row.number ?? ""}
            placeholder="No."
            onChange={(event) => update(index, { number: event.target.value || null })}
          />
          <input
            aria-label={`Chapter ${index + 1} title`}
            value={row.title}
            placeholder="Chapter title"
            onChange={(event) => update(index, { title: event.target.value })}
          />
          <input
            aria-label={`Chapter ${index + 1} start page`}
            value={row.pageStart ?? ""}
            placeholder="Start"
            onChange={(event) => update(index, { pageStart: event.target.value || null })}
          />
          <input
            aria-label={`Chapter ${index + 1} end page`}
            value={row.pageEnd ?? ""}
            placeholder="End"
            onChange={(event) => update(index, { pageEnd: event.target.value || null })}
          />
          <button
            className="btn ghost"
            type="button"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            Remove
          </button>
          {row.existingId ? (
            <span className="muted">Keeps this chapter’s history</span>
          ) : (
            <span className="muted">New chapter</span>
          )}
        </div>
      ))}
      <button
        className="btn"
        type="button"
        onClick={() =>
          onChange([
            ...rows,
            { number: null, title: "", pageStart: null, pageEnd: null },
          ])
        }
      >
        Add chapter
      </button>
    </div>
  );
}
