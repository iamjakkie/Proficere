import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { BookCategory, Course, Priority } from "@progress-island/shared";
import { courseraTarget, ocwLectureNotesUrl, udemyCourseSlug } from "@progress-island/shared";
import { api } from "../api";
import { CategorySelect } from "../CategorySelect";
import { PrioritySelect } from "../PrioritySelect";

type CourseRow = Course & { lessonCount: number; doneCount: number };

export function CoursesPage() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [categories, setCategories] = useState<BookCategory[]>([]);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ courses: CourseRow[] }>("/api/courses")
      .then((data) => setCourses(data.courses))
      .catch((err: Error) => setError(err.message));
    api<{ categories: BookCategory[] }>("/api/categories")
      .then((data) => setCategories(data.categories))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function assignCategory(course: CourseRow, category: string | null) {
    setError(null);
    const data = await api<{ course: Course }>(`/api/courses/${course.id}/category`, {
      method: "PUT",
      body: JSON.stringify({ category }),
    });
    setCourses((current) =>
      current.map((item) => (item.id === course.id ? { ...item, ...data.course } : item)),
    );
  }

  async function assignPriority(course: CourseRow, priority: Priority) {
    setError(null);
    const data = await api<{ course: Course }>(`/api/courses/${course.id}/priority`, {
      method: "PUT",
      body: JSON.stringify({ priority }),
    });
    setCourses((current) =>
      current.map((item) => (item.id === course.id ? { ...item, ...data.course } : item)),
    );
  }

  async function removeCourse(course: CourseRow) {
    if (!window.confirm(`Delete ${course.title}? Its lessons are removed with it.`)) return;
    setError(null);
    try {
      await api(`/api/courses/${course.id}`, { method: "DELETE" });
      setCourses((current) => current.filter((item) => item.id !== course.id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addCourse(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const data = await api<{ course: Course }>("/api/courses", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), url: url.trim() }),
      });
      navigate(`/courses/${data.course.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="stack">
      <section className="card course-shelf">
        <h1>Courses</h1>
        <p className="muted">
          Paste a title and the course URL. A Udemy link loads that course&apos;s public sections. A Coursera
          specialization loads its courses, and a Coursera course link loads its modules. An MIT OpenCourseWare link
          loads its lecture list. Confirm the list before anything is stored. Open launches the real site in a new tab,
          and the files stay there. The category sets the bar color on Home. Priority is a mark on that row: none, high,
          or top.
        </p>
        {error && <p className="banner danger">{error}</p>}
        <form className="stack" onSubmit={(event) => void addCourse(event)}>
          <label>
            Title
            <input aria-label="Course title" value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label>
            URL
            <input
              aria-label="Course URL"
              value={url}
              placeholder="https://"
              onChange={(event) => setUrl(event.target.value)}
              required
            />
          </label>
          {udemyCourseSlug(url.trim()) && (
            <p className="muted">This Udemy link will load its public sections for confirmation.</p>
          )}
          {courseraTarget(url.trim())?.kind === "specialization" && (
            <p className="muted">This Coursera link will load its public course list for confirmation.</p>
          )}
          {courseraTarget(url.trim())?.kind === "course" && (
            <p className="muted">This Coursera link will load its public modules for confirmation.</p>
          )}
          {ocwLectureNotesUrl(url.trim()) && (
            <p className="muted">This MIT OpenCourseWare link will load its lecture list for confirmation.</p>
          )}
          <button className="btn primary" type="submit">
            Add course
          </button>
        </form>
        {courses.length === 0 ? (
          <p>No courses yet.</p>
        ) : (
          <ul className="shelf-list">
            {courses.map((course) => (
              <li key={course.id}>
                <Link to={`/courses/${course.id}`}>{course.title}</Link>
                <CategorySelect
                  label={`Category for ${course.title}`}
                  categories={categories}
                  value={course.category}
                  onChange={(category) => void assignCategory(course, category)}
                />
                <PrioritySelect
                  label={`Priority for ${course.title}`}
                  value={course.priority}
                  onChange={(priority) => void assignPriority(course, priority)}
                />
                <span className="muted">
                  {course.lessonCount === 0
                    ? "No lessons confirmed"
                    : `${course.doneCount} of ${course.lessonCount} done`}
                </span>
                <button className="btn ghost" type="button" onClick={() => void removeCourse(course)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
