import { useState, useEffect } from "react";
import { Panel, EmptyState } from "@business/ui";
import { formatMoney } from "@business/domain";
import { useAuth } from "../context/AuthContext";

interface POLine {
  id: string;
  itemId: string;
  quantity: string;
  convertedQuantity: string;
  unitPrice: string;
  taxAmount: string;
  lineTotal: string;
  item: { id: string; name: string; sku: string | null };
}

interface PurchaseOrder {
  id: string;
  number: string;
  partyId: string;
  party: { id: string; name: string };
  locationId: string;
  location: { id: string; name: string };
  status: "Draft" | "Issued" | "Accepted" | "Expired" | "PartiallyFulfilled" | "Fulfilled" | "Closed";
  expectedDeliveryDate: string | null;
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  notes: string | null;
  createdAt: string;
  lines: POLine[];
}

interface LineDraft {
  itemId: string;
  quantity: string;
  unitPrice: string;
  taxProfileId: string;
}

export function PurchaseOrdersPage() {
  const { authenticated, selectedBusinessId, csrfToken } = useAuth();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"list" | "new">("list");
  const [filterStatus, setFilterStatus] = useState<string>("All");

  // Catalogue
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<Array<{ id: string; name: string; salePrice: string }>>([]);
  const [taxProfiles, setTaxProfiles] = useState<Array<{ id: string; name: string; rate: string }>>([]);

  // Form State
  const [partyId, setPartyId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    { itemId: "", quantity: "1", unitPrice: "0.00", taxProfileId: "" },
  ]);

  // Convert Modal State
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [convertQuantities, setConvertQuantities] = useState<Record<string, string>>({});
  const [converting, setConverting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  const loadData = async () => {
    if (!authenticated || !selectedBusinessId) return;
    setLoading(true);
    try {
      const [poRes, partiesRes, locRes, wsRes] = await Promise.all([
        fetch("/v1/purchase-orders", { credentials: "include" }),
        fetch("/v1/catalogue/parties", { credentials: "include" }),
        fetch("/v1/locations", { credentials: "include" }),
        fetch("/v1/sales/workspace", { credentials: "include" }),
      ]);

      if (poRes.ok) {
        setOrders(await poRes.json());
      }
      if (partiesRes.ok) {
        const pData = await partiesRes.json();
        const pList = Array.isArray(pData) ? pData : (pData.rows || []);
        const supps = pList.filter((p: { isSupplier?: boolean }) => p.isSupplier);
        setSuppliers(supps.length > 0 ? supps : pList);
        if (supps[0] && !partyId) setPartyId(supps[0].id);
      }
      if (locRes.ok) {
        const locs = await locRes.json();
        setLocations(locs);
        if (locs[0] && !locationId) setLocationId(locs[0].id);
      }
      if (wsRes.ok) {
        const ws = await wsRes.json();
        setItems(ws.items || []);
        setTaxProfiles(ws.taxProfiles || []);
        if (ws.items?.[0] && !lines[0]?.itemId) {
          setLines([{ itemId: ws.items[0].id, quantity: "1", unitPrice: "0.00", taxProfileId: "" }]);
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
        unitPrice: "0.00",
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
    current[field] = value;
    next[index] = current;
    setLines(next);
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError("");
    setActionSuccess("");

    if (!partyId) {
      setActionError("Please select a supplier");
      return;
    }
    if (!locationId) {
      setActionError("Please select a delivery location");
      return;
    }
    if (lines.length === 0 || lines.some((l) => !l.itemId || Number(l.quantity) <= 0)) {
      setActionError("All order lines must have an item and a positive quantity");
      return;
    }

    try {
      const res = await fetch("/v1/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken || "" },
        body: JSON.stringify({
          partyId,
          locationId,
          expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate).toISOString() : undefined,
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
        throw new Error(data.error || "Failed to create purchase order");
      }

      setActionSuccess("Purchase order created successfully!");
      setActiveTab("list");
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const openConvertModal = (order: PurchaseOrder) => {
    setSelectedOrder(order);
    setSupplierInvoiceNumber("");
    const initialConvert: Record<string, string> = {};
    for (const l of order.lines) {
      const remaining = Math.max(0, Number(l.quantity) - Number(l.convertedQuantity));
      initialConvert[l.id] = remaining.toString();
    }
    setConvertQuantities(initialConvert);
    setActionError("");
    setActionSuccess("");
  };

  const handleConvert = async () => {
    if (!selectedOrder) return;
    if (!supplierInvoiceNumber.trim()) {
      setActionError("Supplier invoice number / bill reference is required");
      return;
    }

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
      const res = await fetch(`/v1/purchase-orders/${selectedOrder.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken || "" },
        body: JSON.stringify({
          supplierInvoiceNumber: supplierInvoiceNumber.trim(),
          lines: linesToConvert,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to convert purchase order");
      }

      const result = await res.json();
      setActionSuccess(`Purchase order successfully converted to Purchase Bill! New status: ${result.purchaseOrder.status}`);
      await loadData();
      setSelectedOrder(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setConverting(false);
    }
  };

  const filteredOrders = orders.filter((o) => {
    if (filterStatus !== "All" && o.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Purchase Orders (PO)</h1>
          <p className="text-sm text-slate-500">
            Issue purchase orders to suppliers and convert incoming shipments directly into Purchase Bills.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={activeTab === "list" ? "btn-primary" : "btn-secondary"}
            onClick={() => setActiveTab("list")}
          >
            Order List
          </button>
          <button
            className={activeTab === "new" ? "btn-primary" : "btn-secondary"}
            onClick={() => setActiveTab("new")}
          >
            + New Purchase Order
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
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Create New Purchase Order</h2>
          <form onSubmit={handleCreateOrder} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Supplier *</label>
                <select
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white"
                  value={partyId}
                  onChange={(e) => setPartyId(e.target.value)}
                  required
                >
                  <option value="">Select Supplier...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Delivery Location *</label>
                <select
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  required
                >
                  <option value="">Select Warehouse/Branch...</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Expected Delivery</label>
                <input
                  type="date"
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white"
                  value={expectedDeliveryDate}
                  onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Notes</label>
                <input
                  type="text"
                  placeholder="Payment terms, freight instructions"
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold text-slate-700 uppercase">Order Items</h3>
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
                      <th className="p-3 w-36">Unit Cost *</th>
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
                Issue Purchase Order
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
            <span className="text-xs text-slate-500">{filteredOrders.length} purchase orders found</span>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-500 text-sm">Loading purchase orders...</div>
          ) : filteredOrders.length === 0 ? (
            <EmptyState title="No purchase orders found">
              Issue purchase orders to plan procurement and track supplier fulfillment.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600 font-semibold text-xs border-b border-slate-200">
                  <tr>
                    <th className="p-4">PO Number</th>
                    <th className="p-4">Supplier</th>
                    <th className="p-4">Delivery Location</th>
                    <th className="p-4">Date</th>
                    <th className="p-4">Total Amount</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50/75 transition-colors">
                      <td className="p-4 font-mono font-medium text-slate-900">{o.number}</td>
                      <td className="p-4 text-slate-800">{o.party.name}</td>
                      <td className="p-4 text-slate-600">{o.location.name}</td>
                      <td className="p-4 text-slate-500">{new Date(o.createdAt).toLocaleDateString()}</td>
                      <td className="p-4 font-semibold text-slate-900">{formatMoney(o.grandTotal)}</td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            o.status === "Fulfilled"
                              ? "bg-emerald-100 text-emerald-800"
                              : o.status === "PartiallyFulfilled"
                              ? "bg-sky-100 text-sky-800"
                              : o.status === "Accepted"
                              ? "bg-indigo-100 text-indigo-800"
                              : o.status === "Issued"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {o.status}
                        </span>
                      </td>
                      <td className="p-4 text-right space-x-2">
                        {["Draft", "Issued", "Accepted", "PartiallyFulfilled"].includes(o.status) && (
                          <button
                            onClick={() => openConvertModal(o)}
                            className="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700"
                          >
                            Convert to Bill
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

      {/* Convert to Purchase Bill Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Convert {selectedOrder.number} to Purchase Bill
                </h3>
                <p className="text-xs text-slate-500">Supplier: {selectedOrder.party.name}</p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                  Supplier Invoice Number / Bill Ref *
                </label>
                <input
                  type="text"
                  placeholder="e.g. INV-2026-8877"
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white font-medium"
                  value={supplierInvoiceNumber}
                  onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                  required
                />
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-3">Item</th>
                      <th className="p-3 text-right">Ordered</th>
                      <th className="p-3 text-right">Received</th>
                      <th className="p-3 text-right">Remaining</th>
                      <th className="p-3 text-right w-28">Convert Now</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedOrder.lines.map((l) => {
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
              <button type="button" className="btn-secondary" onClick={() => setSelectedOrder(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleConvert}
                disabled={converting}
              >
                {converting ? "Posting Bill..." : "Create & Post Bill"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
