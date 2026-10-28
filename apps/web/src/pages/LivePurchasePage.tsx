import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { calculateDocument } from "@business/domain";
import { Panel, Table } from "@business/ui";
import { useAuth } from "../context/AuthContext";

type Item = {
  id: string;
  name: string;
  kind: "Goods" | "Service";
  sku: string | null;
  barcode: string | null;
  salePrice: string;
  baseUnitId: string | null;
  taxProfileId: string | null;
};
type Unit = { id: string; name: string };
type Conversion = { id: string; itemId: string; unitId: string; factor: string };
type Account = { id: string; name: string; kind: "Cash" | "Bank" };
type Location = { id: string; code: string; name: string };
type Party = { id: string; name: string };
type TaxProfile = { id: string; rate: string; mode: "Inclusive" | "Exclusive" };

type Workspace = {
  items: Item[];
  units: Unit[];
  conversions: Conversion[];
  accounts: Account[];
  locations: Location[];
  parties: Party[];
  taxProfiles: TaxProfile[];
};

type PurchaseLine = {
  id: string;
  itemId: string;
  conversionId: string | null;
  taxProfileId: string | null;
  quantity: string;
  unitCost: string;
  discount: string;
};

type SavedPurchase = {
  id: string;
  number: string;
  total: string;
  paid: string;
  due: string;
  supplierInvoiceNumber: string;
  snapshot: unknown;
};

const moneyRegex = /^\d+(?:\.\d{1,2})?$/;

export function LivePurchasePage() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Form states
  const [documentId, setDocumentId] = useState(() => crypto.randomUUID());
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [locationId, setLocationId] = useState("");
  const [partyId, setPartyId] = useState("");
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [businessDate, setBusinessDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [documentDiscount, setDocumentDiscount] = useState("0");
  const [lines, setLines] = useState<PurchaseLine[]>([]);

  // Payment states
  const [cashAccountId, setCashAccountId] = useState("");
  const [cashApplied, setCashApplied] = useState("0");
  const [bankAccountId, setBankAccountId] = useState("");
  const [bankApplied, setBankApplied] = useState("0");
  const [bankReference, setBankReference] = useState("");

  // Duplicate supplier reference confirmation
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [allowDuplicateReference, setAllowDuplicateReference] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [issued, setIssued] = useState<SavedPurchase | null>(null);

  const loadWorkspace = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/v1/purchases/workspace", { signal });
      if (!response.ok) throw new Error("Could not load purchases workspace. Check your access permissions.");
      const data = (await response.json()) as Workspace;
      if (signal?.aborted) return;
      setWorkspace(data);
      if (data.locations[0]) setLocationId((curr) => curr || data.locations[0].id);
      if (data.parties[0]) setPartyId((curr) => curr || data.parties[0].id);
      const firstCash = data.accounts.find((a) => a.kind === "Cash");
      if (firstCash) setCashAccountId((curr) => curr || firstCash.id);
      const firstBank = data.accounts.find((a) => a.kind === "Bank");
      if (firstBank) setBankAccountId((curr) => curr || firstBank.id);
    } catch (cause) {
      if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadWorkspace(controller.signal);
    return () => controller.abort();
  }, [loadWorkspace]);

  // Handle draft loading from URL parameter
  useEffect(() => {
    const draftId = params.get("draft");
    if (!draftId || busy) return;
    const controller = new AbortController();
    void fetch(`/v1/purchases/documents/${draftId}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Could not load saved purchase draft");
        return res.json();
      })
      .then((doc) => {
        setDocumentId(doc.id);
        setCommandId(doc.commandId);
        setLocationId(doc.locationId);
        setPartyId(doc.partyId);
        setSupplierInvoiceNumber(doc.supplierInvoiceNumber);
        setBusinessDate(doc.businessDate.slice(0, 10));
        const input = doc.snapshot?.input ?? doc.snapshot;
        if (input?.lines) {
          setLines(
            input.lines.map((l: PurchaseLine) => ({
              id: l.id ?? crypto.randomUUID(),
              itemId: l.itemId,
              conversionId: l.conversionId ?? null,
              taxProfileId: l.taxProfileId ?? null,
              quantity: l.quantity,
              unitCost: l.unitCost,
              discount: l.discount ?? "0",
            })),
          );
        }
        if (input?.documentDiscount) setDocumentDiscount(input.documentDiscount);
        if (input?.payments) {
          const cashP = input.payments.find((p: { kind: string }) => p.kind === "Cash");
          if (cashP) {
            setCashAccountId(cashP.accountId);
            setCashApplied(cashP.applied);
          }
          const bankP = input.payments.find((p: { kind: string }) => p.kind === "Bank");
          if (bankP) {
            setBankAccountId(bankP.accountId);
            setBankApplied(bankP.applied);
            setBankReference(bankP.reference ?? "");
          }
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [params]);

  // Filtered item search results
  const searchResults = useMemo(() => {
    if (!workspace || !searchQuery.trim()) return [];
    const lower = searchQuery.toLowerCase();
    return workspace.items.filter(
      (item) =>
        item.name.toLowerCase().includes(lower) ||
        (item.sku && item.sku.toLowerCase().includes(lower)) ||
        (item.barcode && item.barcode.includes(lower)),
    );
  }, [workspace, searchQuery]);

  function addItem(item: Item) {
    setLines((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        itemId: item.id,
        conversionId: null,
        taxProfileId: item.taxProfileId,
        quantity: "1",
        unitCost: item.salePrice || "0.00",
        discount: "0",
      },
    ]);
    setSearchQuery("");
  }

  function updateLine(index: number, changes: Partial<PurchaseLine>) {
    setLines((current) => current.map((l, idx) => (idx === index ? { ...l, ...changes } : l)));
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, idx) => idx !== index));
  }

  // Live calculation
  const calculation = useMemo(() => {
    if (!workspace) return { base: "0.00", tax: "0.00", total: "0.00", lines: [] };
    const validLines = lines.filter(
      (l) =>
        Number(l.quantity) > 0 &&
        moneyRegex.test(l.unitCost) &&
        Number(l.unitCost) >= 0 &&
        moneyRegex.test(l.discount || "0"),
    );
    if (!validLines.length) return { base: "0.00", tax: "0.00", total: "0.00", lines: [] };

    const byTax = new Map(workspace.taxProfiles.map((t) => [t.id, t]));
    const byConv = new Map(workspace.conversions.map((c) => [c.id, c]));

    const calcLines = validLines.map((l) => {
      const conv = l.conversionId ? byConv.get(l.conversionId) : null;
      const tax = l.taxProfileId ? byTax.get(l.taxProfileId) : null;
      return {
        id: l.id,
        quantity: l.quantity,
        conversion: conv?.factor ?? "1",
        conversionVersion: 1,
        unitPrice: l.unitCost,
        lineDiscount: { kind: "amount" as const, value: l.discount || "0" },
        tax: {
          mode: (tax?.mode.toLowerCase() ?? "exclusive") as "exclusive" | "inclusive",
          percent: tax?.rate ?? "0",
        },
      };
    });

    try {
      return calculateDocument({
        lines: calcLines,
        documentDiscount: moneyRegex.test(documentDiscount) ? documentDiscount : "0",
      });
    } catch {
      return { base: "0.00", tax: "0.00", total: "0.00", lines: [] };
    }
  }, [workspace, lines, documentDiscount]);

  const totalPaid = useMemo(() => {
    const cash = moneyRegex.test(cashApplied) ? Number(cashApplied) : 0;
    const bank = moneyRegex.test(bankApplied) ? Number(bankApplied) : 0;
    return (cash + bank).toFixed(2);
  }, [cashApplied, bankApplied]);

  const dueAmount = useMemo(() => {
    const total = Number(calculation.total) || 0;
    const paid = Number(totalPaid) || 0;
    return Math.max(0, total - paid).toFixed(2);
  }, [calculation.total, totalPaid]);

  function buildPayload() {
    const payments = [];
    if (Number(cashApplied) > 0) {
      payments.push({
        id: crypto.randomUUID(),
        accountId: cashAccountId,
        kind: "Cash" as const,
        applied: cashApplied,
        reference: null,
      });
    }
    if (Number(bankApplied) > 0) {
      payments.push({
        id: crypto.randomUUID(),
        accountId: bankAccountId,
        kind: "Bank" as const,
        applied: bankApplied,
        reference: bankReference.trim() || "BANK-TX",
      });
    }

    return {
      id: documentId,
      commandId,
      locationId,
      partyId,
      supplierInvoiceNumber: supplierInvoiceNumber.trim(),
      allowDuplicateSupplierReference: allowDuplicateReference,
      businessDate,
      documentDiscount: documentDiscount || "0",
      lines: lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        conversionId: l.conversionId,
        taxProfileId: l.taxProfileId,
        quantity: l.quantity,
        unitCost: l.unitCost,
        discount: l.discount || "0",
      })),
      payments,
    };
  }

  async function handleSaveDraft() {
    if (!supplierInvoiceNumber.trim()) {
      setError("Supplier invoice number / reference is required");
      return;
    }
    if (!lines.length) {
      setError("Add at least one item to the purchase bill");
      return;
    }
    setBusy(true);
    setError("");
    setDuplicateWarning("");
    try {
      const payload = buildPayload();
      const res = await fetch("/v1/purchases/drafts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": auth.csrfToken ?? "",
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save purchase draft");
      setDuplicateWarning("Draft saved successfully.");
    } catch (cause) {
      if (cause instanceof Error) setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePostPurchase() {
    if (!supplierInvoiceNumber.trim()) {
      setError("Supplier invoice reference is required before posting");
      return;
    }
    if (!lines.length) {
      setError("Add at least one item to post purchase bill");
      return;
    }
    if (Number(bankApplied) > 0 && !bankReference.trim()) {
      setError("Bank payment requires a reference or cheque number");
      return;
    }
    setBusy(true);
    setError("");
    setDuplicateWarning("");
    try {
      // 1. Save draft first
      const payload = buildPayload();
      const draftRes = await fetch("/v1/purchases/drafts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": auth.csrfToken ?? "",
        },
        body: JSON.stringify(payload),
      });
      const draftData = await draftRes.json();
      if (!draftRes.ok) throw new Error(draftData.error ?? "Could not save draft before posting");

      // 2. Post purchase command
      const postRes = await fetch(`/v1/purchases/${documentId}/post`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": auth.csrfToken ?? "",
        },
        body: JSON.stringify({
          commandId,
          allowDuplicateSupplierReference: allowDuplicateReference,
        }),
      });
      const postData = await postRes.json();
      if (postRes.status === 409 && postData.error?.includes("Supplier reference already recorded")) {
        setDuplicateWarning(postData.error);
        return;
      }
      if (!postRes.ok) throw new Error(postData.error ?? "Failed to post purchase bill");

      setIssued(postData);
    } catch (cause) {
      if (cause instanceof Error) setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="live-purchase-page">
        <Panel><p>Loading purchase workspace…</p></Panel>
      </div>
    );
  }

  if (issued) {
    return (
      <div className="live-purchase-page purchase-print">
        <Panel>
          <div className="section-heading">
            <div>
              <p className="eyebrow text-success">PURCHASE BILL POSTED</p>
              <h1>{issued.number}</h1>
              <p>Supplier Ref: <span className="mono-code">{issued.supplierInvoiceNumber}</span></p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn-secondary print-hide" onClick={() => window.print()}>
                Print bill
              </button>
              <Link className="btn-primary print-hide" to="/purchases" onClick={() => {
                setIssued(null);
                setLines([]);
                setDocumentId(crypto.randomUUID());
                setCommandId(crypto.randomUUID());
                setSupplierInvoiceNumber("");
              }}>
                Back to purchases
              </Link>
            </div>
          </div>
          <div style={{ margin: "1.5rem 0" }}>
            <p>Total Bill: <b>{issued.total}</b></p>
            <p>Paid: {issued.paid} · <b>Remaining Payable: {issued.due}</b></p>
            <p className="text-muted">Inventory quantities and weighted-average costs have been updated atomically.</p>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="live-purchase-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PURCHASES</p>
          <h1>New Purchase Bill</h1>
          <p>Record supplier invoice, receive stock, and track payable dues.</p>
        </div>
        <Link className="btn-ghost" to="/purchases">
          View all purchases
        </Link>
      </div>

      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}

      {duplicateWarning && (
        <div role="alert" className="panel" style={{ borderLeft: "4px solid #f59e0b", background: "#fef3c7", padding: "1rem", marginBottom: "1rem" }}>
          <p style={{ fontWeight: 600, color: "#92400e" }}>Warning: Duplicate Supplier Reference</p>
          <p style={{ color: "#78350f", margin: "0.5rem 0" }}>{duplicateWarning}</p>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={allowDuplicateReference}
              onChange={(e) => setAllowDuplicateReference(e.target.checked)}
            />
            <span style={{ fontWeight: 500 }}>I confirm this is an intentional repeat supplier invoice reference.</span>
          </label>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "1.5rem" }}>
        {/* Left Column: Details & Items */}
        <div>
          <Panel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <label>
                <span className="label-text">Receiving Location</span>
                <select
                  className="input"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  {workspace?.locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.code})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="label-text">Supplier</span>
                <select
                  className="input"
                  value={partyId}
                  onChange={(e) => setPartyId(e.target.value)}
                >
                  {workspace?.parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="label-text">Supplier Invoice Number *</span>
                <input
                  className="input"
                  type="text"
                  placeholder="e.g. INV-2026-88"
                  value={supplierInvoiceNumber}
                  onChange={(e) => {
                    setSupplierInvoiceNumber(e.target.value);
                    setDuplicateWarning("");
                  }}
                  required
                />
              </label>

              <label>
                <span className="label-text">Invoice Date</span>
                <input
                  className="input"
                  type="date"
                  value={businessDate}
                  onChange={(e) => setBusinessDate(e.target.value)}
                />
              </label>
            </div>
          </Panel>

          {/* Item search & cart */}
          <div style={{ marginTop: "1.5rem" }}>
            <Panel>
              <div className="section-heading">
              <h2>Purchase Items</h2>
            </div>

            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input
                className="input"
                type="search"
                placeholder="Search items by name, barcode or SKU to add..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchResults.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    background: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.375rem",
                    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                    maxHeight: "220px",
                    overflowY: "auto",
                    zIndex: 50,
                  }}
                >
                  {searchResults.map((item) => (
                    <div
                      key={item.id}
                      style={{ padding: "0.5rem 1rem", borderBottom: "1px solid #f3f4f6", cursor: "pointer", display: "flex", justifyContent: "space-between" }}
                      onClick={() => addItem(item)}
                    >
                      <div>
                        <b>{item.name}</b> {item.sku ? <span className="text-muted">({item.sku})</span> : ""}
                      </div>
                      <div>
                        <span>Cost: {item.salePrice || "0.00"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!lines.length ? (
              <p className="text-muted" style={{ padding: "1.5rem 0", textAlign: "center" }}>
                No items added yet. Search above to add items to this purchase bill.
              </p>
            ) : (
              <Table headers={["Item", "Quantity", "Unit Cost", "Disc", "Tax", "Net Total", ""]}>
                {lines.map((line, idx) => {
                  const itm = workspace?.items.find((i) => i.id === line.itemId);
                  const lineConv = workspace?.conversions.filter((c) => c.itemId === line.itemId) ?? [];
                  const lineCalc = calculation.lines[idx];

                  return (
                    <tr key={line.id}>
                      <td>
                        <b>{itm?.name ?? "Item"}</b>
                        {lineConv.length > 0 && (
                          <select
                            className="input"
                            style={{ display: "block", marginTop: "0.25rem", fontSize: "0.85rem" }}
                            value={line.conversionId ?? ""}
                            onChange={(e) => updateLine(idx, { conversionId: e.target.value || null })}
                          >
                            <option value="">Base unit</option>
                            {lineConv.map((c) => {
                              const u = workspace?.units.find((u) => u.id === c.unitId);
                              return (
                                <option key={c.id} value={c.id}>
                                  {u?.name ?? "Unit"} (x{c.factor})
                                </option>
                              );
                            })}
                          </select>
                        )}
                      </td>
                      <td style={{ width: "90px" }}>
                        <input
                          className="input"
                          type="number"
                          step="any"
                          min="0.000001"
                          aria-label="Quantity"
                          value={line.quantity}
                          onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                        />
                      </td>
                      <td style={{ width: "110px" }}>
                        <input
                          className="input"
                          type="number"
                          step="0.01"
                          min="0"
                          aria-label="Unit Cost"
                          value={line.unitCost}
                          onChange={(e) => updateLine(idx, { unitCost: e.target.value })}
                        />
                      </td>
                      <td style={{ width: "80px" }}>
                        <input
                          className="input"
                          type="number"
                          step="0.01"
                          min="0"
                          aria-label="Line Discount"
                          value={line.discount}
                          onChange={(e) => updateLine(idx, { discount: e.target.value })}
                        />
                      </td>
                      <td style={{ width: "110px" }}>
                        <select
                          className="input"
                          value={line.taxProfileId ?? ""}
                          onChange={(e) => updateLine(idx, { taxProfileId: e.target.value || null })}
                        >
                          <option value="">No Tax (0%)</option>
                          {workspace?.taxProfiles.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.rate}% ({t.mode})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="amount">{lineCalc?.total ?? "—"}</td>
                      <td>
                        <button className="btn-ghost text-danger" onClick={() => removeLine(idx)}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Panel>
          </div>
        </div>

        {/* Right Column: Payment & Summary */}
        <div>
          <Panel>
            <h2>Bill Summary</h2>
            <div style={{ margin: "1rem 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0" }}>
                <span>Subtotal:</span>
                <b>{calculation.base}</b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0" }}>
                <span>Tax:</span>
                <b>{calculation.tax}</b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.25rem 0" }}>
                <span>Bill Discount:</span>
                <input
                  className="input"
                  style={{ width: "90px", textAlign: "right" }}
                  type="number"
                  step="0.01"
                  min="0"
                  aria-label="Bill Discount"
                  value={documentDiscount}
                  onChange={(e) => setDocumentDiscount(e.target.value)}
                />
              </div>
              <hr style={{ margin: "0.75rem 0", borderColor: "#e5e7eb" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1.2rem", fontWeight: 700 }}>
                <span>Total:</span>
                <span>{calculation.total}</span>
              </div>
            </div>

            <hr style={{ margin: "1rem 0", borderColor: "#e5e7eb" }} />

            <h3>Payment Split</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
              <div>
                <label className="label-text">Cash Paid</label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <select
                    className="input"
                    value={cashAccountId}
                    onChange={(e) => setCashAccountId(e.target.value)}
                    style={{ flex: 1 }}
                  >
                    {workspace?.accounts
                      .filter((a) => a.kind === "Cash")
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                  <input
                    className="input"
                    style={{ width: "90px" }}
                    type="number"
                    step="0.01"
                    min="0"
                    aria-label="Cash Paid"
                    value={cashApplied}
                    onChange={(e) => setCashApplied(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="label-text">Bank / Transfer Paid</label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <select
                    className="input"
                    value={bankAccountId}
                    onChange={(e) => setBankAccountId(e.target.value)}
                    style={{ flex: 1 }}
                  >
                    {workspace?.accounts
                      .filter((a) => a.kind === "Bank")
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                  <input
                    className="input"
                    style={{ width: "90px" }}
                    type="number"
                    step="0.01"
                    min="0"
                    aria-label="Bank Paid"
                    value={bankApplied}
                    onChange={(e) => setBankApplied(e.target.value)}
                  />
                </div>
                {Number(bankApplied) > 0 && (
                  <input
                    className="input"
                    style={{ marginTop: "0.5rem" }}
                    type="text"
                    placeholder="Bank reference / Cheque #"
                    value={bankReference}
                    onChange={(e) => setBankReference(e.target.value)}
                    required
                  />
                )}
              </div>

              <div style={{ background: "#f9fafb", padding: "0.75rem", borderRadius: "0.375rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Total Paid:</span>
                  <b>{totalPaid}</b>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.25rem", color: Number(dueAmount) > 0 ? "#dc2626" : "#16a34a" }}>
                  <span>Remaining Due:</span>
                  <b>{dueAmount}</b>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "1.5rem" }}>
              <button
                className="btn-primary"
                disabled={busy || !lines.length || !supplierInvoiceNumber.trim()}
                onClick={handlePostPurchase}
              >
                {busy ? "Posting…" : "Post Purchase Bill"}
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={handleSaveDraft}
              >
                Save Draft
              </button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
