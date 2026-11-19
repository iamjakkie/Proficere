import type { ReactNode } from "react";
import type { Dashboard } from "@progress-island/shared";

const bookColors = ["var(--moss)", "var(--accent)", "var(--sea-deep)"];

export function HomeCharts({ week, pace }: { week: Dashboard["week"]; pace: Dashboard["pace"] }) {
  const pages = week.pages === 1 ? "1 page" : `${week.pages} pages`;
  const days = week.activeDays === 1 ? "1 day" : `${week.activeDays} days`;
  const exams =
    week.exams === 0
      ? null
      : week.passed === week.exams
        ? week.exams === 1
          ? "1 exam passed"
          : `${week.exams} exams passed`
        : `${week.passed} of ${week.exams} exams passed`;
  return (
    <div className="field-analytics">
      <section className="chart-card" aria-label="Last 7 days">
        <p className="chart-label">Last 7 days</p>
        <ChartFrame top={Math.max(...week.days.map((day) => day.pages), 0)}>
          <div className="week-bars">
            {week.days.map((day) => (
              <span key={day.date} title={`${day.date}: ${day.pages} pages`}>
                <i style={{ height: barHeight(day.pages, week.days.map((item) => item.pages)) }} />
              </span>
            ))}
          </div>
        </ChartFrame>
        <p>{week.pages === 0 && week.exams === 0 ? "Quiet week" : `${pages} · ${days}`}{exams ? ` · ${exams}` : ""}</p>
      </section>
      <section className="chart-card" aria-label="Pages by book over four weeks">
        <p className="chart-label">Books, four weeks</p>
        <BookLines books={pace.books} />
      </section>
      <section className="chart-card" aria-label="Days with progress over four weeks">
        <p className="chart-label">Days</p>
        <div className="month-days">
          {pace.days.map((day) => (
            <i key={day.date} className={day.active ? "on" : ""} title={day.date} />
          ))}
        </div>
        <p>{pace.activeDays} of 28 days</p>
      </section>
      <section className="chart-card" aria-label="Recent exam scores, pass line at 7">
        <p className="chart-label">Exams</p>
        <ScoreChart scores={pace.scores} />
      </section>
    </div>
  );
}

function ChartFrame({ top, children }: { top: number; children: ReactNode }) {
  const mid = Math.round(top / 2);
  return (
    <div className="chart-frame">
      <div className="y-axis" aria-hidden="true">
        <span>{top}</span>
        {mid > 0 && mid < top ? <span>{mid}</span> : <span />}
        <span>0</span>
      </div>
      {children}
    </div>
  );
}

function barHeight(value: number, all: number[]): string {
  const peak = Math.max(...all, 1);
  return `${Math.max(4, Math.round((value / peak) * 100))}%`;
}

function BookLines({ books }: { books: Dashboard["pace"]["books"] }) {
  const top = Math.max(...books.flatMap((book) => book.points), 0);
  if (books.length === 0) {
    return (
      <>
        <ChartFrame top={0}>
          <p className="chart-empty">No book moved</p>
        </ChartFrame>
      </>
    );
  }
  const width = 160;
  const height = 64;
  return (
    <>
      <ChartFrame top={top}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={books.map((book) => `${book.title} ${book.gained} pages`).join(", ")}>
          {books.map((book, index) => {
            const d = book.points
              .map((point, pointIndex) => {
                const x = (pointIndex / (book.points.length - 1)) * width;
                const y = height - (top === 0 ? 0 : (point / top) * (height - 4)) - 2;
                return `${pointIndex === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
              })
              .join(" ");
            return <path key={book.title} d={d} fill="none" stroke={bookColors[index % bookColors.length]} strokeWidth="2" />;
          })}
        </svg>
      </ChartFrame>
      <ul className="book-legend">
        {books.map((book, index) => (
          <li key={book.title}>
            <i style={{ background: bookColors[index % bookColors.length] }} />
            <span>{book.title}</span>
            <b>{book.points[book.points.length - 1]}</b>
          </li>
        ))}
      </ul>
    </>
  );
}

function ScoreChart({ scores }: { scores: Dashboard["pace"]["scores"] }) {
  if (scores.length === 0) {
    return (
      <>
        <ChartFrame top={10}>
          <p className="chart-empty">No scored exam</p>
        </ChartFrame>
      </>
    );
  }
  const width = 140;
  const height = 64;
  const pass = 7;
  const passY = height - (pass / 10) * (height - 4) - 2;
  return (
    <>
      <ChartFrame top={10}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={scores.map((score) => `${score.score}/${score.total}`).join(", ")}>
          <line x1="0" x2={width} y1={passY} y2={passY} stroke="var(--warn)" strokeDasharray="3 2" />
          {scores.map((score, index) => {
            const slot = width / scores.length;
            const x = slot * index + slot / 2;
            const scaled = score.total === 0 ? 0 : (score.score / score.total) * 10;
            const y = height - (scaled / 10) * (height - 4) - 2;
            return <circle key={`${score.date}-${index}`} cx={x} cy={y} r="3.5" fill={scaled >= pass ? "var(--moss)" : "var(--clay)"} />;
          })}
        </svg>
      </ChartFrame>
      <p>Pass line at 7. Latest {scores[scores.length - 1]?.score}/{scores[scores.length - 1]?.total}</p>
    </>
  );
}
