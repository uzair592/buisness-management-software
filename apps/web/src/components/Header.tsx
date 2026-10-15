import { Button } from "@business/ui";
import { usePreview } from "../preview/PreviewProvider";
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
          {sample ? "S" : "B"}
        </span>
        <div>
          <b>{sample ? "Sample general store" : "Your workspace"}</b>
          <small>
            {sample ? "Main location · PKR" : "No business connected"}
          </small>
        </div>
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
