import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Dialog, EmptyState, Table } from "@business/ui";
import { formatMoney } from "@business/domain";
import { usePreview } from "../preview/PreviewProvider";
import {
  cartAmount,
  inPeriod,
  itemById,
  partyName,
  transactionDue,
  type SampleTransaction,
} from "../preview/fixtures";
export function PeriodFilter() {
  const [params, setParams] = useSearchParams();
  return (
    <label className="inline-field">
      <span>Date range</span>
      <select
        className="input"
        aria-label="Date range"
        value={params.get("period") ?? "day"}
        onChange={(e) => {
          const p = new URLSearchParams(params);
          p.set("period", e.target.value);
          setParams(p);
        }}
      >
        <option value="day">15 Oct 2026</option>
        <option value="week">Last 7 sample days</option>
        <option value="all">All sample dates</option>
      </select>
    </label>
  );
}
export function Transactions({ kind }: { kind?: "Sale" | "Purchase" }) {
  const { transactions } = usePreview();
  const [params, setParams] = useSearchParams();
  const [detail, setDetail] = useState<SampleTransaction | null>(null);
  const query = params.get("q") ?? "";
  const status = params.get("status") ?? "All";
  const period = params.get("period") ?? "day";
  const rows = transactions.filter(
    (t) =>
      (!kind || kind === t.kind) &&
      inPeriod(t.date, period) &&
      (status === "All" ||
        (transactionDue(t) === "0.00" ? "Paid" : "Due") === status) &&
      (t.id + " " + partyName(t.partyId) + " " + t.kind)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function filter(name: string, value: string) {
    const p = new URLSearchParams(params);
    p.set(name, value);
    setParams(p, { replace: true });
  }
  return (
    <>
      <div className="table-toolbar">
        <label className="search-field">
          <span className="sr-only">Search transactions</span>
          <input
            className="input"
            type="search"
            placeholder="Search name or reference…"
            value={query}
            onChange={(e) => filter("q", e.target.value)}
          />
        </label>
        <label className="inline-field">
          <span className="sr-only">Transaction status</span>
          <select
            className="input"
            aria-label="Transaction status"
            value={status}
            onChange={(e) => filter("status", e.target.value)}
          >
            <option>All</option>
            <option>Paid</option>
            <option>Due</option>
          </select>
        </label>
      </div>
      <Table headers={["Transaction", "Type", "Date", "Amount", "Status"]}>
        {rows.map((t) => (
          <tr key={t.id}>
            <td>
              <button
                className="document-link"
                aria-label={"View Sample " + t.id}
                onClick={() => setDetail(t)}
              >
                {partyName(t.partyId)}
                <small>Sample {t.id}</small>
              </button>
            </td>
            <td>{t.kind}</td>
            <td>{t.date.slice(8)} Oct 2026</td>
            <td className="amount">{formatMoney(cartAmount(t.lines))}</td>
            <td>
              <span
                className={
                  "status-badge " +
                  (transactionDue(t) === "0.00" ? "paid" : "due")
                }
              >
                {transactionDue(t) === "0.00" ? "Paid" : "Due"}
              </span>
            </td>
          </tr>
        ))}
        {!rows.length && (
          <tr>
            <td colSpan={5}>
              <EmptyState title="No matching transactions">
                Try another date range, status or search.
              </EmptyState>
              <Button onClick={() => setParams({ period: "all" })}>
                Reset filters
              </Button>
            </td>
          </tr>
        )}
      </Table>
      <div className="table-footer">
        <span>
          {rows.length} {rows.length === 1 ? "transaction" : "transactions"}
        </span>
        <span>Sample records · read only</span>
      </div>
      {detail && (
        <Dialog
          title={"Sample " + detail.id}
          onClose={() => setDetail(null)}
          className="detail-dialog"
        >
          <p className="muted">
            {detail.kind} · {detail.date} · Sample record
          </p>
          <h3 className="detail-party">{partyName(detail.partyId)}</h3>
          <ul className="receipt-lines">
            {detail.lines.map((l) => (
              <li key={l.itemId}>
                <span>
                  {itemById(l.itemId).name}
                  <small>
                    {l.quantity} {itemById(l.itemId).unit}
                  </small>
                </span>
                <b>{formatMoney(cartAmount([l]))}</b>
              </li>
            ))}
          </ul>
          <dl className="totals">
            <div>
              <dt>Total</dt>
              <dd>{formatMoney(cartAmount(detail.lines))}</dd>
            </div>
            <div>
              <dt>Paid in sample</dt>
              <dd>{formatMoney(detail.paid)}</dd>
            </div>
            <div>
              <dt>Remaining</dt>
              <dd>{formatMoney(transactionDue(detail))}</dd>
            </div>
          </dl>
          <p className="dialog-hint">
            A sample record for exploring the interface. No business transaction
            is created.
          </p>
        </Dialog>
      )}
    </>
  );
}
