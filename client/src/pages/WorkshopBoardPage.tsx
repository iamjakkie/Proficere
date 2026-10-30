import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  WORKSHOP_COLUMN_LABELS,
  workshopColumns,
  type WorkshopCard,
  type WorkshopColumn,
  type WorkshopProject,
} from "@progress-island/shared";
import { api } from "../api";

type Board = {
  project: WorkshopProject;
  cards: WorkshopCard[];
  projects: WorkshopProject[];
  ai: { configured: boolean };
};

export function WorkshopBoardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [description, setDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [cardTitle, setCardTitle] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDetail, setDraftDetail] = useState("");
  const [shineId, setShineId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load(projectId: string) {
    api<Board>(`/api/workshop/projects/${projectId}`)
      .then((data) => {
        setBoard(data);
        setDescription(data.project.description ?? "");
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    if (id) load(id);
  }, [id]);

  async function moveCard(cardId: string, column: WorkshopColumn) {
    const data = await api<{ card: WorkshopCard }>(`/api/workshop/cards/${cardId}`, {
      method: "PATCH",
      body: JSON.stringify({ column }),
    });
    setBoard((current) =>
      current
        ? { ...current, cards: current.cards.map((card) => (card.id === cardId ? data.card : card)) }
        : current,
    );
    if (column === "done") {
      setShineId(cardId);
      window.setTimeout(() => setShineId((current) => (current === cardId ? null : current)), 4000);
    }
  }

  async function saveCard(cardId: string) {
    const data = await api<{ card: WorkshopCard }>(`/api/workshop/cards/${cardId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: draftTitle, detail: draftDetail }),
    });
    setBoard((current) =>
      current
        ? { ...current, cards: current.cards.map((card) => (card.id === cardId ? data.card : card)) }
        : current,
    );
    setEditing(null);
  }

  async function addCard() {
    if (!board || !cardTitle.trim()) return;
    const data = await api<{ card: WorkshopCard }>(`/api/workshop/projects/${board.project.id}/cards`, {
      method: "POST",
      body: JSON.stringify({ title: cardTitle.trim(), column: "todo" }),
    });
    setBoard((current) => (current ? { ...current, cards: [...current.cards, data.card] } : current));
    setCardTitle("");
  }

  async function saveDescription() {
    if (!board) return;
    const data = await api<{ project: WorkshopProject }>(`/api/workshop/projects/${board.project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ description }),
    });
    setBoard((current) => (current ? { ...current, project: data.project } : current));
  }

  async function plan() {
    if (!board) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ cards: WorkshopCard[]; project: WorkshopProject }>(
        `/api/workshop/projects/${board.project.id}/plan`,
        {
          method: "POST",
          body: JSON.stringify({ description, consent: true }),
        },
      );
      setBoard((current) => (current ? { ...current, project: data.project, cards: data.cards } : current));
      setConsent(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !board) return <p className="banner danger">{error}</p>;
  if (!board) return <p>Loading project…</p>;

  return (
    <div className="stack">
      <p>
        <Link to="/workshop">Workshop</Link>
      </p>
      <section className="card workshop-shelf">
        <div className="board-head">
          <h1>{board.project.title}</h1>
          <label>
            Project
            <select
              aria-label="Switch project"
              value={board.project.id}
              onChange={(event) => navigate(`/workshop/${event.target.value}`)}
            >
              {board.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">
          {[board.project.category, ...board.project.tags].filter(Boolean).join(" · ") || "No category yet"}
        </p>
        {error && <p className="banner danger">{error}</p>}
        <label className="stack">
          Describe this project
          <textarea
            aria-label="Project description"
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <p className="row-actions">
          <button className="btn" type="button" onClick={() => void saveDescription()}>
            Save description
          </button>
        </p>
        {board.ai.configured ? (
          <div className="stack">
            <label className="check">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> Planning
              sends this description to OpenRouter and then to the selected model provider.
            </label>
            <button className="btn" type="button" disabled={busy || !consent || !description.trim()} onClick={() => void plan()}>
              {busy ? "Planning…" : "Plan this project"}
            </button>
          </div>
        ) : (
          <p className="banner">Configure OpenRouter to enable AI. You can still add and move cards yourself.</p>
        )}
        <form
          className="category-add"
          onSubmit={(event) => {
            event.preventDefault();
            void addCard();
          }}
        >
          <input
            aria-label="New card title"
            placeholder="New card"
            value={cardTitle}
            onChange={(event) => setCardTitle(event.target.value)}
          />
          <button className="btn" type="submit">
            Add card
          </button>
        </form>
      </section>
      {board.cards.length === 0 && <p>No cards yet. Add one, or describe the project and plan it.</p>}
      <div className="kanban">
        {workshopColumns.map((column) => (
          <section
            key={column}
            className="kanban-column"
            aria-label={WORKSHOP_COLUMN_LABELS[column]}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const cardId = event.dataTransfer.getData("text/plain");
              if (cardId) void moveCard(cardId, column);
            }}
          >
            <h2>{WORKSHOP_COLUMN_LABELS[column]}</h2>
            {board.cards
              .filter((card) => card.column === column)
              .map((card) => (
                <article
                  key={card.id}
                  className={shineId === card.id ? "kanban-card shine" : "kanban-card"}
                  draggable={editing !== card.id}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", card.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                >
                  <button
                    className="drag-handle"
                    type="button"
                    draggable
                    aria-label={`Drag ${card.title}`}
                    onDragStart={(event) => {
                      event.stopPropagation();
                      event.dataTransfer.setData("text/plain", card.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    Drag
                  </button>
                  {editing === card.id ? (
                    <div className="stack">
                      <input aria-label="Card title" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
                      <textarea
                        aria-label="Card detail"
                        rows={3}
                        value={draftDetail}
                        onChange={(event) => setDraftDetail(event.target.value)}
                      />
                      <button className="btn" type="button" onClick={() => void saveCard(card.id)}>
                        Save card
                      </button>
                    </div>
                  ) : (
                    <button
                      className="text-btn card-title"
                      type="button"
                      onClick={() => {
                        setEditing(card.id);
                        setDraftTitle(card.title);
                        setDraftDetail(card.detail ?? "");
                      }}
                    >
                      {card.title}
                    </button>
                  )}
                  {editing !== card.id && card.detail && <p className="muted">{card.detail}</p>}
                  <div className="row-actions">
                    {workshopColumns
                      .filter((target) => target !== column)
                      .map((target) => (
                        <button key={target} className="btn ghost" type="button" onClick={() => void moveCard(card.id, target)}>
                          {WORKSHOP_COLUMN_LABELS[target]}
                        </button>
                      ))}
                  </div>
                </article>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
