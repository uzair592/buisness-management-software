import { NavLink } from "react-router-dom";
import type { ComponentType } from "react";
export function Sidebar({
  navigation,
}: {
  navigation: {
    path: string;
    label: string;
    icon: ComponentType<{ className?: string }>;
  }[];
}) {
  return (
    <>
      <div className="brand">
        <span className="brand-mark">B</span>
        <span className="nav-label">
          Business
          <br />
          <small>MANAGEMENT SOFTWARE</small>
        </span>
      </div>
      <p className="nav-caption nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation">
        {navigation.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            title={label}
            className={({ isActive }) =>
              "sidebar-link " + (isActive ? "sidebar-link-active" : "")
            }
          >
            <Icon className="w-5 h-5 shrink-0" />
            <span className="nav-label">{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-note nav-label">
        Foundation preview
        <br />
        <span>
          Explore the workspace.
          <br />
          Business records come next.
        </span>
      </div>
    </>
  );
}
