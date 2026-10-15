import { Link } from "react-router-dom";
import { Badge, Panel, EmptyState } from "@business/ui";
export function HomePage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h1>Home</h1>
          <p>A clear view of your everyday business.</p>
        </div>
        <Link className="btn-primary" to="/sales/new">
          ＋ New Sale
        </Link>
      </div>
      <div className="notice">
        <Badge>Foundation preview</Badge>
        <span>
          Navigation and layouts are ready to explore. No business is connected
          and no transactions can be saved.
        </span>
      </div>
      <div className="stats-grid">
        {["Today's sales", "Receivables", "Payables", "Low stock"].map(
          (title) => (
            <Panel key={title}>
              <p className="text-sm text-surface-600">{title}</p>
              <p className="stat-value">—</p>
              <p className="text-xs text-surface-500">
                Business data unavailable
              </p>
            </Panel>
          ),
        )}
      </div>
      <div className="home-grid">
        <Panel>
          <div className="section-heading">
            <h2>Recent documents</h2>
            <Badge>Not connected</Badge>
          </div>
          <EmptyState title="Your records will appear here">
            Sales and purchase history become available after the business
            workflows are implemented.
          </EmptyState>
        </Panel>
        <Panel>
          <h2>Quick access</h2>
          <p className="text-sm text-surface-500 mt-1">
            Find your next workspace.
          </p>
          <div className="quick-links">
            <Link to="/sales/new">
              <b>New Sale layout</b>
              <span>Explore the billing workspace →</span>
            </Link>
            <Link to="/purchases">
              <b>Purchases</b>
              <span>Planned supplier workflows →</span>
            </Link>
            <Link to="/items">
              <b>Items & Stock</b>
              <span>Planned catalogue workspace →</span>
            </Link>
          </div>
        </Panel>
      </div>
      <Panel>
        <div className="section-heading">
          <h2>Getting started</h2>
          <Link to="/settings" className="text-primary-700 text-sm">
            View setup →
          </Link>
        </div>
        <div className="setup-grid">
          <div>
            <b>01 · Workspace</b>
            <p>Responsive navigation and sale layout.</p>
            <Badge>Available to preview</Badge>
          </div>
          <div>
            <b>02 · Connect your business</b>
            <p>Login, membership and device enrolment.</p>
            <Badge>Planned · M02</Badge>
          </div>
          <div>
            <b>03 · Start trading</b>
            <p>Catalogue, opening balances and billing.</p>
            <Badge>Planned · M04–M05</Badge>
          </div>
        </div>
      </Panel>
    </>
  );
}
