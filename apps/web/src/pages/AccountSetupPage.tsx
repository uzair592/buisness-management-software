import { useCallback, useEffect, useState, type FormEvent } from "react";
import { EmptyState, Panel, Table } from "@business/ui";
import { useAuth } from "../context/AuthContext";
import { usePreview } from "../preview/PreviewProvider";
import { TrySample } from "../components/PreviewActions";

type Account = { id: string; code: string; name: string; kind: string; version: number; expenseCategoryId: string | null };
type Choice = { id: string; name: string; kind?: string; isCustomer?: boolean; isSupplier?: boolean };
type Entry = { kind: "Money" | "Stock" | "Receivable" | "Payable"; referenceId: string;
  reference: string; locationId: string; amount: string; quantity: string };
const blankEntry = (): Entry => ({ kind: "Money", referenceId: "", reference: "", locationId: "", amount: "", quantity: "" });
type OpeningPreview = { expectedCursor: string; preview: { money: string; stock: string;
  receivable: string; payable: string; equity: string; documents: Array<{ reference: string }>; stockMovements: number } };

function OpeningChoice({ kind, value, onChange, role, businessId }: {
  kind: "items" | "parties"; value: string; onChange: (id: string) => void;
  role: Entry["kind"]; businessId: string;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Array<Choice>>([]);
  const [selected, setSelected] = useState<Choice | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void fetch(`/v1/catalogue/choices?kind=${kind}&role=${role}&q=${encodeURIComponent(query)}&page=${page}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Could not search choices."); return response.json() as Promise<{ rows: Choice[]; hasMore: boolean }>; })
      .then((data) => { setRows(data.rows); setHasMore(data.hasMore); if (value) {
        const current = data.rows.find((row) => row.id === value);
        if (current) setSelected(current);
      } })
      .catch((cause) => { if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message); });
    return () => controller.abort();
  }, [kind, role, query, page, businessId, value]);
  const options = selected && !rows.some((row) => row.id === selected.id) ? [selected, ...rows] : rows;
  return <div>
    <input className="input" type="search" aria-label={`Search ${kind}`} placeholder={`Search ${kind}`} value={query}
      onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
    <select className="input" required value={value} onChange={(event) => {
      onChange(event.target.value); setSelected(options.find((row) => row.id === event.target.value) ?? null);
    }}><option value="">Choose…</option>{options.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
    <div className="live-pagination"><button type="button" className="btn-ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {page}</span><button type="button" className="btn-ghost" disabled={!hasMore} onClick={() => setPage(page + 1)}>Next</button></div>
    {error && <span role="alert">{error}</span>}
  </div>;
}

export function AccountSetupPage() {
  const auth = useAuth();
  const { sample } = usePreview();
  const allowed = auth.activeMembership?.role === "Owner" || auth.activeMembership?.role === "Accountant";
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Choice[]>([]);
  const [locations, setLocations] = useState<Choice[]>([]);
  const [posted, setPosted] = useState<{ id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ code: "", name: "", kind: "Cash", expenseCategoryId: "" });
  const [categoryName, setCategoryName] = useState("");
  const [edit, setEdit] = useState<{ id: string; version: number; name: string } | null>(null);
  const [batchId, setBatchId] = useState(() => crypto.randomUUID());
  const [businessDate, setBusinessDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState<Entry[]>([blankEntry()]);
  const [preview, setPreview] = useState<OpeningPreview | null>(null);
  useEffect(() => {
    setPreview(null); setEntries([blankEntry()]); setBatchId(crypto.randomUUID());
    setAccounts([]); setCategories([]); setLocations([]); setPosted(null); setLoading(true);
  }, [auth.selectedBusinessId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    // Keep the form mounted during a same-business refresh. Unmounting it here
    // can discard entries a user types while an account setup request completes.
    setError("");
    try {
      const responses = await Promise.all([
        fetch("/v1/accounts/setup", { signal }), fetch("/v1/locations", { signal }),
        fetch("/v1/opening", { signal }),
      ]);
      if (responses.some((response) => !response.ok)) throw new Error("Could not load account setup. Check your access and connection.");
      const [setup, locationData, opening] = await Promise.all(responses.map((r) => r.json()));
      setAccounts(setup.accounts); setCategories(setup.expenseCategories);
      setLocations(locationData);
      setPosted(opening);
    } catch (cause) {
      if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message);
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [auth.selectedBusinessId]);
  useEffect(() => {
    if (!sample && auth.authenticated && auth.selectedBusinessId && allowed) {
      const controller = new AbortController(); void load(controller.signal);
      return () => controller.abort();
    }
    setLoading(false);
  }, [sample, auth.authenticated, auth.selectedBusinessId, allowed, load]);

  async function api(path: string, payload: object, method = "POST") {
    const response = await fetch(path, { method,
      headers: { "Content-Type": "application/json", "x-csrf-token": auth.csrfToken ?? "" },
      body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Save failed. Review your entries.");
    return data;
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Operation failed."); }
    finally { setBusy(false); }
  }
  async function createCategory(event: FormEvent) {
    event.preventDefault();
    await perform(async () => { await api("/v1/accounts/expense-categories", { name: categoryName.trim() }); setCategoryName(""); setNotice("Expense category saved."); });
  }
  async function createAccount(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      await api("/v1/accounts", { code: form.code.trim(), name: form.name.trim(), kind: form.kind,
        expenseCategoryId: form.kind === "Expense" ? form.expenseCategoryId || null : null });
      setForm({ code: "", name: "", kind: "Cash", expenseCategoryId: "" }); setNotice("Account saved. Its balance begins at zero until opening is posted.");
    });
  }
  async function changeAccount(account: Account, archive: boolean) {
    if (archive && !window.confirm(`Archive ${account.name}? Posted history stays intact.`)) return;
    await perform(async () => {
      await api(`/v1/accounts/${account.id}`, { name: edit?.id === account.id ? edit.name.trim() : account.name,
        expectedVersion: account.version, archive }, "PATCH");
      setEdit(null); setNotice(archive ? "Account archived." : "Account updated.");
    });
  }
  function updateEntry(index: number, change: Partial<Entry>) {
    setEntries((current) => current.map((row, at) => at === index ? { ...row, ...change } : row));
    setPreview(null);
  }
  function openingPayload() {
    return { batchId, businessDate, entries: entries.map((row) => {
      if (row.kind === "Money") return { kind: row.kind, accountId: row.referenceId, amount: row.amount };
      if (row.kind === "Stock") return { kind: row.kind, itemId: row.referenceId,
        locationId: row.locationId, quantity: row.quantity, value: row.amount };
      return { kind: row.kind, partyId: row.referenceId, reference: row.reference.trim(), amount: row.amount };
    }) };
  }
  async function requestPreview(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      const data = await api("/v1/opening/preview", openingPayload()) as OpeningPreview;
      setPreview(data); setNotice("Review the exact totals and confirm when ready.");
    });
  }
  async function commit() {
    if (!preview || !window.confirm("Post this opening batch? It creates permanent journal and stock history.")) return;
    await perform(async () => {
      await api("/v1/opening/commit", { ...openingPayload(), expectedCursor: preview.expectedCursor });
      setPreview(null); setNotice("Opening balances posted. Future corrections require a linked adjustment.");
    });
  }

  if (sample || !auth.authenticated || !auth.selectedBusinessId) return <>
    <div className="page-heading"><div><p className="eyebrow">ACCOUNT SETUP</p><h1>Cash & Bank</h1><p>Sign in to set up real accounts and opening balances.</p></div></div>
    <Panel><TrySample /></Panel>
  </>;
  if (!allowed) return <><div className="page-heading"><div><h1>Cash & Bank</h1></div></div>
    <Panel><p role="alert">Account books are available to owners and accountants.</p></Panel></>;
  return <div className="account-setup">
    <div className="page-heading"><div><p className="eyebrow">BUSINESS SETUP</p><h1>Accounts & opening</h1>
      <p>Create account books, then bring in your starting money, stock and party dues.</p></div></div>
    {error && <p className="live-error" role="alert">{error} <button className="btn-secondary" onClick={() => void load()}>Retry</button></p>}
    {notice && <p className="account-notice" role="status">{notice}</p>}
    {loading ? <Panel><p>Loading account setup…</p></Panel> : <>
      <Panel><div className="account-section-head"><div><h2>Cash, bank & expense accounts</h2><p>Balances are calculated from posted journal entries.</p></div></div>
        {accounts.filter((a) => ["Cash", "Bank", "Expense"].includes(a.kind)).length === 0 ?
          <EmptyState title="No accounts yet">Add a cash or bank account to begin.</EmptyState> :
          <Table headers={["Code", "Account", "Type", "Actions"]}>
            {accounts.filter((a) => ["Cash", "Bank", "Expense"].includes(a.kind)).map((a) => <tr key={a.id}>
              <td>{a.code}</td><td>{edit?.id === a.id ? <input className="input" aria-label={`Rename ${a.name}`} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /> : a.name}</td>
              <td>{a.kind}</td><td className="live-row-actions">{edit?.id === a.id ? <><button className="btn-secondary" disabled={busy || !edit.name.trim()} onClick={() => void changeAccount(a, false)}>Save</button><button className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button></> : <><button className="btn-ghost" onClick={() => setEdit({ id: a.id, version: a.version, name: a.name })}>Rename</button><button className="btn-ghost" disabled={busy} onClick={() => void changeAccount(a, true)}>Archive</button></>}</td>
            </tr>)}
          </Table>}
        <form className="account-inline-form" onSubmit={(event) => void createAccount(event)}>
          <label>Code<input className="input" required maxLength={50} pattern="[A-Za-z0-9_\-]+" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. TILL" /></label>
          <label>Name<input className="input" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Main till" /></label>
          <label>Type<select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option>Cash</option><option>Bank</option><option>Expense</option></select></label>
          {form.kind === "Expense" && <label>Expense category<select className="input" required value={form.expenseCategoryId} onChange={(e) => setForm({ ...form, expenseCategoryId: e.target.value })}><option value="">Choose category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          <button className="btn-primary" disabled={busy}>Add account</button>
        </form>
        <form className="account-inline-form" onSubmit={(event) => void createCategory(event)}><label>New expense category<input className="input" required maxLength={120} value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="e.g. Utilities" /></label><button className="btn-secondary" disabled={busy}>Add category</button></form>
      </Panel>
      <Panel><div className="account-section-head"><div><h2>Opening balances</h2><p>One opening batch per business. Preview exact totals before posting.</p></div><span className="account-state">{posted ? "Posted" : "Not posted"}</span></div>
        {!(["OPEN_INVENTORY", "OPEN_RECEIVABLE", "OPEN_PAYABLE", "OPEN_EQUITY", "SALE_REVENUE", "SALE_TAX", "SALE_COGS"].every((code) => accounts.some((a) => a.code === code))) &&
          <div className="account-system-prompt"><p>Initialize the inventory, dues, equity and sales ledger accounts before billing.</p><button className="btn-secondary" disabled={busy} onClick={() => void perform(async () => { await api("/v1/accounts/system", {}); setNotice("Posting accounts initialized."); })}>Initialize posting accounts</button></div>}
        {posted ? <p role="status">Opening batch recorded. Its journal, stock and party documents are preserved. Batch ID: <code>{posted.id}</code></p> : <>
          <form onSubmit={(event) => void requestPreview(event)} className="account-opening-form">
            <label>Opening date<input className="input" type="date" required value={businessDate} onChange={(e) => { setBusinessDate(e.target.value); setPreview(null); }} /></label>
            {entries.map((row, index) => { const choices = accounts.filter((a) => ["Cash", "Bank"].includes(a.kind));
              return <div className="account-opening-row" key={index}>
                <label>Type<select className="input" value={row.kind} onChange={(e) => updateEntry(index, { kind: e.target.value as Entry["kind"], referenceId: "" })}><option value="Money">Cash / bank</option><option value="Stock">Stock</option><option value="Receivable">Customer owes us</option><option value="Payable">We owe supplier</option></select></label>
                <label>{row.kind === "Money" ? "Account" : row.kind === "Stock" ? "Item" : "Party"}{row.kind === "Money" ?
                  <select className="input" required value={row.referenceId} onChange={(e) => updateEntry(index, { referenceId: e.target.value })}><option value="">Choose…</option>{choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select> :
                  <OpeningChoice key={`${index}-${row.kind}-${auth.selectedBusinessId}`} kind={row.kind === "Stock" ? "items" : "parties"} role={row.kind}
                    businessId={auth.selectedBusinessId ?? ""} value={row.referenceId} onChange={(id) => updateEntry(index, { referenceId: id })} />}</label>
                {row.kind === "Stock" && <><label>Location<select className="input" required value={row.locationId} onChange={(e) => updateEntry(index, { locationId: e.target.value })}><option value="">Choose…</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label><label>Quantity<input className="input" inputMode="decimal" required pattern="[0-9]+([.][0-9]{1,6})?" value={row.quantity} onChange={(e) => updateEntry(index, { quantity: e.target.value })} /></label></>}
                {(row.kind === "Receivable" || row.kind === "Payable") && <label>Old document reference<input className="input" required maxLength={120} value={row.reference} onChange={(e) => updateEntry(index, { reference: e.target.value })} /></label>}
                <label>{row.kind === "Stock" ? "Stock value" : "Amount"}<input className="input" required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={row.amount} onChange={(e) => updateEntry(index, { amount: e.target.value })} /></label>
                <button type="button" className="btn-ghost" disabled={entries.length === 1} onClick={() => { setEntries(entries.filter((_, at) => at !== index)); setPreview(null); }}>Remove</button>
              </div>; })}
            <div className="account-opening-actions"><button type="button" className="btn-secondary" onClick={() => { setEntries([...entries, blankEntry()]); setPreview(null); }}>Add line</button><button className="btn-primary" disabled={busy}>Preview opening</button></div>
          </form>
          {preview && <div className="account-preview"><h3>Review before posting</h3><div className="account-totals">{(["money", "stock", "receivable", "payable", "equity"] as const).map((key) => <div key={key}><span>{key}</span><strong>{preview.preview[key]}</strong></div>)}</div>
            <p>{preview.preview.stockMovements} stock movements · {preview.preview.documents.length} traceable party documents</p>
            <button className="btn-primary" disabled={busy} onClick={() => void commit()}>Post opening batch</button></div>}
        </>}
      </Panel>
    </>}
  </div>;
}
