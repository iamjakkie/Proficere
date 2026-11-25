import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { BookCategory, FieldKind, FieldResource, Priority } from "@progress-island/shared";
import {
  bookCategory,
  categoryColorCss,
  categoryPercent,
  compareFieldItems,
  fieldFigure,
  resourceComplete,
} from "@progress-island/shared";
import { KindMark } from "./KindMark";

type Group = {
  id: string;
  label: string;
  color: string;
  items: FieldResource[];
};

type Tip = {
  item: FieldResource;
  category: string;
  color: string;
  x: number;
  y: number;
};

const FIELD_LIST_LIMIT = 10;

const KIND_LABEL: Record<FieldKind, string> = {
  book: "Book",
  article: "Article",
  course: "Course",
  workshop: "Project",
};

function groupsFor(resources: FieldResource[], categories: BookCategory[]): Group[] {
  const byId = new Map<string, FieldResource[]>();
  for (const resource of resources) {
    const category = bookCategory(categories, resource.category);
    if (!category) continue;
    const list = byId.get(category.id) ?? [];
    list.push(resource);
    byId.set(category.id, list);
  }
  return categories
    .filter((category) => (byId.get(category.id)?.length ?? 0) > 0)
    .map((category) => ({
      id: category.id,
      label: category.label,
      color: categoryColorCss(category.color),
      items: (byId.get(category.id) ?? []).slice().sort(compareFieldItems),
    }));
}

function Meter({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="hp hp-solid" aria-hidden="true">
      <span className="hp-cell">
        <span className="field-fill" style={{ width: `${pct}%`, background: color }} />
      </span>
    </div>
  );
}

function SegmentBar({ segments, color }: { segments: number[]; color: string }) {
  const cells = segments.length ? segments : [0];
  if (cells.length > 28) {
    const stops = cells
      .map((fill, index) => {
        const start = (index / cells.length) * 100;
        const painted = ((index + fill) / cells.length) * 100;
        const end = ((index + 1) / cells.length) * 100;
        return `${color} ${start}% ${painted}%, transparent ${painted}% ${end}%`;
      })
      .join(", ");
    return (
      <div className="hp hp-dense" aria-hidden="true">
        <span className="field-fill hp-span" style={{ background: `linear-gradient(to right, ${stops})` }} />
      </div>
    );
  }
  return (
    <div className="hp" aria-hidden="true">
      {cells.map((fill, index) => (
        <span key={index} className="hp-cell">
          <span className="field-fill" style={{ width: `${fill * 100}%`, background: color }} />
        </span>
      ))}
    </div>
  );
}

function PriorityMark({ priority, color }: { priority: Priority; color: string }) {
  if (priority === "none") return <span className="priority-mark" aria-hidden="true" />;
  const label = priority === "top" ? "Top" : "High";
  return (
    <span className="priority-mark" style={{ color }} aria-label={label} title={label}>
      <i />
      {priority === "top" ? <i /> : null}
    </span>
  );
}

function FieldList({ scroll, children }: { scroll: boolean; children: ReactNode }) {
  const listRef = useRef<HTMLUListElement>(null);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !scroll) return;
    const measure = () => {
      const { scrollTop, scrollHeight, clientHeight } = list;
      if (scrollHeight <= clientHeight + 1) {
        setThumb(null);
        return;
      }
      const height = Math.max(28, (clientHeight / scrollHeight) * clientHeight);
      const room = Math.max(0, clientHeight - height);
      const top = scrollHeight === clientHeight ? 0 : (scrollTop / (scrollHeight - clientHeight)) * room;
      setThumb({ top, height });
    };
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => {
      list.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [scroll]);

  if (!scroll) return <ul>{children}</ul>;

  return (
    <div className="field-scroll">
      <ul ref={listRef} className="is-scroll">
        {children}
      </ul>
      <span className="field-scroll-track" aria-hidden="true" />
      {thumb ? (
        <span
          className="field-scroll-thumb"
          style={{ height: thumb.height, transform: `translateY(${thumb.top}px)` }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

function fillPercent(segments: number[]): number {
  if (!segments.length) return 0;
  return (segments.reduce((sum, fill) => sum + fill, 0) / segments.length) * 100;
}

function ResourceBar({ item, color }: { item: FieldResource; color: string }) {
  if (item.pages) return <Meter pct={fillPercent(item.segments)} color={color} />;
  if (item.kind === "article") return <Meter pct={Math.round((item.segments[0] ?? 0) * 100)} color={color} />;
  return <SegmentBar segments={item.segments} color={color} />;
}

function placeCard(anchor: HTMLElement): { x: number; y: number } {
  const rect = anchor.getBoundingClientRect();
  const width = 280;
  const height = 132;
  let x = rect.left;
  let y = rect.bottom + 6;
  if (x + width > window.innerWidth - 8) x = window.innerWidth - width - 8;
  if (y + height > window.innerHeight - 8) y = Math.max(8, rect.top - height - 6);
  return { x: Math.max(8, x), y: Math.max(8, y) };
}

export function FieldView({
  resources,
  categories,
}: {
  resources: FieldResource[];
  categories: BookCategory[];
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const groups = groupsFor(resources, categories);

  if (!groups.length) {
    return (
      <div className="field-viewport">
        <p className="field-empty">Assign a category to a book, an article, or a course and it shows up here.</p>
      </div>
    );
  }

  return (
    <div className="field-viewport">
      <div className="field-frame">
        <div className="field-groups">
          {groups.map((group) => {
            const pct = categoryPercent(group.items);
            return (
              <section key={group.id} className="field-group" aria-label={group.label}>
                <div className="field-cat">
                  <div className="field-cat-head">
                    <h2>{group.label}</h2>
                    <span>{pct}%</span>
                  </div>
                  <Meter pct={pct} color={group.color} />
                </div>
                <FieldList scroll={group.items.length > FIELD_LIST_LIMIT}>
                  {group.items.map((item) => {
                    const figure = fieldFigure(item.kind, item.segments, item.pages);
                    const done = resourceComplete(item.segments);
                    return (
                      <li key={`${item.kind}:${item.id}`}>
                        <Link
                          className={done ? "is-done" : undefined}
                          to={item.href}
                          onMouseEnter={(event) =>
                            setTip({
                              item,
                              category: group.label,
                              color: group.color,
                              ...placeCard(event.currentTarget),
                            })
                          }
                          onMouseLeave={() => setTip((current) => (current?.item.id === item.id ? null : current))}
                          onFocus={(event) =>
                            setTip({
                              item,
                              category: group.label,
                              color: group.color,
                              ...placeCard(event.currentTarget),
                            })
                          }
                          onBlur={() => setTip((current) => (current?.item.id === item.id ? null : current))}
                        >
                          <PriorityMark priority={item.priority} color={group.color} />
                          <KindMark kind={item.kind} provider={item.provider} label={item.providerLabel} />
                          <span className="field-title">{item.title}</span>
                          <ResourceBar item={item} color={group.color} />
                          <span className="field-figure">
                            {done ? <span className="field-done" aria-hidden="true" /> : null}
                            {done ? <span className="sr-only">Done, </span> : null}
                            {figure}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </FieldList>
              </section>
            );
          })}
        </div>
      </div>
      {tip ? (
        <div className="field-card" style={{ left: tip.x, top: tip.y }}>
          <strong>{tip.item.title}</strong>
          <p>
            {KIND_LABEL[tip.item.kind]}
            {tip.item.providerLabel ? ` · ${tip.item.providerLabel}` : ""} · {tip.category}
            {tip.item.priority === "none" ? "" : tip.item.priority === "top" ? " · Top" : " · High"}
            {resourceComplete(tip.item.segments) ? " · Done" : ""} · {fieldFigure(tip.item.kind, tip.item.segments, tip.item.pages)}
          </p>
          <ResourceBar item={tip.item} color={tip.color} />
        </div>
      ) : null}
    </div>
  );
}
