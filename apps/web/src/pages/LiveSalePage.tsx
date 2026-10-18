import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { allocatePayment, calculateDocument } from "@business/domain";
import { Panel } from "@business/ui";
import { useAuth } from "../context/AuthContext";

type Item = { id: string; name: string; kind: "Goods" | "Service"; barcode: string | null;
  salePrice: string; baseUnitId: string | null; taxProfileId: string | null };
type Unit = { id: string; name: string };
type Conversion = { id: string; itemId: string; unitId: string; factor: string };
type Account = { id: string; name: string; kind: "Cash" | "Bank" };
type Device = { id: string; locationId: string; deviceName: string; numberPrefix: string };
type Workspace = { items: Item[]; units: Unit[]; conversions: Conversion[]; accounts: Account[];
  devices: Device[]; parties: Array<{ id: string; name: string }>;
  taxProfiles: Array<{ id: string; rate: string; mode: "Inclusive" | "Exclusive" }> };
type CartLine = { id: string; itemId: string; conversionId: string | null; taxProfileId: string | null;
  quantity: string; unitPrice: string; discount: string };
type SalePayload = { id: string; commandId: string; deviceEnrollmentId: string; locationId: string;
  partyId: string | null; businessDate: string; documentDiscount: string; lines: CartLine[];
  payments: Array<{ id: string; accountId: string; kind: "Cash" | "Bank"; applied: string;
    tendered: string | null; reference: string | null }> };
type SavedSale = { id: string; number: string; total: string; paid: string; due: string; snapshot: unknown };
const money = /^\d+(?:\.\d{1,2})?$/;

export function LiveSalePage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [partyId, setPartyId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [documentDiscount, setDocumentDiscount] = useState("0");
  const [cashAccount, setCashAccount] = useState("");
  const [cashApplied, setCashApplied] = useState("0");
  const [cashTendered, setCashTendered] = useState("0");
  const [bankAccount, setBankAccount] = useState("");
  const [bankApplied, setBankApplied] = useState("0");
  const [bankReference, setBankReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<SalePayload | null>(null);
  const [issued, setIssued] = useState<SavedSale | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/v1/sales/workspace", { signal });
      if (!response.ok) throw new Error("Could not load billing workspace. Check your access and connection.");
      const data = await response.json() as Workspace;
      setWorkspace(data);
      setDeviceId((current) => current || data.devices[0]?.id || "");
    } catch (cause) { if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [auth.selectedBusinessId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    const draftId = params.get("draft");
    if (!draftId || busy) return;
    const controller = new AbortController();
    void fetch(`/v1/sales/documents/${encodeURIComponent(draftId)}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Saved draft could not be reopened.");
        return response.json() as Promise<{ status: string; snapshot: SalePayload; number: string | null;
          total: string | null; paid: string | null; due: string | null }>;
      }).then((sale) => {
        if (sale.status === "Posted") {
          setIssued({ id: draftId, number: sale.number ?? "", total: sale.total ?? "0",
            paid: sale.paid ?? "0", due: sale.due ?? "0", snapshot: sale.snapshot });
          return;
        }
        const saved = sale.snapshot;
        setPending(saved); setCart(saved.lines); setDeviceId(saved.deviceEnrollmentId);
        setPartyId(saved.partyId ?? ""); setDocumentDiscount(saved.documentDiscount);
        const cash = saved.payments.find((row) => row.kind === "Cash");
        const bank = saved.payments.find((row) => row.kind === "Bank");
        setCashAccount(cash?.accountId ?? ""); setCashApplied(cash?.applied ?? "0"); setCashTendered(cash?.tendered ?? "0");
        setBankAccount(bank?.accountId ?? ""); setBankApplied(bank?.applied ?? "0"); setBankReference(bank?.reference ?? "");
      }).catch((cause) => { if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message); });
    return () => controller.abort();
  }, [params, busy, auth.selectedBusinessId]);
  const selectedDevice = workspace?.devices.find((device) => device.id === deviceId);
  const calculation = useMemo(() => {
    if (!workspace || !cart.length) return null;
    try {
      return calculateDocument({ documentDiscount, lines: cart.map((line) => {
        const conversion = workspace.conversions.find((row) => row.id === line.conversionId);
        const tax = workspace.taxProfiles.find((row) => row.id === line.taxProfileId);
        return { id: line.id, quantity: line.quantity, conversion: conversion?.factor ?? "1",
          conversionVersion: 1, unitPrice: line.unitPrice,
          lineDiscount: { kind: "amount" as const, value: line.discount },
          tax: { mode: (tax?.mode.toLowerCase() ?? "exclusive") as "exclusive" | "inclusive", percent: tax?.rate ?? "0" } };
      }) });
    } catch { return null; }
  }, [workspace, cart, documentDiscount]);
  const payment = useMemo(() => {
    if (!calculation) return null;
    try { return allocatePayment({ total: calculation.total, cashApplied, bankApplied, cashTendered }); }
    catch { return null; }
  }, [calculation, cashApplied, bankApplied, cashTendered]);
  const locked = busy || !!pending || !!issued;
  const matches = workspace?.items.filter((item) => `${item.name} ${item.barcode ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 12) ?? [];
  function add(item: Item) {
    setCart((current) => [...current, { id: crypto.randomUUID(), itemId: item.id, conversionId: null,
      taxProfileId: item.taxProfileId, quantity: "1", unitPrice: item.salePrice, discount: "0" }]);
    setQuery("");
  }
  function edit(id: string, patch: Partial<CartLine>) { setCart((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line)); }
  async function issue() {
    if (!workspace || !selectedDevice || !calculation || !payment || !cart.length) return;
    if (payment.receivable !== "0.00" && !partyId) { setError("Choose a customer for the remaining credit."); return; }
    if (cashApplied !== "0" && cashApplied !== "0.00" && !cashAccount ||
        bankApplied !== "0" && bankApplied !== "0.00" && (!bankAccount || !bankReference.trim())) {
      setError("Choose payment accounts and enter a bank reference."); return;
    }
    const payload: SalePayload = pending ?? { id: crypto.randomUUID(), commandId: crypto.randomUUID(),
      deviceEnrollmentId: selectedDevice.id, locationId: selectedDevice.locationId,
      partyId: partyId || null, businessDate: new Date().toISOString().slice(0, 10), documentDiscount,
      lines: cart, payments: [
        ...(cashApplied !== "0" && cashApplied !== "0.00" ? [{ id: crypto.randomUUID(), accountId: cashAccount,
          kind: "Cash" as const, applied: cashApplied, tendered: cashTendered, reference: null }] : []),
        ...(bankApplied !== "0" && bankApplied !== "0.00" ? [{ id: crypto.randomUUID(), accountId: bankAccount,
          kind: "Bank" as const, applied: bankApplied, tendered: null, reference: bankReference.trim() }] : []),
      ] };
    setPending(payload); setBusy(true); setError("");
    setParams({ draft: payload.id }, { replace: true });
    try {
      const draft = await fetch("/v1/sales/drafts", { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": auth.csrfToken ?? "" }, body: JSON.stringify(payload) });
      if (!draft.ok) throw new Error((await draft.json() as { error?: string }).error ?? "Could not save the draft.");
      const response = await fetch(`/v1/sales/${payload.id}/post`, { method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": auth.csrfToken ?? "" },
        body: JSON.stringify({ commandId: payload.commandId }) });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Could not issue sale.");
      setIssued(await response.json() as SavedSale);
    } catch (cause) { setError(`${cause instanceof Error ? cause.message : "Could not issue sale."} The saved attempt keeps its IDs; retry after checking your connection.`); }
    finally { setBusy(false); }
  }
  function reset() {
    setCart([]); setPartyId(""); setDocumentDiscount("0"); setCashApplied("0"); setCashTendered("0");
    setBankApplied("0"); setBankReference(""); setPending(null); setIssued(null); setError("");
    setParams({}, { replace: true });
  }
  return <div className="live-billing">
    <div className="page-heading sale-heading"><div><p className="eyebrow"><Link to="/sales">SALES</Link> / NEW SALE</p>
      <h1>New sale</h1><p>Search, review the cart and issue a saved invoice.</p></div>
      {issued && <button className="btn-secondary" onClick={reset}>New sale</button>}</div>
    {error && <p role="alert" className="live-error">{error} <button className="btn-ghost" onClick={() => void load()}>Refresh catalogue</button></p>}
    {loading ? <Panel>Loading billing workspace…</Panel> : !workspace ? <Panel>Billing is unavailable.</Panel> :
      <div className="live-billing-grid"><div className="live-billing-main">
        <Panel><div className="live-billing-top">
          <label>Device<select className="input" value={deviceId} disabled={locked} onChange={(event) => setDeviceId(event.target.value)}><option value="">Choose device</option>{workspace.devices.map((device) => <option key={device.id} value={device.id}>{device.deviceName} · {device.numberPrefix}</option>)}</select></label>
          <label>Customer<select className="input" value={partyId} disabled={locked} onChange={(event) => setPartyId(event.target.value)}><option value="">Walk-in customer</option>{workspace.parties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}</select></label>
        </div></Panel>
        <Panel className="live-billing-cart"><div className="section-heading"><h2>Items in this bill</h2><span>{cart.length} lines</span></div>
          <label>Search item or barcode<input className="input" type="search" value={query} disabled={locked} onChange={(event) => setQuery(event.target.value)} placeholder="Type name or scan barcode" /></label>
          {query && <div className="live-billing-results">{matches.map((item) => <button type="button" key={item.id} disabled={locked} onClick={() => add(item)}><span>{item.name}</span><strong>{item.salePrice}</strong></button>)}{!matches.length && <p>No matching item.</p>}</div>}
          {!cart.length ? <p className="muted">Your cart is empty. Search above to add an item.</p> :
            <div className="live-billing-lines">{cart.map((line, index) => {
              const item = workspace.items.find((row) => row.id === line.itemId)!;
              const conversions = workspace.conversions.filter((row) => row.itemId === item.id);
              return <div className="live-billing-line" key={line.id}><div className="live-billing-line-name"><b>{item.name}</b><span>{calculation?.lines[index]?.total ?? "—"}</span></div>
                <div className="live-billing-line-fields"><label>Qty<input className="input" inputMode="decimal" value={line.quantity} disabled={locked} onChange={(event) => edit(line.id, { quantity: event.target.value })} /></label>
                  <label>Unit<select className="input" value={line.conversionId ?? ""} disabled={locked} onChange={(event) => edit(line.id, { conversionId: event.target.value || null })}><option value="">{workspace.units.find((unit) => unit.id === item.baseUnitId)?.name ?? "Each"}</option>{conversions.map((row) => <option key={row.id} value={row.id}>{workspace.units.find((unit) => unit.id === row.unitId)?.name ?? "Alternate"}</option>)}</select></label>
                  <label>Price<input className="input" inputMode="decimal" value={line.unitPrice} disabled={locked} onChange={(event) => edit(line.id, { unitPrice: event.target.value })} /></label>
                  <label>Discount<input className="input" inputMode="decimal" value={line.discount} disabled={locked} onChange={(event) => edit(line.id, { discount: event.target.value })} /></label>
                  <label>Tax<select className="input" value={line.taxProfileId ?? ""} disabled={locked} onChange={(event) => edit(line.id, { taxProfileId: event.target.value || null })}><option value="">No tax</option>{workspace.taxProfiles.map((tax) => <option key={tax.id} value={tax.id}>{tax.rate}% {tax.mode}</option>)}</select></label>
                  <button className="btn-ghost" disabled={locked} onClick={() => setCart(cart.filter((row) => row.id !== line.id))}>Remove</button></div>
              </div>;
            })}</div>}
        </Panel>
      </div><Panel className="live-billing-summary"><h2>Payment & total</h2>
        <div className="live-billing-totals"><span>Subtotal</span><b>{calculation?.base ?? "0.00"}</b><span>Tax</span><b>{calculation?.tax ?? "0.00"}</b></div>
        <label>Bill discount<input className="input" inputMode="decimal" value={documentDiscount} disabled={locked} onChange={(event) => setDocumentDiscount(event.target.value)} /></label>
        <div className="live-billing-grand"><span>Total · PKR</span><strong>{calculation?.total ?? "—"}</strong></div>
        <label>Cash applied<input className="input" inputMode="decimal" value={cashApplied} disabled={locked} onChange={(event) => setCashApplied(event.target.value)} /></label>
        <label>Cash tendered<input className="input" inputMode="decimal" value={cashTendered} disabled={locked} onChange={(event) => setCashTendered(event.target.value)} /></label>
        {cashApplied !== "0" && cashApplied !== "0.00" && <label>Cash account<select className="input" value={cashAccount} disabled={locked} onChange={(event) => setCashAccount(event.target.value)}><option value="">Choose till</option>{workspace.accounts.filter((a) => a.kind === "Cash").map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>}
        <label>Bank applied<input className="input" inputMode="decimal" value={bankApplied} disabled={locked} onChange={(event) => setBankApplied(event.target.value)} /></label>
        {bankApplied !== "0" && bankApplied !== "0.00" && <><label>Bank account<select className="input" value={bankAccount} disabled={locked} onChange={(event) => setBankAccount(event.target.value)}><option value="">Choose bank</option>{workspace.accounts.filter((a) => a.kind === "Bank").map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
          <label>Manual bank reference<input className="input" value={bankReference} disabled={locked} onChange={(event) => setBankReference(event.target.value)} /></label></>}
        <div className="live-billing-totals"><span>Change</span><b>{payment?.change ?? "—"}</b><span>Remaining due</span><b>{payment?.receivable ?? "—"}</b></div>
        {!calculation && cart.length > 0 && <p className="live-error">Check quantity, price and discounts.</p>}
        {issued ? <div role="status"><b>Saved: {issued.number}</b><p>Total {issued.total} · Paid {issued.paid} · Due {issued.due}</p>
          <Link className="btn-primary" to={`/sales?open=${issued.id}`}>Open receipt</Link></div> :
          <button className="btn-primary" disabled={busy || !calculation || !payment || !selectedDevice || !cart.length || !money.test(cashApplied) || !money.test(bankApplied)} onClick={() => void issue()}>{busy ? "Saving…" : pending ? "Retry saved sale" : "Save & issue sale"}</button>}
        <p className="muted">Bank references are recorded manually. Only a saved invoice receives a number.</p>
      </Panel></div>}
  </div>;
}
