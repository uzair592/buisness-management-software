import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog } from "@business/ui";
import { usePreview } from "../preview/PreviewProvider";
export function CommandPalette({
  routes,
  onClose,
}: {
  routes: { path: string; label: string }[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  useEffect(() => {
    document
      .getElementById("command-" + active)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, query]);
  const navigate = useNavigate();
  const preview = usePreview();
  const commands = [
    {
      label: "New Sale",
      description: preview.sample
        ? "Build a sample cart"
        : "Open billing workspace",
      run: () => navigate("/sales/new"),
    },
    ...routes.map((r) => ({
      label: r.label,
      description: "Open " + r.label,
      run: () => navigate(r.path),
    })),
    {
      label: preview.sample ? "Exit sample workspace" : "Try sample workspace",
      description: preview.sample
        ? "Reset sample changes and return home"
        : "Explore with isolated sample records",
      run: () => {
        if (preview.sample) preview.exit();
        else preview.enter();
        navigate("/home");
      },
    },
  ].filter((c) =>
    (c.label + " " + c.description).toLowerCase().includes(query.toLowerCase()),
  );
  function run(index: number) {
    const command = commands[index];
    if (command) {
      command.run();
      onClose();
    }
  }
  return (
    <Dialog
      title="Go to or try an action"
      onClose={onClose}
      className="command-dialog"
    >
      <label className="sr-only" htmlFor="command-search">
        Search commands
      </label>
      <input
        id="command-search"
        className="input command-search"
        placeholder="Search pages and actions…"
        data-dialog-autofocus
        role="combobox"
        aria-expanded="true"
        aria-controls="command-results"
        aria-autocomplete="list"
        aria-activedescendant={
          commands.length
            ? "command-" + Math.min(active, commands.length - 1)
            : undefined
        }
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) =>
              commands.length
                ? (i + (e.key === "ArrowDown" ? 1 : -1) + commands.length) %
                  commands.length
                : 0,
            );
          }
          if (e.key === "Enter") {
            e.preventDefault();
            run(active);
          }
        }}
      />
      <div
        id="command-results"
        role="listbox"
        aria-label="Commands"
        className="command-results"
      >
        {commands.map((c, i) => (
          <button
            id={"command-" + i}
            role="option"
            aria-selected={i === active}
            key={c.label}
            onClick={() => run(i)}
          >
            <span>
              <b>{c.label}</b>
              <small>{c.description}</small>
            </span>
            <span aria-hidden="true">↵</span>
          </button>
        ))}
      </div>
      {!commands.length && (
        <p className="muted">No matching pages or actions.</p>
      )}
      <p className="dialog-hint">
        ↑ ↓ to choose · Enter to open · Escape to close
      </p>
    </Dialog>
  );
}
