import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Panel, Table, EmptyState } from "@business/ui";
import { useAuth } from "../context/AuthContext";

type Summary = { id: string; number: string | null; status: "Draft" | "Posted"; total: string | null;
  paid: string | null; due: string | null; businessDate: string; party: { name: string } | null };
type Snapshot = { number: string; partyName: string; calculation: { base: string; tax: string; total: string };
  payment: { change: string; receivable: string }; lines: Array<{ name: string; quantity: string;
    unitPrice: string; calculated: { tax: string; total: string } }> };
type Sale = Summary & { snapshot: Snapshot; payments: Array<{ id: string; kind: string; applied: string; reference: string | null }> };
export function LiveSalesPage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<Summary[]>([]);
  const [detail, setDetail] = useState<Sale | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const status = params.get("status") ?? "";
  const open = params.get("open");
  const update = (changes: Record<string, string>) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    return next;
  });
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/v1/sales/documents?q=${encodeURIComponent(q)}&page=${page}${status ? `&status=${status}` : ""}`, { signal });
      if (!response.ok) throw new Error("Could not load sales.");
      const data = await response.json() as { rows: Summary[]; hasMore: boolean };
      setRows(data.rows); setHasMore(data.hasMore);
    } catch (cause) { if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [q, page, status, auth.selectedBusinessId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    if (!open) { setDetail(null); return; }
    const controller = new AbortController();
    void fetch(`/v1/sales/documents/${open}`, { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error("Could not open this sale."); return response.json() as Promise<Sale>;
    }).then(setDetail).catch((cause) => { if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message); });
    return () => controller.abort();
  }, [open, auth.selectedBusinessId]);
  return <div className="live-sales-page"><div className="page-heading"><div><p className="eyebrow">SALES</p><h1>Sales</h1>
    <p>Saved invoices from this business. Open a sale to review and print its snapshot.</p></div><Link className="btn-primary" to="/sales/new">New sale</Link></div>
    {error && <p role="alert" className="live-error">{error} <button className="btn-ghost" onClick={() => void load()}>Retry</button></p>}
    <Panel><div className="table-toolbar"><label className="search-field"><span className="sr-only">Search sale number or customer</span>
      <input className="input" type="search" value={q} placeholder="Search number or customer" onChange={(event) => update({ q: event.target.value, page: "" })} /></label>
      <select className="input" aria-label="Sale status" value={status} onChange={(event) => update({ status: event.target.value, page: "" })}>
        <option value="">All statuses</option><option>Posted</option><option>Draft</option></select></div>
      {loading ? <p>Loading sales…</p> : !rows.length ? <EmptyState title="No matching sales">Create your first sale or change the filters.</EmptyState> :
        <Table headers={["Number", "Customer", "Date", "Payment", "Total", ""]}>{rows.map((row) => <tr key={row.id}>
          <td><b>{row.number ?? "Draft"}</b><small className="cell-subtitle">{row.status} · {row.status === "Posted" ? "Cloud saved" : "Not issued"}</small></td>
          <td>{row.party?.name ?? "Walk-in"}</td><td>{row.businessDate.slice(0, 10)}</td>
          <td>{row.status === "Draft" ? "Pending" : row.due === "0" || row.due === "0.00" ? "Paid" : "Part credit"}</td>
          <td className="amount">{row.total ?? "—"}</td><td><button className="btn-ghost" onClick={() => update({ open: row.id })}>Open</button></td>
        </tr>)}</Table>}
      <div className="live-pagination"><button className="btn-secondary" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>Previous</button>
        <span>Page {page}</span><button className="btn-secondary" disabled={!hasMore} onClick={() => update({ page: String(page + 1) })}>Next</button></div>
    </Panel>
    {detail && <div className="sale-print"><Panel><div className="section-heading"><h2>{detail.number ?? "Saved draft"}</h2>
      <button className="btn-secondary print-hide" disabled={detail.status !== "Posted"} onClick={() => window.print()}>Print saved receipt</button></div>
      <p>{detail.snapshot.partyName ?? detail.party?.name ?? "Walk-in"} · {detail.businessDate.slice(0, 10)}</p>
      {detail.status === "Posted" ? <><Table headers={["Item", "Qty", "Price", "Tax", "Total"]}>
        {detail.snapshot.lines.map((line, index) => <tr key={index}><td>{line.name}</td><td>{line.quantity}</td>
          <td>{line.unitPrice}</td><td>{line.calculated.tax}</td><td>{line.calculated.total}</td></tr>)}</Table>
        <p><b>Total: {detail.snapshot.calculation.total}</b> · Paid: {detail.paid} · Due: {detail.due}</p>
        <p>Cash change: {detail.snapshot.payment.change}</p>
        {detail.payments.map((payment) => <p key={payment.id}>{payment.kind}: {payment.applied}{payment.reference ? ` · Reference ${payment.reference}` : ""}</p>)}</> :
        <p>This draft has not been issued or numbered.</p>}
      <button className="btn-ghost print-hide" onClick={() => update({ open: "" })}>Close</button></Panel></div>}
  </div>;
}
