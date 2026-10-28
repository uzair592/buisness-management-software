import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Panel, Table, EmptyState } from "@business/ui";
import { useAuth } from "../context/AuthContext";

type Summary = {
  id: string;
  number: string | null;
  supplierInvoiceNumber: string;
  status: "Draft" | "Posted";
  total: string | null;
  paid: string | null;
  due: string | null;
  businessDate: string;
  party: { name: string } | null;
};

type Snapshot = {
  number: string;
  partyName: string;
  supplierInvoiceNumber: string;
  duplicateReferenceReviewed?: boolean;
  calculation: { base: string; tax: string; total: string };
  payment: { total: string; paid: string; due: string; payments: Array<{ id: string; kind: string; applied: string; reference: string | null }> };
  lines: Array<{
    name: string;
    quantity: string;
    unitCost: string;
    unitName?: string;
    calculated: { tax: string; total: string };
  }>;
};

type Purchase = Summary & {
  snapshot: Snapshot;
  payments: Array<{ id: string; kind: string; applied: string; reference: string | null }>;
};

export function LivePurchasesPage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<Summary[]>([]);
  const [detail, setDetail] = useState<Purchase | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const status = params.get("status") ?? "";
  const open = params.get("open");

  const update = (changes: Record<string, string>) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/v1/purchases/documents?q=${encodeURIComponent(q)}&page=${page}${status ? `&status=${status}` : ""}`,
          { signal },
        );
        if (!response.ok) throw new Error("Could not load purchases.");
        const data = (await response.json()) as { rows: Summary[]; hasMore: boolean };
        setRows(data.rows);
        setHasMore(data.hasMore);
      } catch (cause) {
        if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [q, page, status, auth.selectedBusinessId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!open) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    void fetch(`/v1/purchases/documents/${open}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Could not open this purchase bill.");
        return response.json() as Promise<Purchase>;
      })
      .then(setDetail)
      .catch((cause) => {
        if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message);
      });
    return () => controller.abort();
  }, [open, auth.selectedBusinessId]);

  return (
    <div className="live-purchases-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PURCHASES</p>
          <h1>Purchases & Inward Bills</h1>
          <p>Recorded purchase bills, stock receipts and supplier dues.</p>
        </div>
        <Link className="btn-primary" to="/purchases/new">
          New purchase
        </Link>
      </div>

      {error && (
        <p role="alert" className="live-error">
          {error} <button className="btn-ghost" onClick={() => void load()}>Retry</button>
        </p>
      )}

      <Panel>
        <div className="table-toolbar">
          <label className="search-field">
            <span className="sr-only">Search purchase number, supplier or invoice ref</span>
            <input
              className="input"
              type="search"
              value={q}
              placeholder="Search bill, ref or supplier"
              onChange={(event) => update({ q: event.target.value, page: "" })}
            />
          </label>
          <select
            className="input"
            aria-label="Purchase status"
            value={status}
            onChange={(event) => update({ status: event.target.value, page: "" })}
          >
            <option value="">All statuses</option>
            <option>Posted</option>
            <option>Draft</option>
          </select>
        </div>

        {loading ? (
          <p>Loading purchases…</p>
        ) : !rows.length ? (
          <EmptyState title="No matching purchases">
            Record your first purchase bill to receive inventory and track supplier dues.
          </EmptyState>
        ) : (
          <Table headers={["Number", "Supplier Reference", "Supplier", "Date", "Status", "Total", ""]}>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <b>{row.number ?? "Draft"}</b>
                  <small className="cell-subtitle">
                    {row.status} · {row.status === "Posted" ? "Stock updated" : "Unposted draft"}
                  </small>
                </td>
                <td>
                  <span className="mono-code">{row.supplierInvoiceNumber}</span>
                </td>
                <td>{row.party?.name ?? "Unknown Supplier"}</td>
                <td>{row.businessDate.slice(0, 10)}</td>
                <td>
                  {row.status === "Draft"
                    ? "Pending"
                    : Number(row.due) === 0
                    ? "Paid in full"
                    : `Payable: ${Number(row.due).toFixed(2)}`}
                </td>
                <td className="amount">{row.total ? Number(row.total).toFixed(2) : "—"}</td>
                <td>
                  {row.status === "Draft" ? (
                    <Link className="btn-ghost" to={`/purchases/new?draft=${row.id}`}>
                      Resume
                    </Link>
                  ) : (
                    <button className="btn-ghost" onClick={() => update({ open: row.id })}>
                      Open
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}

        <div className="live-pagination">
          <button
            className="btn-secondary"
            disabled={page <= 1}
            onClick={() => update({ page: String(page - 1) })}
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button
            className="btn-secondary"
            disabled={!hasMore}
            onClick={() => update({ page: String(page + 1) })}
          >
            Next
          </button>
        </div>
      </Panel>

      {detail && (
        <div className="purchase-print">
          <Panel>
            <div className="section-heading">
              <div>
                <h2>{detail.number ?? "Saved draft"}</h2>
                <p>
                  Supplier: <b>{detail.snapshot?.partyName ?? detail.party?.name}</b> · Ref:{" "}
                  <span className="mono-code">{detail.supplierInvoiceNumber}</span>
                  {detail.snapshot?.duplicateReferenceReviewed && (
                    <span className="badge badge-warning" style={{ marginLeft: "0.5rem" }}>
                      Reviewed repeat reference
                    </span>
                  )}
                </p>
              </div>
              <button
                className="btn-secondary print-hide"
                disabled={detail.status !== "Posted"}
                onClick={() => window.print()}
              >
                Print purchase bill
              </button>
            </div>

            <p>Date: {detail.businessDate.slice(0, 10)}</p>

            {detail.status === "Posted" ? (
              <>
                <Table headers={["Item", "Quantity", "Unit Cost", "Tax", "Total"]}>
                  {detail.snapshot.lines.map((line, index) => (
                    <tr key={index}>
                      <td>
                        {line.name} {line.unitName ? `(${line.unitName})` : ""}
                      </td>
                      <td>{line.quantity}</td>
                      <td>{line.unitCost}</td>
                      <td>{line.calculated.tax}</td>
                      <td>{line.calculated.total}</td>
                    </tr>
                  ))}
                </Table>
                <div style={{ marginTop: "1rem" }}>
                  <p>
                    <b>Total Bill: {detail.snapshot.calculation.total}</b>
                  </p>
                  <p>
                    Paid: {Number(detail.paid ?? 0).toFixed(2)} · <b>Remaining Payable: {Number(detail.due ?? 0).toFixed(2)}</b>
                  </p>
                  {detail.payments.map((payment) => (
                    <p key={payment.id} className="text-muted">
                      Payment via {payment.kind}: {payment.applied}
                      {payment.reference ? ` (Ref: ${payment.reference})` : ""}
                    </p>
                  ))}
                </div>
              </>
            ) : (
              <p>This draft has not been posted or numbered.</p>
            )}

            <button className="btn-ghost print-hide" style={{ marginTop: "1rem" }} onClick={() => update({ open: "" })}>
              Close
            </button>
          </Panel>
        </div>
      )}
    </div>
  );
}
