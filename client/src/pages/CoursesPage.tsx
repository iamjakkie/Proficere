import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { BookCategory, Course } from "@progress-island/shared";
import { api } from "../api";
import { CategorySelect } from "../CategorySelect";

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
          Paste the course URL. Open launches the real site in a new tab. This app does not embed Udemy or Coursera, and
          it does not read a logged-in lesson list from those sites. The category sets the bar color on Home.
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
                <span className="muted">
                  {course.lessonCount === 0
                    ? "No lessons confirmed"
                    : `${course.doneCount} of ${course.lessonCount} done`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
