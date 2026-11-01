import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { BookCategory, Priority, WorkshopProject } from "@progress-island/shared";
import { api } from "../api";
import { CategorySelect } from "../CategorySelect";
import { PrioritySelect } from "../PrioritySelect";

export function WorkshopPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<WorkshopProject[]>([]);
  const [categories, setCategories] = useState<BookCategory[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>("none");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<{ projects: WorkshopProject[] }>("/api/workshop/projects")
      .then((data) => setProjects(data.projects))
      .catch((err: Error) => setError(err.message));
    api<{ categories: BookCategory[] }>("/api/categories")
      .then((data) => setCategories(data.categories))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);

  async function addProject(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const data = await api<{ project: WorkshopProject }>("/api/workshop/projects", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          category,
          priority,
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

  async function assignCategory(project: WorkshopProject, next: string | null) {
    setError(null);
    const data = await api<{ project: WorkshopProject }>(`/api/workshop/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ category: next }),
    });
    setProjects((current) => current.map((item) => (item.id === project.id ? data.project : item)));
  }

  async function assignPriority(project: WorkshopProject, next: Priority) {
    setError(null);
    const data = await api<{ project: WorkshopProject }>(`/api/workshop/projects/${project.id}/priority`, {
      method: "PUT",
      body: JSON.stringify({ priority: next }),
    });
    setProjects((current) => current.map((item) => (item.id === project.id ? data.project : item)));
  }

  return (
    <div className="stack">
      <section className="card workshop-shelf">
        <h1>Workshop</h1>
        <p className="muted">
          Each project has its own board: TODO, In progress, Test, and Done. A categorized project also appears on Home.
          Its bar is one segment per task, filled when that task is Done. Priority is a mark on that row.
        </p>
        {error && <p className="banner danger">{error}</p>}
        <form className="stack" onSubmit={(event) => void addProject(event)}>
          <label>
            Project title
            <input aria-label="Project title" value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label>
            Category
            <CategorySelect
              label="Project category"
              categories={categories}
              value={category}
              onChange={setCategory}
            />
          </label>
          <label>
            Priority
            <PrioritySelect label="Project priority" value={priority} onChange={setPriority} />
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
                <CategorySelect
                  label={`Category for ${project.title}`}
                  categories={categories}
                  value={project.category}
                  onChange={(next) => void assignCategory(project, next)}
                />
                <PrioritySelect
                  label={`Priority for ${project.title}`}
                  value={project.priority}
                  onChange={(next) => void assignPriority(project, next)}
                />
                <span className="muted">{project.tags.join(" · ") || "No tags"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
