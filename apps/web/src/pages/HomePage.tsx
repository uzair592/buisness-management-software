import { Link, useSearchParams } from "react-router-dom";
import { Panel, EmptyState, Icon } from "@business/ui";
import { atOrBelow, formatMoney, sumAmounts } from "@business/domain";
import { usePreview } from "../preview/PreviewProvider";
import { cartAmount, inPeriod, transactionDue } from "../preview/fixtures";
import { Transactions, PeriodFilter } from "../components/Transactions";
import { TrySample } from "../components/PreviewActions";
export function HomePage() {
  const { sample, items, transactions } = usePreview();
  const [params] = useSearchParams();
  const period = params.get("period") ?? "day";
  const rows = transactions.filter((t) => inPeriod(t.date, period));
  const sales = rows.filter((t) => t.kind === "Sale");
  const purchases = rows.filter((t) => t.kind === "Purchase");
  const summaries = [
    {
      label: "Sales",
      value: formatMoney(sumAmounts(sales.map((t) => cartAmount(t.lines)))),
      detail: `${sales.length} sample sales`,
      path: "/sales?period=" + period,
      icon: "sale",
    },
    {
      label: "Receivables",
      value: formatMoney(sumAmounts(sales.map(transactionDue))),
      detail: "Outstanding on selected sales",
      path: "/sales?status=Due&period=" + period,
      icon: "parties",
    },
    {
      label: "Payables",
      value: formatMoney(sumAmounts(purchases.map(transactionDue))),
      detail: "Outstanding on selected purchases",
      path: "/purchases?status=Due&period=" + period,
      icon: "purchase",
    },
    {
      label: "Low stock",
      value: String(items.filter((i) => atOrBelow(i.stock, i.reorder)).length),
      detail: "Items at reorder level · 15 Oct",
      path: "/items?filter=low",
      icon: "items",
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">OVERVIEW</p>
          <h1>Home</h1>
          <p>
            {sample
              ? "A snapshot of your sample store."
              : "Make room for a clearer business day."}
          </p>
        </div>
        <div className="heading-actions">
          {sample && <PeriodFilter />}
          <Link className="btn-secondary" to="/purchases/new">
            ＋ Add Purchase
          </Link>
          <Link className="btn-primary" to="/sales/new">
            ＋ New Sale
          </Link>
        </div>
      </div>
      {!sample && (
        <div className="welcome-panel">
          <div>
            <span className="welcome-icon" aria-hidden="true">
              B
            </span>
            <div>
              <h2>Explore your next workspace</h2>
              <p>
                Your operational workspace is empty. Try a sample store to
                explore sales, customers and stock.
              </p>
            </div>
          </div>
          <TrySample />
        </div>
      )}
      <div className="stats-grid">
        {summaries.map((s, i) => (
          <Link
            className={"stat-card stat-" + i}
            to={s.path}
            key={s.label}
            aria-label={"View " + s.label}
          >
            <div className="stat-label">
              {s.label}
              <span className="metric-icon" aria-hidden="true">
                <Icon name={s.icon} />
              </span>
            </div>
            <strong className="stat-value">{sample ? s.value : "—"}</strong>
            <small>
              {sample ? s.detail : "Connect a business to see totals"}
              <span aria-hidden="true">→</span>
            </small>
          </Link>
        ))}
      </div>
      <div className="dashboard-grid">
        <Panel className="records-panel">
          <div className="section-heading">
            <div>
              <h2>Recent transactions</h2>
              <p className="muted">
                {sample
                  ? "Selected sample dates · sales and purchases"
                  : "An overview of your sales and purchases."}
              </p>
            </div>
            <Link to={"/sales?period=" + period} className="text-link">
              View sales →
            </Link>
          </div>
          {sample ? (
            <Transactions />
          ) : (
            <>
              <EmptyState title="Your first records will appear here">
                There are no connected business records. You can explore the
                sales layout or browse sample transactions.
              </EmptyState>
              <div className="empty-actions">
                <Link className="btn-secondary" to="/sales">
                  Explore Sales
                </Link>
              </div>
            </>
          )}
        </Panel>
        <div className="dashboard-aside">
          <Panel>
            <h2>Quick actions</h2>
            <div className="shortcut-list">
              {[
                ["/sales/new", "New Sale", "Build a bill", "sale"],
                ["/purchases", "Purchases", "Supplier bills", "purchase"],
                ["/parties", "Parties", "Customers & suppliers", "parties"],
                ["/items", "Items & Stock", "Prices & availability", "items"],
              ].map(([path, label, detail, icon]) => (
                <Link to={path} key={path}>
                  <span className="shortcut-icon" aria-hidden="true">
                    <Icon name={icon} />
                  </span>
                  <span>
                    <b>{label}</b>
                    <small>{detail}</small>
                  </span>
                  <span className="shortcut-arrow" aria-hidden="true">
                    ›
                  </span>
                </Link>
              ))}
            </div>
          </Panel>
          <Panel className="insight-panel">
            <div className="section-heading">
              <h2>{sample ? "Stock to watch" : "Get started"}</h2>
              <span aria-hidden="true">↗</span>
            </div>
            {sample ? (
              <>
                <p className="muted">Sample snapshot · 15 Oct 2026</p>
                <ul className="stock-watch">
                  {items
                    .filter((i) => atOrBelow(i.stock, i.reorder))
                    .map((i) => (
                      <li key={i.id}>
                        <span>{i.name}</span>
                        <b>{i.stock} left</b>
                      </li>
                    ))}
                </ul>
                <Link className="text-link" to="/items?filter=low">
                  Review low stock →
                </Link>
              </>
            ) : (
              <>
                <p className="muted">
                  Business setup is coming next. Explore the layout while your
                  workspace takes shape.
                </p>
                <Link to="/settings" className="text-link">
                  View setup →
                </Link>
              </>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
