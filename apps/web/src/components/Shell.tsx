import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, Dialog, containDialogTab } from "@business/ui";
import { usePreview } from "../preview/PreviewProvider";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
const navigation = [
  { path: "/home", label: "Home", icon: HomeIcon },
  { path: "/sales", label: "Sales", icon: SalesIcon },
  { path: "/quotes", label: "Quotations", icon: QuotesIcon },
  { path: "/purchases", label: "Purchases", icon: PurchasesIcon },
  { path: "/purchase-orders", label: "Purchase Orders", icon: OrdersIcon },
  { path: "/stock/transfers", label: "Stock Transfers", icon: TransfersIcon },
  { path: "/returns", label: "Returns", icon: ReturnsIcon },
  { path: "/payments", label: "Payments", icon: PaymentsIcon },
  { path: "/parties", label: "Parties", icon: PartiesIcon },
  { path: "/items", label: "Items & Stock", icon: ItemsIcon },
  { path: "/stock/adjustments", label: "Stock Adjustments", icon: AdjustmentsIcon },
  { path: "/cash-bank", label: "Cash & Bank", icon: CashIcon },
  { path: "/expenses", label: "Expenses", icon: ExpensesIcon },
  { path: "/reports", label: "Reports", icon: ReportsIcon },
  { path: "/settings", label: "Settings", icon: SettingsIcon },
];
export function Shell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const preview = usePreview();
  const navigate = useNavigate();
  const drawer = useRef<HTMLDialogElement>(null);
  const location = useLocation();
  useEffect(() => {
    drawer.current?.close();
    window.scrollTo(0, 0);
    document
      .getElementById(
        location.pathname === "/sales/new" ? "item-search" : "main",
      )
      ?.focus({ preventScroll: true });
  }, [location.pathname, preview.sample]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !event.altKey
      ) {
        // Do not open another modal over a receipt or confirmation dialog.
        if (document.querySelector("dialog[open]")) return;
        event.preventDefault();
        setCommandsOpen(true);
      } else if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.key.toLowerCase() === "s") {
          event.preventDefault();
          navigate("/sales/new");
        } else if (event.key.toLowerCase() === "p") {
          event.preventDefault();
          navigate("/purchases/new");
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate]);
  return (
    <div className={"app-shell " + (collapsed ? "is-collapsed" : "")}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="desktop-sidebar">
        <Sidebar navigation={navigation} />
        <button
          className="btn-ghost collapse-button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? "→" : "← Collapse navigation"}
        </button>
      </aside>
      <dialog
        aria-label="Navigation"
        onKeyDown={containDialogTab}
        ref={drawer}
        className="navigation-dialog"
        onClick={(e) => {
          if (e.target === e.currentTarget) drawer.current?.close();
        }}
      >
        <button
          className="btn-secondary m-3"
          onClick={() => drawer.current?.close()}
          autoFocus
        >
          Close navigation
        </button>
        <Sidebar navigation={navigation} />
      </dialog>
      <div className="app-content">
        <Header
          onMenuClick={() => drawer.current?.showModal()}
          onCommands={() => setCommandsOpen(true)}
          onHelp={() => setHelpOpen(true)}
        />
        {preview.sample && (
          <div className="sample-strip" role="status">
            <span>
              <span className="status-dot" />
              Sample data — changes reset
            </span>
            <Button
              onClick={() => {
                preview.exit();
                navigate("/home");
              }}
            >
              Exit sample workspace <span aria-hidden="true">↗</span>
            </Button>
          </div>
        )}
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
      {commandsOpen && (
        <CommandPalette
          routes={navigation}
          onClose={() => setCommandsOpen(false)}
        />
      )}
      {helpOpen && (
        <Dialog title="About this preview" onClose={() => setHelpOpen(false)}>
          <p>
            Explore navigation and page layouts, or try a sample workspace with
            searchable transactions, items and an editable sale cart.
          </p>
          <p>
            Sample data stays in memory. Changes reset when you exit or reload.
            Sample receipts are previews, never saved or issued.
          </p>
          <p>
            Business login and online invoice posting require a server connection.
          </p>
          <p className="dialog-hint">
            Use Ctrl K (⌘ K on Mac) to find pages and actions.
          </p>
          <Button onClick={() => setHelpOpen(false)}>Got it</Button>
        </Dialog>
      )}
    </div>
  );
}
// Icon components
function HomeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
      />
    </svg>
  );
}
function SalesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
      />
    </svg>
  );
}

function PurchasesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
      />
    </svg>
  );
}

function ReturnsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 10h10a5 5 0 015 5v2m0 0l-4-4m4 4l4-4M3 10l4-4M3 10l4 4"
      />
    </svg>
  );
}

function AdjustmentsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
      />
    </svg>
  );
}

function PartiesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  );
}

function ItemsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
      />
    </svg>
  );
}

function CashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function PaymentsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  );
}

function ExpensesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    </svg>
  );
}

function ReportsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

function QuotesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function OrdersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
    </svg>
  );
}

function TransfersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
    </svg>
  );
}
