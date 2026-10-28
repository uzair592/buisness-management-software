import { useState, useEffect } from "react";
import { Panel, EmptyState } from "@business/ui";
import { formatMoney } from "@business/domain";
import { useAuth } from "../context/AuthContext";

interface QuoteLine {
  id: string;
  itemId: string;
  quantity: string;
  convertedQuantity: string;
  unitPrice: string;
  taxAmount: string;
  lineTotal: string;
  item: { id: string; name: string; sku: string | null };
}

interface Quotation {
  id: string;
  number: string;
  partyId: string;
  party: { id: string; name: string };
  status: "Draft" | "Issued" | "Accepted" | "Expired" | "PartiallyFulfilled" | "Fulfilled" | "Closed";
  validUntil: string | null;
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  notes: string | null;
  createdAt: string;
  lines: QuoteLine[];
}

interface LineDraft {
  itemId: string;
  quantity: string;
  unitPrice: string;
  taxProfileId: string;
}

export function QuotesPage() {
  const { authenticated, selectedBusinessId, csrfToken } = useAuth();
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"list" | "new">("list");
  const [filterStatus, setFilterStatus] = useState<string>("All");

  // Catalogue
  const [parties, setParties] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<Array<{ id: string; name: string; salePrice: string }>>([]);
  const [taxProfiles, setTaxProfiles] = useState<Array<{ id: string; name: string; rate: string }>>([]);

  // Form State
  const [partyId, setPartyId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    { itemId: "", quantity: "1", unitPrice: "0.00", taxProfileId: "" },
  ]);

  // Convert Modal State
  const [selectedQuote, setSelectedQuote] = useState<Quotation | null>(null);
  const [convertQuantities, setConvertQuantities] = useState<Record<string, string>>({});
  const [converting, setConverting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  const loadData = async () => {
    if (!authenticated || !selectedBusinessId) return;
    setLoading(true);
    try {
      const [qRes, wsRes] = await Promise.all([
        fetch("/v1/quotes", { credentials: "include" }),
        fetch("/v1/sales/workspace", { credentials: "include" }),
      ]);

      if (qRes.ok) {
        setQuotes(await qRes.json());
      }
      if (wsRes.ok) {
        const ws = await wsRes.json();
        setParties(ws.parties || []);
        setItems(ws.items || []);
        setTaxProfiles(ws.taxProfiles || []);
        if (ws.parties?.[0] && !partyId) setPartyId(ws.parties[0].id);
        if (ws.items?.[0] && !lines[0]?.itemId) {
          setLines([{ itemId: ws.items[0].id, quantity: "1", unitPrice: ws.items[0].salePrice || "0.00", taxProfileId: "" }]);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [authenticated, selectedBusinessId]);

  const addLine = () => {
    const defaultItem = items[0];
    setLines([
      ...lines,
      {
        itemId: defaultItem ? defaultItem.id : "",
        quantity: "1",
        unitPrice: defaultItem ? defaultItem.salePrice || "0.00" : "0.00",
        taxProfileId: "",
      },
    ]);
  };

  const removeLine = (index: number) => {
    if (lines.length > 1) {
      setLines(lines.filter((_, i) => i !== index));
    }
  };

  const updateLine = (index: number, field: keyof LineDraft, value: string) => {
    const next = [...lines];
    const current = { ...next[index]! };
    if (field === "itemId") {
      current.itemId = value;
      const found = items.find((i) => i.id === value);
      if (found && found.salePrice) current.unitPrice = found.salePrice;
    } else {
      current[field] = value;
    }
    next[index] = current;
    setLines(next);
  };

  const handleCreateQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError("");
    setActionSuccess("");

    if (!partyId) {
      setActionError("Please select a customer");
      return;
    }
    if (lines.length === 0 || lines.some((l) => !l.itemId || Number(l.quantity) <= 0)) {
      setActionError("All quotation lines must have an item and a positive quantity");
      return;
    }

    try {
      const res = await fetch("/v1/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken || "" },
        body: JSON.stringify({
          partyId,
          validUntil: validUntil ? new Date(validUntil).toISOString() : undefined,
          notes: notes.trim() || undefined,
          lines: lines.map((l) => ({
            itemId: l.itemId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxProfileId: l.taxProfileId || undefined,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create quotation");
      }

      setActionSuccess("Quotation created successfully!");
      setActiveTab("list");
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStatusChange = async (quoteId: string, newStatus: string) => {
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/v1/quotes/${quoteId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken || "" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update status");
      }
      setActionSuccess(`Quotation status changed to ${newStatus}`);
      await loadData();
      if (selectedQuote && selectedQuote.id === quoteId) {
        setSelectedQuote({ ...selectedQuote, status: newStatus as Quotation["status"] });
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const openConvertModal = (quote: Quotation) => {
    setSelectedQuote(quote);
    const initialConvert: Record<string, string> = {};
    for (const l of quote.lines) {
      const remaining = Math.max(0, Number(l.quantity) - Number(l.convertedQuantity));
      initialConvert[l.id] = remaining.toString();
    }
    setConvertQuantities(initialConvert);
    setActionError("");
    setActionSuccess("");
  };

  const handleConvert = async () => {
    if (!selectedQuote) return;
    setConverting(true);
    setActionError("");
    setActionSuccess("");

    const linesToConvert = Object.entries(convertQuantities)
      .filter(([_, qty]) => Number(qty) > 0)
      .map(([lineId, qty]) => ({ lineId, quantityToConvert: qty }));

    if (linesToConvert.length === 0) {
      setActionError("Please select at least one line with quantity > 0 to convert");
      setConverting(false);
      return;
    }

    try {
      const res = await fetch(`/v1/quotes/${selectedQuote.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken || "" },
        body: JSON.stringify({
          lines: linesToConvert,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to convert quotation");
      }

      const result = await res.json();
      setActionSuccess(`Quotation successfully converted to Sale Invoice! New status: ${result.quotation.status}`);
      await loadData();
      setSelectedQuote(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setConverting(false);
    }
  };

  const filteredQuotes = quotes.filter((q) => {
    if (filterStatus !== "All" && q.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Quotations / Estimates</h1>
          <p className="text-sm text-slate-500">
            Create non-posting commercial quotes and convert them seamlessly into Sales Invoices.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={activeTab === "list" ? "btn-primary" : "btn-secondary"}
            onClick={() => setActiveTab("list")}
          >
            Quotation List
          </button>
          <button
            className={activeTab === "new" ? "btn-primary" : "btn-secondary"}
            onClick={() => setActiveTab("new")}
          >
            + New Quotation
          </button>
        </div>
      </div>

      {actionError && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-sm">
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">
          {actionSuccess}
        </div>
      )}

      {activeTab === "new" ? (
        <Panel className="p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Create New Quotation</h2>
          <form onSubmit={handleCreateQuotation} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Customer *</label>
                <select
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white"
                  value={partyId}
                  onChange={(e) => setPartyId(e.target.value)}
                  required
                >
                  <option value="">Select Customer...</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Valid Until</label>
                <input
                  type="date"
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Notes</label>
                <input
                  type="text"
                  placeholder="Optional terms or remarks"
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold text-slate-700 uppercase">Items</h3>
                <button type="button" className="btn-secondary" onClick={addLine}>
                  + Add Line
                </button>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600 font-semibold text-xs border-b border-slate-200">
                    <tr>
                      <th className="p-3">Item *</th>
                      <th className="p-3 w-32">Quantity *</th>
                      <th className="p-3 w-36">Unit Price *</th>
                      <th className="p-3 w-36">Tax</th>
                      <th className="p-3 w-20 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((line, idx) => (
                      <tr key={idx}>
                        <td className="p-3">
                          <select
                            className="w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white"
                            value={line.itemId}
                            onChange={(e) => updateLine(idx, "itemId", e.target.value)}
                            required
                          >
                            <option value="">Select item...</option>
                            {items.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-3">
                          <input
                            type="number"
                            step="any"
                            min="0.000001"
                            className="w-full border border-slate-300 rounded px-2 py-1 text-sm text-right"
                            value={line.quantity}
                            onChange={(e) => updateLine(idx, "quantity", e.target.value)}
                            required
                          />
                        </td>
                        <td className="p-3">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="w-full border border-slate-300 rounded px-2 py-1 text-sm text-right"
                            value={line.unitPrice}
                            onChange={(e) => updateLine(idx, "unitPrice", e.target.value)}
                            required
                          />
                        </td>
                        <td className="p-3">
                          <select
                            className="w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white"
                            value={line.taxProfileId}
                            onChange={(e) => updateLine(idx, "taxProfileId", e.target.value)}
                          >
                            <option value="">No Tax (0%)</option>
                            {taxProfiles.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} ({t.rate}%)
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-3 text-center">
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            className="text-rose-500 hover:text-rose-700 text-sm font-bold"
                            disabled={lines.length === 1}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <button type="button" className="btn-secondary" onClick={() => setActiveTab("list")}>
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Issue Quotation
              </button>
            </div>
          </form>
        </Panel>
      ) : (
        <Panel className="p-0 overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap justify-between items-center gap-4 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 uppercase">Status:</span>
              <select
                className="border border-slate-300 rounded px-2 py-1 text-xs bg-white"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="All">All Statuses</option>
                <option value="Issued">Issued</option>
                <option value="Accepted">Accepted</option>
                <option value="PartiallyFulfilled">Partially Fulfilled</option>
                <option value="Fulfilled">Fulfilled</option>
                <option value="Expired">Expired</option>
                <option value="Closed">Closed</option>
              </select>
            </div>
            <span className="text-xs text-slate-500">{filteredQuotes.length} quotations found</span>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-500 text-sm">Loading quotations...</div>
          ) : filteredQuotes.length === 0 ? (
            <EmptyState title="No quotations found">
              Create a quotation to give formal price estimates to your customers before billing.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600 font-semibold text-xs border-b border-slate-200">
                  <tr>
                    <th className="p-4">Number</th>
                    <th className="p-4">Customer</th>
                    <th className="p-4">Date</th>
                    <th className="p-4">Total Amount</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredQuotes.map((q) => (
                    <tr key={q.id} className="hover:bg-slate-50/75 transition-colors">
                      <td className="p-4 font-mono font-medium text-slate-900">{q.number}</td>
                      <td className="p-4 text-slate-800">{q.party.name}</td>
                      <td className="p-4 text-slate-500">{new Date(q.createdAt).toLocaleDateString()}</td>
                      <td className="p-4 font-semibold text-slate-900">{formatMoney(q.grandTotal)}</td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            q.status === "Fulfilled"
                              ? "bg-emerald-100 text-emerald-800"
                              : q.status === "PartiallyFulfilled"
                              ? "bg-sky-100 text-sky-800"
                              : q.status === "Accepted"
                              ? "bg-indigo-100 text-indigo-800"
                              : q.status === "Issued"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {q.status}
                        </span>
                      </td>
                      <td className="p-4 text-right space-x-2">
                        {["Draft", "Issued", "Accepted", "PartiallyFulfilled"].includes(q.status) && (
                          <button
                            onClick={() => openConvertModal(q)}
                            className="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700"
                          >
                            Convert to Sale
                          </button>
                        )}
                        {q.status === "Issued" && (
                          <button
                            onClick={() => handleStatusChange(q.id, "Accepted")}
                            className="px-2.5 py-1 bg-slate-200 text-slate-700 rounded text-xs font-semibold hover:bg-slate-300"
                          >
                            Accept
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {/* Convert Modal */}
      {selectedQuote && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Convert {selectedQuote.number} to Sales Invoice
                </h3>
                <p className="text-xs text-slate-500">Customer: {selectedQuote.party.name}</p>
              </div>
              <button
                onClick={() => setSelectedQuote(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-slate-600">
                Specify quantities to convert into a standard sales invoice. Any unconverted quantities will remain open for future fulfillment.
              </p>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-3">Item</th>
                      <th className="p-3 text-right">Quoted</th>
                      <th className="p-3 text-right">Already Billed</th>
                      <th className="p-3 text-right">Remaining</th>
                      <th className="p-3 text-right w-28">Convert Now</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedQuote.lines.map((l) => {
                      const total = Number(l.quantity);
                      const billed = Number(l.convertedQuantity);
                      const remaining = Math.max(0, total - billed);
                      return (
                        <tr key={l.id}>
                          <td className="p-3 font-medium text-slate-900">{l.item.name}</td>
                          <td className="p-3 text-right text-slate-600">{l.quantity}</td>
                          <td className="p-3 text-right text-slate-600">{l.convertedQuantity}</td>
                          <td className="p-3 text-right font-semibold text-slate-800">{remaining}</td>
                          <td className="p-3 text-right">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              max={remaining}
                              disabled={remaining === 0}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-right text-xs bg-white font-medium"
                              value={convertQuantities[l.id] || "0"}
                              onChange={(e) =>
                                setConvertQuantities({
                                  ...convertQuantities,
                                  [l.id]: e.target.value,
                                })
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <button type="button" className="btn-secondary" onClick={() => setSelectedQuote(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleConvert}
                disabled={converting}
              >
                {converting ? "Posting Invoice..." : "Create & Post Invoice"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
