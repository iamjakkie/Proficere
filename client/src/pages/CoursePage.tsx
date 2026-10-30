import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Course, CourseLesson } from "@progress-island/shared";
import { parseLessonList } from "@progress-island/shared";
import { api } from "../api";

export function CoursePage() {
  const { id } = useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [lessons, setLessons] = useState<CourseLesson[]>([]);
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    if (!id) return;
    api<{ course: Course; lessons: CourseLesson[] }>(`/api/courses/${id}`)
      .then((data) => {
        setCourse(data.course);
        setLessons(data.lessons);
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, [id]);

  function showPaste() {
    setError(null);
    const titles = parseLessonList(paste);
    if (!titles.length) {
      setPreview(null);
      setError("No lesson titles were found in that paste. Nothing was saved.");
      return;
    }
    setPreview(titles);
  }

  async function tryRead() {
    if (!course) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ titles: string[] }>("/api/courses/syllabus", {
        method: "POST",
        body: JSON.stringify({ url: course.url }),
      });
      setPreview(data.titles);
      setPaste(data.titles.join("\n"));
    } catch (err) {
      setPreview(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!course || !preview?.length) return;
    setError(null);
    const data = await api<{ lessons: CourseLesson[] }>(`/api/courses/${course.id}/lessons/confirm`, {
      method: "POST",
      body: JSON.stringify({ titles: preview }),
    });
    setLessons(data.lessons);
    setPreview(null);
    setPaste("");
  }

  async function mark(lesson: CourseLesson, done: boolean) {
    if (!course) return;
    const data = await api<{ lesson: CourseLesson }>(`/api/courses/${course.id}/lessons/${lesson.id}`, {
      method: "PATCH",
      body: JSON.stringify({ done }),
    });
    setLessons((current) => current.map((item) => (item.id === lesson.id ? data.lesson : item)));
  }

  if (error && !course) return <p className="banner danger">{error}</p>;
  if (!course) return <p>Loading course…</p>;

  const doneCount = lessons.filter((lesson) => lesson.done).length;

  return (
    <div className="stack">
      <p>
        <Link to="/courses">Courses</Link>
      </p>
      <section className="card course-shelf">
        <h1>{course.title}</h1>
        <p className="row-actions">
          <a className="btn primary" href={course.url} target="_blank" rel="noreferrer">
            Open
          </a>
          <span className="muted">Opens the course site in a new tab. Mark a lesson when you come back.</span>
        </p>
        {lessons.length > 0 && (
          <p>
            {doneCount} of {lessons.length} lessons done
            {doneCount === lessons.length ? " · Finished" : ""}
          </p>
        )}
        {error && <p className="banner danger">{error}</p>}
        {lessons.length === 0 && <p>No lessons stored yet. Paste a list, or try to read titles from a public page, then confirm.</p>}
        <ul className="lesson-list">
          {lessons.map((lesson) => (
            <li key={lesson.id}>
              <span>{lesson.title}</span>
              <span className="row-actions">
                <button className={lesson.done ? "btn good" : "btn"} type="button" onClick={() => void mark(lesson, true)}>
                  Done
                </button>
                <button className={lesson.done ? "btn" : "btn primary"} type="button" onClick={() => void mark(lesson, false)}>
                  Still here
                </button>
              </span>
            </li>
          ))}
        </ul>
        <label className="stack">
          Syllabus or lesson list
          <textarea
            aria-label="Lesson list"
            rows={6}
            value={paste}
            placeholder={"One lesson per line\n1. Introduction\n2. Exercises"}
            onChange={(event) => setPaste(event.target.value)}
          />
        </label>
        <p className="row-actions">
          <button className="btn" type="button" onClick={showPaste}>
            Preview pasted lessons
          </button>
          <button className="btn" type="button" disabled={busy} onClick={() => void tryRead()}>
            {busy ? "Reading page…" : "Try to read lesson titles"}
          </button>
        </p>
        {preview && (
          <div className="card">
            <h2>Confirm these lessons</h2>
            <p className="muted">Edit the list before it is stored. Nothing here is saved until you confirm.</p>
            <textarea
              aria-label="Lesson preview"
              rows={Math.min(12, Math.max(4, preview.length))}
              value={preview.join("\n")}
              onChange={(event) => setPreview(parseLessonList(event.target.value))}
            />
            <button className="btn primary" type="button" disabled={preview.length === 0} onClick={() => void confirm()}>
              Confirm lessons
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
