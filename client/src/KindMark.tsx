import type { FieldKind } from "@progress-island/shared";

export function KindMark({
  kind,
  provider,
  label,
}: {
  kind: FieldKind;
  provider: string | null;
  label: string | null;
}) {
  const name = kind === "course" ? label || "Course" : kind === "book" ? "Book" : kind === "article" ? "Article" : "Project";
  return (
    <span className="kind-mark" title={name} aria-label={name}>
      {kind === "book" ? <BookIcon /> : null}
      {kind === "article" ? <ScrollIcon /> : null}
      {kind === "workshop" ? <BoardIcon /> : null}
      {kind === "course" ? <ProviderIcon id={provider} /> : null}
    </span>
  );
}

function BookIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.4 3.2c1.5-.8 3-.8 4.5 0v9.4c-1.5-.7-3-.7-4.5 0V3.2zM9.1 3.2c1.5-.8 3-.8 4.5 0v9.4c-1.5-.7-3-.7-4.5 0V3.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScrollIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.6 3h6.6c.7 0 1.3.6 1.3 1.3v7.2c0 .7-.6 1.3-1.3 1.3H5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M4.6 3c-.9 0-1.6.6-1.6 1.4S3.7 5.8 4.6 5.8M4.6 13c-.9 0-1.6-.6-1.6-1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BoardIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="3" width="3.2" height="10" rx="0.6" fill="currentColor" />
      <rect x="6.4" y="3" width="3.2" height="7" rx="0.6" fill="currentColor" opacity="0.72" />
      <rect x="10.8" y="3" width="3.2" height="4.2" rx="0.6" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

function ProviderIcon({ id }: { id: string | null }) {
  if (id === "udemy") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect width="16" height="16" rx="4" fill="#A435F0" />
        <path d="M4.8 4.6v4.1a3.2 3.2 0 0 0 6.4 0V4.6" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === "coursera") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="8" fill="#0056D2" />
        <path d="M10.6 5.2a3.6 3.6 0 1 0 0 5.6" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === "udacity") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect width="16" height="16" rx="3" fill="#02B3E4" />
        <path d="M3.6 12.2 8 3.6l4.4 8.6H3.6z" fill="#fff" />
      </svg>
    );
  }
  if (id === "mit") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect width="16" height="16" rx="2" fill="#A31F34" />
        <path d="M2.6 12V4h1.7l3.7 5.4L11.7 4H13.4v8h-1.6V7.1L8.7 11h-.8L4.4 7.1V12H2.6z" fill="#fff" />
      </svg>
    );
  }
  if (id === "edx") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect width="16" height="16" rx="3" fill="#111" />
        <path d="M4 4.5h2.2l1.8 3.1L9.8 4.5H12L9.2 8.2 12.1 12H9.8L8 8.7 6.2 12H3.9l2.9-3.8L4 4.5z" fill="#fff" />
      </svg>
    );
  }
  if (id === "youtube") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect width="16" height="16" rx="4" fill="#FF0033" />
        <path d="M6.4 4.8v6.4L12 8 6.4 4.8z" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.2v4.1l2.6 1.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
