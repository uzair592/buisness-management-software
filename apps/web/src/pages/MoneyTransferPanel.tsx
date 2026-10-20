import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Panel, Table } from "@business/ui";

type Account = { id: string; name: string; kind: string };
type Transfer = { id: string; commandId: string; sourceAccountId: string; destinationAccountId: string;
  amount: string; reference: string; businessDate: string };
type Book = { account: Account; balance: string; page: number; hasMore: boolean;
  rows: Array<{ id: string; businessDate: string; postingKind: string; debit: string; credit: string;
    transfer: { reference: string; sourceAccount: { name: string }; destinationAccount: { name: string } } | null }> };
const blank = (): Transfer => ({ id: crypto.randomUUID(), commandId: crypto.randomUUID(),
  sourceAccountId: "", destinationAccountId: "", amount: "", reference: "", businessDate: new Date().toISOString().slice(0, 10) });

export function MoneyTransferPanel({ accounts, businessId, csrfToken }: {
  accounts: Account[]; businessId: string; csrfToken: string | null;
}) {
  const choices = accounts.filter((account) => account.kind === "Cash" || account.kind === "Bank");
  const storageKey = `bms_transfer_intent_${businessId}`;
  const [form, setForm] = useState<Transfer>(blank);
  const [bookId, setBookId] = useState("");
  const [book, setBook] = useState<Book | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    try { const pending = sessionStorage.getItem(storageKey); setForm(pending ? JSON.parse(pending) as Transfer : blank()); setUncertain(!!pending); }
    catch { setForm(blank()); }
    setBookId(""); setBook(null); setPage(1); setError(""); setNotice("");
  }, [storageKey]);
  const loadBook = useCallback(async (id: string, nextPage: number, signal?: AbortSignal) => {
    if (!id) { setBook(null); return; }
    try {
      const response = await fetch(`/v1/accounts/books/${id}?page=${nextPage}`, { signal });
      if (!response.ok) throw new Error("Could not load account book. Check your connection and access.");
      setBook(await response.json() as Book); setError("");
    } catch (cause) {
      if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController(); void loadBook(bookId, page, controller.signal);
    return () => controller.abort();
  }, [bookId, page, loadBook, businessId]);
  function update(change: Partial<Transfer>) {
    if (uncertain) return;
    sessionStorage.removeItem(storageKey);
    setForm((current) => ({ ...current, ...change, id: crypto.randomUUID(), commandId: crypto.randomUUID() }));
    setNotice("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    sessionStorage.setItem(storageKey, JSON.stringify(form));
    try {
      const response = await fetch("/v1/accounts/transfers", { method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken ?? "" }, body: JSON.stringify(form) });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        if (response.status === 400 || response.status === 403) {
          sessionStorage.removeItem(storageKey); setUncertain(false);
        } else setUncertain(true);
        throw new Error(result.error ?? "Could not post transfer");
      }
      sessionStorage.removeItem(storageKey);
      setUncertain(false); setForm(blank()); setNotice("Transfer posted. Both account books now include it.");
      setPage(1); await loadBook(bookId, 1);
    } catch (cause) { if (sessionStorage.getItem(storageKey)) setUncertain(true);
      setError(`${cause instanceof Error ? cause.message : "Transfer failed"}. ${sessionStorage.getItem(storageKey) ? "Retry this same request to check whether it posted." : "Correct the form and try again."}`); }
    finally { setBusy(false); }
  }
  return <Panel>
    <div className="account-section-head"><div><h2>Transfers & account books</h2>
      <p>Move money between cash and bank accounts. Transfers do not record income or expense.</p></div></div>
    {error && <p className="live-error" role="alert">{error}</p>}
    {notice && <p className="account-notice" role="status">{notice}</p>}
    <form className="account-inline-form" onSubmit={(event) => void submit(event)}>
      <label>From<select className="input" required disabled={uncertain} value={form.sourceAccountId} onChange={(event) => update({ sourceAccountId: event.target.value })}>
        <option value="">Choose…</option>{choices.map((account) => <option key={account.id} value={account.id}>{account.name} ({account.kind})</option>)}</select></label>
      <label>To<select className="input" required disabled={uncertain} value={form.destinationAccountId} onChange={(event) => update({ destinationAccountId: event.target.value })}>
        <option value="">Choose…</option>{choices.filter((account) => account.id !== form.sourceAccountId).map((account) => <option key={account.id} value={account.id}>{account.name} ({account.kind})</option>)}</select></label>
      <label>Amount<input className="input" required disabled={uncertain} inputMode="decimal" pattern="(?!0+([.]0+)?$)[0-9]+([.][0-9]{1,2})?" value={form.amount} onChange={(event) => update({ amount: event.target.value })} /></label>
      <label>Reference<input className="input" required disabled={uncertain} maxLength={120} value={form.reference} onChange={(event) => update({ reference: event.target.value })} /></label>
      <label>Date<input className="input" type="date" required disabled={uncertain} value={form.businessDate} onChange={(event) => update({ businessDate: event.target.value })} /></label>
      <button className="btn-primary" disabled={busy || choices.length < 2 || !navigator.onLine}>{uncertain ? "Retry saved transfer" : "Post transfer"}</button>
    </form>
    {uncertain && <button className="btn-ghost" disabled={busy} onClick={() => {
      if (window.confirm("Check both account books first. The saved transfer may already have posted. Start a different transfer?")) {
        sessionStorage.removeItem(storageKey); setForm(blank()); setUncertain(false); setError("");
      }
    }}>Start a different transfer</button>}
    {choices.length < 2 && <p>Add two active cash or bank accounts to transfer money.</p>}
    <div className="account-inline-form"><label>Account book<select className="input" value={bookId} onChange={(event) => { setBookId(event.target.value); setPage(1); }}>
      <option value="">Choose account…</option>{choices.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></div>
    {book && <><p role="status">{book.account.name} · balance {book.balance}</p>
      <Table headers={["Date", "Source", "In", "Out"]}>{book.rows.map((row) => <tr key={row.id}>
        <td>{row.businessDate.slice(0, 10)}</td><td>{row.transfer ? `${row.transfer.reference} · ${row.transfer.sourceAccount.name} → ${row.transfer.destinationAccount.name}` : row.postingKind}</td>
        <td>{row.debit}</td><td>{row.credit}</td></tr>)}</Table>
      {book.rows.length === 0 && <p>No posted movements in this account.</p>}
      <div className="live-pagination"><button className="btn-secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page}</span><button className="btn-secondary" disabled={!book.hasMore} onClick={() => setPage(page + 1)}>Next</button></div></>}
  </Panel>;
}
