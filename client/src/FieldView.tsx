import { useState } from "react";
import { Link } from "react-router-dom";
import type { BookCategory, FieldKind, FieldResource, Priority } from "@progress-island/shared";
import {
  bookCategory,
  categoryColorCss,
  compareFieldItems,
  fieldFigure,
  resourceComplete,
  sharePercent,
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

function ResourceBar({ item, color }: { item: FieldResource; color: string }) {
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
            const fills = group.items.flatMap((item) => item.segments);
            const pct = sharePercent(fills);
            return (
              <section key={group.id} className="field-group" aria-label={group.label}>
                <div className="field-cat">
                  <div className="field-cat-head">
                    <h2>{group.label}</h2>
                    <span>{pct}%</span>
                  </div>
                  <Meter pct={pct} color={group.color} />
                </div>
                <ul className={group.items.length > FIELD_LIST_LIMIT ? "is-scroll" : undefined}>
                  {group.items.map((item) => {
                    const figure = fieldFigure(item.kind, item.segments);
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
                </ul>
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
            {resourceComplete(tip.item.segments) ? " · Done" : ""} · {fieldFigure(tip.item.kind, tip.item.segments)}
          </p>
          <ResourceBar item={tip.item} color={tip.color} />
        </div>
      ) : null}
    </div>
  );
}
