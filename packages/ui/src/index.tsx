import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";
export function containDialogTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const dialog = event.currentTarget;
  const controls = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getClientRects().length > 0);
  const first = controls[0],
    last = controls[controls.length - 1];
  if (!first) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const active = document.activeElement;
  if (
    event.shiftKey &&
    (active === first || active === dialog || !dialog.contains(active))
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (active === last || active === dialog || !dialog.contains(active))
  ) {
    event.preventDefault();
    first.focus();
  }
}
export function Dialog({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    (
      dialog.querySelector<HTMLElement>("[data-dialog-autofocus]") ??
      dialog.querySelector("button")
    )?.focus();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);
  return (
    <dialog
      ref={ref}
      className={"app-dialog " + className}
      aria-label={title}
      tabIndex={-1}
      onKeyDown={containDialogTab}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <Button onClick={onClose} aria-label={"Close " + title}>
          ×
        </Button>
      </div>
      {children}
    </dialog>
  );
}
export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    sale: "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6",
    purchase: "M4 7h16v13H4V7Zm3 0V4h10v3m-8 5h6",
    parties:
      "M3 20v-3c0-3 8-3 8 0v3m2 0v-3c0-3 8-3 8 0v3M7 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm10 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    items: "m3 7 9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10",
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.items} />
    </svg>
  );
}
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={"panel " + className}>{children}</section>;
}
export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge badge-neutral">{children}</span>;
}
export function Button({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={"btn-secondary " + className} {...props} />
  );
}
export function Field({
  label,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input className="input" id={id} {...props} />
    </div>
  );
}
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-symbol" aria-hidden="true">
        ▤
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function Table({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="table-container">
      <table className="table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                scope="col"
                className={
                  ["Amount", "Price", "Outstanding"].includes(h)
                    ? "amount"
                    : undefined
                }
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
