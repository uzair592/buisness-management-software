import { Link } from "react-router-dom";
export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <header className="app-header">
      <button
        className="btn-secondary menu-toggle"
        onClick={onMenuClick}
        aria-label="Open navigation"
      >
        ☰
      </button>
      <span className="text-sm font-medium">
        No business connected{" "}
        <span className="text-surface-500 hidden sm:inline">
          {" "}
          / Main workspace
        </span>
      </span>
      <div className="header-links">
        <Link to="/sync">Sync unavailable</Link>
        <Link to="/settings">Help & setup</Link>
        <span className="badge badge-neutral">M01 preview</span>
      </div>
    </header>
  );
}
