import { NavLink, Outlet } from "react-router-dom";

const NAV = [
  { to: "/", end: true, label: "Home", latin: "domus" },
  { to: "/library", label: "Library", latin: "bibliotheca" },
  { to: "/articles", label: "Articles", latin: "commentarii" },
  { to: "/exercises", label: "Exercises", latin: "exercitia" },
  { to: "/courses", label: "Courses", latin: "cursus" },
  { to: "/workshop", label: "Workshop", latin: "officina" },
  { to: "/projects", label: "Exams", latin: "examina" },
  { to: "/settings", label: "Settings", latin: "optiones" },
] as const;

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand" title="proficere — to advance, to make progress">
          <Logo />
          <strong>Proficere</strong>
          <span>to advance</span>
        </NavLink>
        <nav>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={"end" in item ? item.end : undefined} title={`${item.latin} — ${item.label}`}>
              <span>{item.label}</span>
              <small>{item.latin}</small>
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

function Logo() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1.25" y="1.25" width="29.5" height="29.5" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 24V8h7.2a5.2 5.2 0 0 1 0 10.4H9" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M17.5 18.4 24 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M19.2 12H24v4.8" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
