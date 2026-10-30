import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { WorkshopProject } from "@progress-island/shared";
import { api } from "../api";

export function WorkshopPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<WorkshopProject[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ projects: WorkshopProject[] }>("/api/workshop/projects")
      .then((data) => setProjects(data.projects))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function addProject(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const data = await api<{ project: WorkshopProject }>("/api/workshop/projects", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          category: category.trim() || null,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });
      navigate(`/workshop/${data.project.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="stack">
      <section className="card workshop-shelf">
        <h1>Workshop</h1>
        <p className="muted">
          Each project has its own board: TODO, In progress, Test, and Done. This is separate from Exams.
        </p>
        {error && <p className="banner danger">{error}</p>}
        <form className="stack" onSubmit={(event) => void addProject(event)}>
          <label>
            Project title
            <input aria-label="Project title" value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label>
            Category
            <input aria-label="Project category" value={category} onChange={(event) => setCategory(event.target.value)} />
          </label>
          <label>
            Tags
            <input
              aria-label="Project tags"
              placeholder="comma separated"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
          </label>
          <button className="btn primary" type="submit">
            Add project
          </button>
        </form>
        {projects.length === 0 ? (
          <p>No projects yet.</p>
        ) : (
          <ul className="shelf-list">
            {projects.map((project) => (
              <li key={project.id}>
                <Link to={`/workshop/${project.id}`}>{project.title}</Link>
                <span className="muted">
                  {[project.category, ...project.tags].filter(Boolean).join(" · ") || "No category"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
