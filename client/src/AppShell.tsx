import { NavLink, Outlet } from "react-router-dom";

export function AppShell() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <strong>Progress Island</strong>
          <span>Build your island. Keep what you learn.</span>
        </NavLink>
        <nav>
          <NavLink to="/" end>
            Island
          </NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
