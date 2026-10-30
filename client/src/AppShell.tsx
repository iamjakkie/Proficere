import { NavLink, Outlet } from "react-router-dom";

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <strong>Progress Island</strong>
          <span>Keep what you learn.</span>
        </NavLink>
        <nav>
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/articles">Articles</NavLink>
          <NavLink to="/courses">Courses</NavLink>
          <NavLink to="/workshop">Workshop</NavLink>
          <NavLink to="/projects">Exams</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
