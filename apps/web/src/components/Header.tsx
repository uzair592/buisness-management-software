import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Button } from "@business/ui";
import { usePreview } from "../preview/PreviewProvider";
import { useAuth } from "../context/AuthContext";

export function Header({
  onMenuClick,
  onCommands,
  onHelp,
}: {
  onMenuClick: () => void;
  onCommands: () => void;
  onHelp: () => void;
}) {
  const { sample } = usePreview();
  const auth = useAuth();
  const [online, setOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <header className="app-header">
      <Button
        className="menu-toggle"
        onClick={onMenuClick}
        aria-label="Open navigation"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </Button>
      <div className="workspace-name">
        <span className="workspace-avatar" aria-hidden="true">
          {sample
            ? "S"
            : auth.authenticated && auth.activeMembership
            ? auth.activeMembership.businessName[0].toUpperCase()
            : "B"}
        </span>
        <div>
          <b>
            {sample
              ? "Sample general store"
              : auth.authenticated && auth.activeMembership
              ? auth.activeMembership.businessName
              : "Your workspace"}
          </b>
          <small>
            {sample
              ? "Main location · PKR"
              : auth.authenticated && auth.activeMembership
              ? `${auth.activeMembership.locationName ?? "Main location"} · ${auth.activeMembership.role}`
              : "No business connected"}
          </small>
        </div>
      </div>

      <div className="hidden sm:flex items-center">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
            online
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-amber-100 text-amber-900 border border-amber-300"
          }`}
          title={online ? "Connected to live server" : "Offline - Reconnecting..."}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${online ? "bg-emerald-500 animate-pulse" : "bg-amber-600"}`}
            aria-hidden="true"
          />
          <span>{online ? "Live Online" : "Offline"}</span>
        </span>
      </div>

      <Button
        className="command-trigger"
        onClick={onCommands}
        aria-label="Search pages and actions"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 5 5" />
        </svg>
        <span>Search pages and actions</span>
        <kbd>Ctrl K</kbd>
      </Button>
      <NavLink
        to="/settings"
        className="btn-ghost flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded border border-transparent hover:border-gray-200"
        aria-label={auth.authenticated ? `Account: ${auth.user?.username}` : "Sign in to account"}
      >
        {auth.authenticated ? (
          <>
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" aria-hidden="true" />
            <span>@{auth.user?.username}</span>
          </>
        ) : (
          <span>Sign In</span>
        )}
      </NavLink>
      <Button
        className="preview-indicator"
        onClick={onHelp}
        aria-label="Preview: available functionality"
      >
        Preview <span aria-hidden="true">ⓘ</span>
      </Button>
    </header>
  );
}
