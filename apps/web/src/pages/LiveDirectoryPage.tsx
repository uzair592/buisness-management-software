import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Dialog, EmptyState, Panel, Table } from "@business/ui";
import { useAuth } from "../context/AuthContext";

type Kind = "items" | "parties";
type Item = { id: string; name: string; kind: "Goods" | "Service"; sku: string | null;
  barcode: string | null; salePrice: string; categoryId: string | null;
  baseUnitId: string | null; taxProfileId: string | null; version: number };
type Party = { id: string; name: string; isCustomer: boolean; isSupplier: boolean;
  phone: string | null; email: string | null; version: number };
type Choice = { id: string; name: string; code?: string; rate?: string; mode?: string; version: number };
type Setup = { categories: Choice[]; units: Choice[]; taxProfiles: Choice[] };
type Form = { name: string; kind: "Goods" | "Service"; sku: string; barcode: string;
  salePrice: string; categoryId: string; baseUnitId: string; taxProfileId: string;
  isCustomer: boolean; isSupplier: boolean; phone: string; email: string };
const blank: Form = { name: "", kind: "Service", sku: "", barcode: "", salePrice: "0.00",
  categoryId: "", baseUnitId: "", taxProfileId: "", isCustomer: true, isSupplier: false,
  phone: "", email: "" };

export function LiveDirectoryPage({ type }: { type: Kind }) {
  const { csrfToken, activeMembership, selectedBusinessId } = useAuth();
  const editable = activeMembership?.role === "Owner" || activeMembership?.role === "Accountant";
  const [rows, setRows] = useState<Array<Item | Party>>([]);
  const [setup, setSetup] = useState<Setup>({ categories: [], units: [], taxProfiles: [] });
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Form>(blank);
  const [editing, setEditing] = useState<{ id: string; version: number } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [unitDraft, setUnitDraft] = useState({ code: "", name: "" });
  const [addingUnit, setAddingUnit] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [taxDraft, setTaxDraft] = useState({ name: "", rate: "", mode: "Exclusive" });
  const [conversionDraft, setConversionDraft] = useState({ unitId: "", factor: "" });
  const [conversions, setConversions] = useState<Array<{ id: string; unitId: string; factor: string; version: number }>>([]);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupEdit, setSetupEdit] = useState<{ path: "categories" | "units" | "tax-profiles" | "conversions";
    id: string; version: number; name: string; rate: string; mode: string; factor: string } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/v1/catalogue/${type}?q=${encodeURIComponent(query)}&page=${page}`, { signal });
      if (!response.ok) throw new Error(response.status === 403 ? "You do not have access to this directory." : "Could not load this directory.");
      const data = await response.json() as { rows: Array<Item | Party>; hasMore: boolean };
      setRows(data.rows);
      setHasMore(data.hasMore);
      if (type === "items") {
        const setupResponse = await fetch("/v1/catalogue/setup", { signal });
        if (!setupResponse.ok) throw new Error("Could not load catalogue choices.");
        setSetup(await setupResponse.json() as Setup);
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [type, query, page, selectedBusinessId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const startCreate = () => { setEditing(null); setForm(blank); setFormError(""); setFormOpen(true); };
  const startEdit = (row: Item | Party) => {
    setEditing({ id: row.id, version: row.version });
    setForm("kind" in row ? { ...blank, name: row.name, kind: row.kind, sku: row.sku ?? "",
      barcode: row.barcode ?? "", salePrice: row.salePrice, categoryId: row.categoryId ?? "",
      baseUnitId: row.baseUnitId ?? "", taxProfileId: row.taxProfileId ?? "" } :
      { ...blank, name: row.name, isCustomer: row.isCustomer, isSupplier: row.isSupplier,
        phone: row.phone ?? "", email: row.email ?? "" });
    setFormError(""); setFormOpen(true);
    if ("kind" in row && row.kind === "Goods") {
      void fetch(`/v1/catalogue/conversions?itemId=${row.id}`).then((response) => {
        if (!response.ok) throw new Error("Could not load conversions.");
        return response.json() as Promise<{ rows: typeof conversions }>;
      }).then((data) => setConversions(data.rows)).catch((cause) => setFormError(cause instanceof Error ? cause.message : "Could not load conversions."));
    } else setConversions([]);
  };
  const payload = () => type === "items" ? {
    name: form.name.trim(), kind: form.kind, sku: form.sku.trim() || null,
    barcode: form.barcode.trim() || null, salePrice: form.salePrice,
    categoryId: form.categoryId || null, baseUnitId: form.kind === "Service" ? null : form.baseUnitId || null,
    taxProfileId: form.taxProfileId || null,
  } : { name: form.name.trim(), isCustomer: form.isCustomer, isSupplier: form.isSupplier,
    phone: form.phone.trim() || null, email: form.email.trim() || null };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (type === "parties" && !form.isCustomer && !form.isSupplier) {
      setFormError("Choose customer, supplier, or both."); return;
    }
    if (type === "items" && form.kind === "Goods" && !form.baseUnitId) {
      setFormError("Choose a base unit for goods."); return;
    }
    setSaving(true); setFormError("");
    try {
      const response = await fetch(`/v1/catalogue/${type}${editing ? `/${editing.id}` : ""}`, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken ?? "" },
        body: JSON.stringify({ ...payload(), ...(editing ? { expectedVersion: editing.version } : {}) }),
      });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        if (response.status === 409) await load();
        throw new Error(data.error ?? "Could not save. Check your entries and try again.");
      }
      setFormOpen(false); await load();
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Could not save."); }
    finally { setSaving(false); }
  }

  async function addUnit() {
    setAddingUnit(true); setFormError("");
    try {
      const response = await fetch("/v1/catalogue/units", { method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken ?? "" },
        body: JSON.stringify({ code: unitDraft.code.trim(), name: unitDraft.name.trim() }) });
      const data = await response.json() as Choice & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not create unit.");
      setSetup((current) => ({ ...current, units: [...current.units, data] }));
      setForm((current) => ({ ...current, baseUnitId: data.id }));
      setUnitDraft({ code: "", name: "" });
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Could not create unit."); }
    finally { setAddingUnit(false); }
  }

  async function createSetup(path: string, payload: object, done: () => void) {
    setSetupBusy(true); setError(""); setFormError("");
    try {
      const response = await fetch(`/v1/catalogue/${path}`, { method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken ?? "" }, body: JSON.stringify(payload) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save setup.");
      done(); await load();
      if (path === "conversions" && editing) {
        const conversionResponse = await fetch(`/v1/catalogue/conversions?itemId=${editing.id}`);
        if (conversionResponse.ok) setConversions((await conversionResponse.json() as { rows: typeof conversions }).rows);
      }
    } catch (cause) { const message = cause instanceof Error ? cause.message : "Could not save setup.";
      if (path === "conversions") setFormError(message); else setError(message);
    } finally { setSetupBusy(false); }
  }

  async function changeSetup(archive: boolean) {
    if (!setupEdit) return;
    if (archive && !window.confirm(`Archive ${setupEdit.name}? Existing references stay in history.`)) return;
    setSetupBusy(true); setError(""); setFormError("");
    try {
      const payload = setupEdit.path === "tax-profiles" ? { name: setupEdit.name.trim(), rate: setupEdit.rate, mode: setupEdit.mode } :
        setupEdit.path === "conversions" ? { factor: setupEdit.factor } : { name: setupEdit.name.trim() };
      const response = await fetch(`/v1/catalogue/${setupEdit.path}/${setupEdit.id}`, { method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken ?? "" },
        body: JSON.stringify({ ...payload, expectedVersion: setupEdit.version, archive }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not update setup.");
      if (setupEdit.path === "conversions" && editing) {
        const next = await fetch(`/v1/catalogue/conversions?itemId=${editing.id}`);
        if (!next.ok) throw new Error("Saved, but could not refresh conversions.");
        setConversions((await next.json() as { rows: typeof conversions }).rows);
      } else await load();
      setSetupEdit(null);
    } catch (cause) { const message = cause instanceof Error ? cause.message : "Could not update setup.";
      if (setupEdit.path === "conversions") setFormError(message); else setError(message);
    } finally { setSetupBusy(false); }
  }

  async function archive(row: Item | Party) {
    if (!window.confirm(`Archive ${row.name}? It will leave active lists; existing records remain.`)) return;
    try {
      const next = "kind" in row ? { name: row.name, kind: row.kind, sku: row.sku,
        barcode: row.barcode, salePrice: row.salePrice, categoryId: row.categoryId,
        baseUnitId: row.baseUnitId, taxProfileId: row.taxProfileId } :
        { name: row.name, isCustomer: row.isCustomer, isSupplier: row.isSupplier,
          phone: row.phone, email: row.email };
      const response = await fetch(`/v1/catalogue/${type}/${row.id}`, { method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken ?? "" },
        body: JSON.stringify({ ...next, expectedVersion: row.version, archive: true }) });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? "Could not archive this record.");
      }
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not archive."); }
  }

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">BUSINESS DIRECTORY</p>
        <h1>{type === "items" ? "Items & services" : "Parties"}</h1>
        <p>{type === "items" ? "Prices and sellable items. Stock balances come later." : "Customers and suppliers in your business."}</p>
      </div>
      {editable && <button className="btn-primary" onClick={startCreate}>Add {type === "items" ? "item" : "party"}</button>}
    </div>
    <Panel>
      <div className="table-toolbar">
        <label className="search-field"><span className="sr-only">Search {type}</span>
          <input className="input" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            placeholder={type === "items" ? "Search name or barcode" : "Search party name"} /></label>
      </div>
      {error && <p className="live-error" role="alert">{error} <button className="btn-secondary" onClick={() => void load()}>Retry</button></p>}
      {loading ? <p className="muted">Loading {type}…</p> : rows.length === 0 ?
        <EmptyState title={query ? "No matches" : `No ${type} yet`}>{query ? "Try a different search." : editable ? "Use Add to create the first record." : "Ask the owner or accountant to add records."}</EmptyState> :
        <Table headers={type === "items" ? ["Item", "Barcode", "Price", ""] : ["Party", "Role", "Contact", ""]}>
          {rows.map((row) => "kind" in row ? <tr key={row.id}>
            <td><b>{row.name}</b><small className="cell-subtitle">{row.kind}{row.sku ? ` · ${row.sku}` : ""}</small></td>
            <td>{row.barcode ?? "—"}</td><td className="amount">{row.salePrice}</td>
            <td>{editable && <span className="live-row-actions"><button className="btn-ghost" onClick={() => startEdit(row)}>Edit</button><button className="btn-ghost" onClick={() => void archive(row)}>Archive</button></span>}</td>
          </tr> : <tr key={row.id}>
            <td><b>{row.name}</b></td><td>{row.isCustomer && row.isSupplier ? "Customer & supplier" : row.isCustomer ? "Customer" : "Supplier"}</td>
            <td>{row.phone ?? row.email ?? "—"}</td>
            <td>{editable && <span className="live-row-actions"><button className="btn-ghost" onClick={() => startEdit(row)}>Edit</button><button className="btn-ghost" onClick={() => void archive(row)}>Archive</button></span>}</td>
          </tr>)}
        </Table>}
      <div className="live-pagination"><button className="btn-secondary" disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page}</span><button className="btn-secondary" disabled={!hasMore || loading} onClick={() => setPage(page + 1)}>Next</button></div>
    </Panel>
    {type === "items" && editable && <Panel>
      <h2>Catalogue setup</h2><p className="muted">Create categories and generic tax profiles before assigning them to items.</p>
      <form className="account-inline-form" onSubmit={(event) => { event.preventDefault(); void createSetup("categories", { name: categoryName.trim() }, () => setCategoryName("")); }}>
        <label>New category<input className="input" required maxLength={120} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Beverages" /></label>
        <button className="btn-secondary" disabled={setupBusy}>Add category</button>
      </form>
      <form className="account-inline-form" onSubmit={(event) => { event.preventDefault(); void createSetup("tax-profiles", taxDraft, () => setTaxDraft({ name: "", rate: "", mode: "Exclusive" })); }}>
        <label>Tax profile<input className="input" required maxLength={100} value={taxDraft.name} onChange={(event) => setTaxDraft({ ...taxDraft, name: event.target.value })} placeholder="Standard tax" /></label>
        <label>Rate (%)<input className="input" required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,4})?" value={taxDraft.rate} onChange={(event) => setTaxDraft({ ...taxDraft, rate: event.target.value })} placeholder="10.0000" /></label>
        <label>Mode<select className="input" value={taxDraft.mode} onChange={(event) => setTaxDraft({ ...taxDraft, mode: event.target.value })}><option>Exclusive</option><option>Inclusive</option></select></label>
        <button className="btn-secondary" disabled={setupBusy}>Add tax profile</button>
      </form>
      {(["categories", "units", "taxProfiles"] as const).map((group) => <div key={group} className="catalogue-setup-group">
        <h3>{group === "taxProfiles" ? "Tax profiles" : group === "units" ? "Units" : "Categories"}</h3>
        {setup[group].length === 0 ? <p className="muted">None created yet.</p> :
          <div className="catalogue-setup-list">{setup[group].map((choice) => {
            const path = group === "taxProfiles" ? "tax-profiles" : group;
            return <div className="catalogue-setup-row" key={choice.id}>
              <span>{choice.code ? `${choice.code} · ` : ""}{choice.name}{choice.rate ? ` · ${choice.rate}% ${choice.mode}` : ""}</span>
              <button className="btn-ghost" disabled={setupBusy} onClick={() => setSetupEdit({ path, id: choice.id,
                version: choice.version, name: choice.name, rate: choice.rate ?? "0", mode: choice.mode ?? "Exclusive", factor: "" })}>Edit</button>
            </div>;
          })}</div>}
      </div>)}
    </Panel>}
    {setupEdit && setupEdit.path !== "conversions" && <Dialog title={`Edit ${setupEdit.path}`} onClose={() => setSetupEdit(null)}>
      <form className="live-form" onSubmit={(event) => { event.preventDefault(); void changeSetup(false); }}>
        <label>Name<input className="input" data-dialog-autofocus required maxLength={120} value={setupEdit.name}
          onChange={(event) => setSetupEdit({ ...setupEdit, name: event.target.value })} /></label>
        {setupEdit.path === "tax-profiles" && <><label>Rate (%)<input className="input" required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,4})?"
          value={setupEdit.rate} onChange={(event) => setSetupEdit({ ...setupEdit, rate: event.target.value })} /></label>
          <label>Mode<select className="input" value={setupEdit.mode} onChange={(event) => setSetupEdit({ ...setupEdit, mode: event.target.value })}><option>Exclusive</option><option>Inclusive</option></select></label></>}
        {error && <p role="alert" className="live-error">{error}</p>}
        <div className="live-form-actions"><button type="button" className="btn-ghost" disabled={setupBusy} onClick={() => void changeSetup(true)}>Archive</button>
          <button type="button" className="btn-secondary" onClick={() => setSetupEdit(null)}>Cancel</button>
          <button className="btn-primary" disabled={setupBusy}>{setupBusy ? "Saving…" : "Save changes"}</button></div>
      </form>
    </Dialog>}
    {formOpen && <Dialog className="live-dialog" title={`${editing ? "Edit" : "Add"} ${type === "items" ? "item" : "party"}`} onClose={() => { if (!saving) setFormOpen(false); }}>
        <form onSubmit={(event) => void save(event)} className="live-form">
          <label>Name<input className="input" data-dialog-autofocus required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          {type === "items" ? <>
            <label>Type<select className="input" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as Form["kind"] })}><option>Service</option><option>Goods</option></select></label>
            <label>Sale price<input className="input" required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={form.salePrice} onChange={(event) => setForm({ ...form, salePrice: event.target.value })} /></label>
            <label>SKU<input className="input" maxLength={60} value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} /></label>
            <label>Barcode<input className="input" maxLength={100} value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} /></label>
            <label>Category<select className="input" value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">None</option>{setup.categories.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label>
            {form.kind === "Goods" && <label>Base unit<select className="input" required value={form.baseUnitId} onChange={(event) => setForm({ ...form, baseUnitId: event.target.value })}><option value="">Choose a unit</option>{setup.units.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label>}
            <label>Tax profile<select className="input" value={form.taxProfileId} onChange={(event) => setForm({ ...form, taxProfileId: event.target.value })}><option value="">None</option>{setup.taxProfiles.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label>
            {form.kind === "Goods" && <div className="live-unit-add">
              <span>New unit</span><input className="input" aria-label="New unit code" placeholder="Code, e.g. EA" maxLength={20} value={unitDraft.code} onChange={(event) => setUnitDraft({ ...unitDraft, code: event.target.value })} />
              <input className="input" aria-label="New unit name" placeholder="Name, e.g. Each" maxLength={80} value={unitDraft.name} onChange={(event) => setUnitDraft({ ...unitDraft, name: event.target.value })} />
              <button type="button" className="btn-secondary" disabled={addingUnit || !unitDraft.code.trim() || !unitDraft.name.trim()} onClick={() => void addUnit()}>Add unit</button>
            </div>}
            {editing && form.kind === "Goods" && <div className="live-unit-add">
              <span>Alternate units</span>
              {conversions.map((conversion) => <div className="catalogue-setup-row" key={conversion.id}>
                <span>{setup.units.find((unit) => unit.id === conversion.unitId)?.name ?? "Unit"}: 1 = {conversion.factor} base units</span>
                <button type="button" className="btn-ghost" onClick={() => setSetupEdit({ path: "conversions", id: conversion.id,
                  version: conversion.version, name: "conversion", rate: "", mode: "", factor: conversion.factor })}>Edit</button>
              </div>)}
              {setupEdit?.path === "conversions" && <div className="live-unit-add">
                <label>Base units per alternate<input className="input" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" value={setupEdit.factor}
                  onChange={(event) => setSetupEdit({ ...setupEdit, factor: event.target.value })} /></label>
                <button type="button" className="btn-secondary" disabled={setupBusy} onClick={() => void changeSetup(false)}>Save conversion</button>
                <button type="button" className="btn-ghost" disabled={setupBusy} onClick={() => void changeSetup(true)}>Archive conversion</button>
                <button type="button" className="btn-ghost" onClick={() => setSetupEdit(null)}>Cancel</button>
              </div>}
              <select className="input" aria-label="Alternate unit" value={conversionDraft.unitId} onChange={(event) => setConversionDraft({ ...conversionDraft, unitId: event.target.value })}><option value="">Choose alternate unit</option>{setup.units.filter((unit) => unit.id !== form.baseUnitId).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select>
              <input className="input" aria-label="Units per base" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" placeholder="Base units per alternate" value={conversionDraft.factor} onChange={(event) => setConversionDraft({ ...conversionDraft, factor: event.target.value })} />
              <button type="button" className="btn-secondary" disabled={setupBusy || !conversionDraft.unitId || !conversionDraft.factor} onClick={() => void createSetup("conversions", { itemId: editing.id, ...conversionDraft }, () => setConversionDraft({ unitId: "", factor: "" }))}>Add conversion</button>
            </div>}
          </> : <>
            <div className="live-checks"><label><input type="checkbox" checked={form.isCustomer} onChange={(event) => setForm({ ...form, isCustomer: event.target.checked })} /> Customer</label>
              <label><input type="checkbox" checked={form.isSupplier} onChange={(event) => setForm({ ...form, isSupplier: event.target.checked })} /> Supplier</label></div>
            <label>Phone (optional)<input className="input" maxLength={40} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
            <label>Email (optional)<input className="input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          </>}
          {formError && <p className="live-error" role="alert">{formError}</p>}
          <div className="live-form-actions"><button type="button" className="btn-secondary" disabled={saving} onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Add"}</button></div>
        </form>
    </Dialog>}
  </>;
}
