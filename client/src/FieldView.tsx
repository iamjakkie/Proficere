import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { BookCategory, FieldKind, FieldResource, Priority } from "@progress-island/shared";
import { bookCategory, categoryColorCss, fieldFigure, priorityRank, sharePercent } from "@progress-island/shared";

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

const KIND_LABEL: Record<FieldKind, string> = {
  book: "Book",
  article: "Article",
  course: "Course",
  workshop: "Project",
};

function columnsFor(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  return 3;
}

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
      items: (byId.get(category.id) ?? []).slice().sort(
        (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.title.localeCompare(b.title),
      ),
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
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ width: number; height: number; scale: number } | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const groups = groupsFor(resources, categories);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const stage = stageRef.current;
    if (!frame || !stage) return;
    const measure = () => {
      const style = getComputedStyle(frame);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const availW = Math.max(1, frame.clientWidth - padX);
      const availH = Math.max(1, frame.clientHeight - padY);
      const width = stage.scrollWidth;
      const height = stage.scrollHeight;
      if (!width || !height) return;
      const scale = Math.min(availW / width, availH / height);
      setFit({ width, height, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [resources, categories, groups.length]);

  if (!groups.length) {
    return (
      <div className="field-viewport">
        <p className="field-empty">Assign a category to a book, an article, or a course and it shows up here.</p>
      </div>
    );
  }

  return (
    <div className="field-viewport">
      <div className="field-frame" ref={frameRef}>
        <div
          className="field-fit"
          style={fit ? { width: fit.width * fit.scale, height: fit.height * fit.scale } : undefined}
        >
          <div
            className="field-stage"
            ref={stageRef}
            style={fit ? { transform: `scale(${fit.scale})`, transformOrigin: "top left" } : undefined}
          >
            <div
              className="field-groups"
              style={{ gridTemplateColumns: `repeat(${columnsFor(groups.length)}, minmax(420px, 520px))` }}
            >
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
                    <ul>
                      {group.items.map((item) => {
                        const figure = fieldFigure(item.kind, item.segments);
                        return (
                          <li key={`${item.kind}:${item.id}`}>
                            <Link
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
                              <span className="field-title">{item.title}</span>
                              <ResourceBar item={item} color={group.color} />
                              <span className="field-figure">{figure}</span>
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
        </div>
      </div>
      {tip ? (
        <div className="field-card" style={{ left: tip.x, top: tip.y }}>
          <strong>{tip.item.title}</strong>
          <p>
            {KIND_LABEL[tip.item.kind]} · {tip.category}
            {tip.item.priority === "none" ? "" : tip.item.priority === "top" ? " · Top" : " · High"} ·{" "}
            {fieldFigure(tip.item.kind, tip.item.segments)}
          </p>
          <ResourceBar item={tip.item} color={tip.color} />
        </div>
      ) : null}
    </div>
  );
}
