import { useState, useEffect } from "react";
import { Panel, EmptyState } from "@business/ui";
import { useAuth } from "../context/AuthContext";

interface TransferLine {
  id: string;
  itemId: string;
  dispatchedQuantity: string;
  receivedQuantity: string;
  lossQuantity: string;
  lossReason: string | null;
  unitCost: string;
  lineCost: string;
  item: { id: string; name: string; sku: string | null };
}

interface StockTransfer {
  id: string;
  number: string;
  sourceLocationId: string;
  sourceLocation: { id: string; name: string };
  destinationLocationId: string;
  destinationLocation: { id: string; name: string };
  status: "Draft" | "Dispatched" | "PartiallyReceived" | "Completed" | "Cancelled";
  dispatchedAt: string | null;
  receivedAt: string | null;
  notes: string | null;
  createdAt: string;
  lines: TransferLine[];
}

interface DispatchLineDraft {
  itemId: string;
  quantity: string;
}

interface ReceiveLineInput {
  receivedQuantity: string;
  lossQuantity: string;
  lossReason: string;
}

export function StockTransfersPage() {
  const { authenticated, selectedBusinessId, csrfToken } = useAuth();
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"list" | "new">("list");
  const [filterStatus, setFilterStatus] = useState<string>("All");

  // Catalogue
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<Array<{ id: string; name: string }>>([]);

  // Form State
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DispatchLineDraft[]>([
    { itemId: "", quantity: "1" },
  ]);

  // Receive Modal State
  const [selectedTransfer, setSelectedTransfer] = useState<StockTransfer | null>(null);
  const [receiveInputs, setReceiveInputs] = useState<Record<string, ReceiveLineInput>>({});
  const [receiving, setReceiving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  const loadData = async () => {
    if (!authenticated || !selectedBusinessId) return;
    setLoading(true);
    try {
      const [trRes, locRes, wsRes] = await Promise.all([
        fetch("/v1/stock/transfers", { credentials: "include" }),
        fetch("/v1/locations", { credentials: "include" }),
        fetch("/v1/sales/workspace", { credentials: "include" }),
      ]);

      if (trRes.ok) {
        setTransfers(await trRes.json());
      }
      if (locRes.ok) {
        const locs = await locRes.json();
        setLocations(locs);
        if (locs.length >= 2) {
          if (!sourceLocationId) setSourceLocationId(locs[0].id);
          if (!destinationLocationId) setDestinationLocationId(locs[1].id);
        } else if (locs.length === 1 && !sourceLocationId) {
          setSourceLocationId(locs[0].id);
        }
      }
      if (wsRes.ok) {
        const ws = await wsRes.json();
        const goodsItems = (ws.items || []).filter((i: { kind?: string }) => i.kind === "Goods");
        setItems(goodsItems);
        if (goodsItems[0] && !lines[0]?.itemId) {
          setLines([{ itemId: goodsItems[0].id, quantity: "1" }]);
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
      },
    ]);
  };

  const removeLine = (index: number) => {
    if (lines.length > 1) {
      setLines(lines.filter((_, i) => i !== index));
    }
  };

  const updateLine = (index: number, field: keyof DispatchLineDraft, value: string) => {
    const next = [...lines];
    const current = { ...next[index]! };
    current[field] = value;
    next[index] = current;
    setLines(next);
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError("");
    setActionSuccess("");

    if (!sourceLocationId || !destinationLocationId) {
      setActionError("Please select both source and destination warehouses");
      return;
    }
    if (sourceLocationId === destinationLocationId) {
      setActionError("Source and destination warehouses must be distinct");
      return;
    }
    if (lines.length === 0 || lines.some((l) => !l.itemId || Number(l.quantity) <= 0)) {
      setActionError("All lines must specify an item and positive quantity");
      return;
    }

    try {
      const res = await fetch("/v1/stock/transfers/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken || "" },
        body: JSON.stringify({
          sourceLocationId,
          destinationLocationId,
          notes: notes.trim() || undefined,
          lines: lines.map((l) => ({
            itemId: l.itemId,
            quantity: l.quantity,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to dispatch stock transfer");
      }

      setActionSuccess("Stock transfer dispatched successfully! In-transit tracking active.");
      setActiveTab("list");
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const openReceiveModal = (transfer: StockTransfer) => {
    setSelectedTransfer(transfer);
    const initialInputs: Record<string, ReceiveLineInput> = {};
    for (const l of transfer.lines) {
      const total = Number(l.dispatchedQuantity);
      const rec = Number(l.receivedQuantity);
      const loss = Number(l.lossQuantity);
      const remaining = Math.max(0, total - (rec + loss));
      initialInputs[l.id] = {
        receivedQuantity: remaining.toString(),
        lossQuantity: "0",
        lossReason: "",
      };
    }
    setReceiveInputs(initialInputs);
    setActionError("");
    setActionSuccess("");
  };

  const handleReceive = async () => {
    if (!selectedTransfer) return;
    setReceiving(true);
    setActionError("");
    setActionSuccess("");

    const linesToReceive = Object.entries(receiveInputs)
      .filter(([_, input]) => Number(input.receivedQuantity) > 0 || Number(input.lossQuantity) > 0)
      .map(([lineId, input]) => {
        if (Number(input.lossQuantity) > 0 && !input.lossReason.trim()) {
          throw new Error("Loss / damage reason is mandatory when reporting transit loss");
        }
        return {
          lineId,
          receivedQuantity: input.receivedQuantity || "0",
          lossQuantity: input.lossQuantity || "0",
          lossReason: input.lossReason.trim() || undefined,
        };
      });

    if (linesToReceive.length === 0) {
      setActionError("Please enter received or lost quantity for at least one line");
      setReceiving(false);
      return;
    }

    try {
      const res = await fetch(`/v1/stock/transfers/${selectedTransfer.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken || "" },
        body: JSON.stringify({
          lines: linesToReceive,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to record transfer receipt");
      }

      const result = await res.json();
      setActionSuccess(`Transfer receipt recorded successfully! Status: ${result.status}`);
      await loadData();
      setSelectedTransfer(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setReceiving(false);
    }
  };

  const filteredTransfers = transfers.filter((t) => {
    if (filterStatus !== "All" && t.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Inter-Warehouse Stock Transfers</h1>
          <p className="text-sm text-slate-500">
            Dispatch inventory between locations with full goods-in-transit reconciliation, partial receipts, and transit damage logging.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={activeTab === "list" ? "btn-primary" : "btn-secondary"}
            onClick={() => setActiveTab("list")}
          >
            Transfer List
          </button>
          <button
            className={activeTab === "new" ? "btn-primary" : "btn-secondary"}
            onClick={() => setActiveTab("new")}
          >
            + Dispatch Transfer
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
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Dispatch Inventory Transfer</h2>
          <form onSubmit={handleDispatch} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Source Warehouse (Out) *</label>
                <select
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white"
                  value={sourceLocationId}
                  onChange={(e) => setSourceLocationId(e.target.value)}
                  required
                >
                  <option value="">Select origin...</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Destination Warehouse (In) *</label>
                <select
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white"
                  value={destinationLocationId}
                  onChange={(e) => setDestinationLocationId(e.target.value)}
                  required
                >
                  <option value="">Select destination...</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Transfer Notes</label>
                <input
                  type="text"
                  placeholder="Vehicle number, driver name, shipment ref"
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold text-slate-700 uppercase">Items to Transfer</h3>
                <button type="button" className="btn-secondary" onClick={addLine}>
                  + Add Line
                </button>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600 font-semibold text-xs border-b border-slate-200">
                    <tr>
                      <th className="p-3">Goods Item *</th>
                      <th className="p-3 w-40">Quantity to Transfer *</th>
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
                Dispatch Transfer
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
                <option value="Dispatched">In Transit (Dispatched)</option>
                <option value="PartiallyReceived">Partially Received</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
            <span className="text-xs text-slate-500">{filteredTransfers.length} transfers found</span>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-500 text-sm">Loading stock transfers...</div>
          ) : filteredTransfers.length === 0 ? (
            <EmptyState title="No transfers found">
              Dispatch stock between your warehouses or branches to restock inventory.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600 font-semibold text-xs border-b border-slate-200">
                  <tr>
                    <th className="p-4">Transfer #</th>
                    <th className="p-4">Source Warehouse</th>
                    <th className="p-4">Destination</th>
                    <th className="p-4">Dispatched At</th>
                    <th className="p-4">Items Count</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTransfers.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/75 transition-colors">
                      <td className="p-4 font-mono font-medium text-slate-900">{t.number}</td>
                      <td className="p-4 text-slate-800">{t.sourceLocation.name}</td>
                      <td className="p-4 text-slate-800">{t.destinationLocation.name}</td>
                      <td className="p-4 text-slate-500">
                        {t.dispatchedAt ? new Date(t.dispatchedAt).toLocaleDateString() : "-"}
                      </td>
                      <td className="p-4 text-slate-600">{t.lines.length} lines</td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            t.status === "Completed"
                              ? "bg-emerald-100 text-emerald-800"
                              : t.status === "PartiallyReceived"
                              ? "bg-sky-100 text-sky-800"
                              : t.status === "Dispatched"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {t.status === "Dispatched" ? "In Transit" : t.status}
                        </span>
                      </td>
                      <td className="p-4 text-right space-x-2">
                        {["Dispatched", "PartiallyReceived"].includes(t.status) && (
                          <button
                            onClick={() => openReceiveModal(t)}
                            className="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700"
                          >
                            Receive Goods
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

      {/* Receive Goods Modal */}
      {selectedTransfer && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Receive Transfer: {selectedTransfer.number}
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedTransfer.sourceLocation.name} → {selectedTransfer.destinationLocation.name}
                </p>
              </div>
              <button
                onClick={() => setSelectedTransfer(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-slate-600">
                Verify physical goods received at the destination warehouse. If any items were lost or damaged in transit, record them with an approved reason.
              </p>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-3">Item</th>
                      <th className="p-3 text-right">Dispatched</th>
                      <th className="p-3 text-right">Prior Received</th>
                      <th className="p-3 text-right">In-Transit</th>
                      <th className="p-3 text-right w-24">Receive Qty</th>
                      <th className="p-3 text-right w-24">Loss Qty</th>
                      <th className="p-3 w-40">Loss Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedTransfer.lines.map((l) => {
                      const total = Number(l.dispatchedQuantity);
                      const rec = Number(l.receivedQuantity);
                      const loss = Number(l.lossQuantity);
                      const inTransit = Math.max(0, total - (rec + loss));
                      const input = receiveInputs[l.id] || {
                        receivedQuantity: inTransit.toString(),
                        lossQuantity: "0",
                        lossReason: "",
                      };

                      return (
                        <tr key={l.id}>
                          <td className="p-3 font-medium text-slate-900">{l.item.name}</td>
                          <td className="p-3 text-right text-slate-600">{l.dispatchedQuantity}</td>
                          <td className="p-3 text-right text-slate-600">{l.receivedQuantity}</td>
                          <td className="p-3 text-right font-semibold text-slate-800">{inTransit}</td>
                          <td className="p-3 text-right">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              max={inTransit}
                              disabled={inTransit === 0}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-right text-xs bg-white font-medium"
                              value={input.receivedQuantity}
                              onChange={(e) =>
                                setReceiveInputs({
                                  ...receiveInputs,
                                  [l.id]: { ...input, receivedQuantity: e.target.value },
                                })
                              }
                            />
                          </td>
                          <td className="p-3 text-right">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              max={inTransit}
                              disabled={inTransit === 0}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-right text-xs bg-white font-medium"
                              value={input.lossQuantity}
                              onChange={(e) =>
                                setReceiveInputs({
                                  ...receiveInputs,
                                  [l.id]: { ...input, lossQuantity: e.target.value },
                                })
                              }
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="text"
                              placeholder="Reason if loss > 0"
                              disabled={Number(input.lossQuantity) <= 0}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-xs bg-white"
                              value={input.lossReason}
                              onChange={(e) =>
                                setReceiveInputs({
                                  ...receiveInputs,
                                  [l.id]: { ...input, lossReason: e.target.value },
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
              <button type="button" className="btn-secondary" onClick={() => setSelectedTransfer(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleReceive}
                disabled={receiving}
              >
                {receiving ? "Processing..." : "Confirm Receipt & Post"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
