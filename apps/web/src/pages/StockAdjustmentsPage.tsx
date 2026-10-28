import { useState, useEffect } from "react";
import { Panel, Button, EmptyState } from "@business/ui";
import { formatMoney } from "@business/domain";
import { useAuth } from "../context/AuthContext";

function formatSignedMoney(value: string | null | undefined): string {
  if (!value) return "0.00";
  const negative = value.startsWith("-");
  const raw = negative ? value.slice(1) : value;
  return `${negative ? "-" : ""}${formatMoney(raw)}`;
}

interface StockAdjustmentRecord {
  id: string;
  number: string | null;
  adjustmentKind: "CountVariance" | "Damage" | "Loss" | "Surplus" | "Correction";
  businessDate: string;
  status: "Draft" | "Posted";
  quantityDelta: string;
  countedQuantity: string | null;
  systemQuantity: string | null;
  unitCost: string;
  totalCostDelta: string;
  reason: string;
  item: { name: string; sku: string | null };
  location: { name: string; code: string };
}

interface DeficitRecord {
  id: string;
  status: "Open" | "Settled";
  provisionalUnitCost: string;
  sourceEvent: {
    businessDate: string;
    sourceType: string;
    sourceId: string;
  };
}

export function StockAdjustmentsPage() {
  const { authenticated, selectedBusinessId, csrfToken } = useAuth();
  const [adjustments, setAdjustments] = useState<StockAdjustmentRecord[]>([]);
  const [deficits, setDeficits] = useState<DeficitRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"list" | "new" | "deficits">("list");

  // Options
  const [items, setItems] = useState<Array<{ id: string; name: string; sku: string | null; kind: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; code: string }>>([]);

  // New adjustment form state
  const [locationId, setLocationId] = useState("");
  const [itemId, setItemId] = useState("");
  const [adjustmentKind, setAdjustmentKind] = useState<"CountVariance" | "Damage" | "Loss" | "Surplus" | "Correction">("CountVariance");
  const [countedQty, setCountedQty] = useState("");
  const [systemQty, setSystemQty] = useState("");
  const [quantityDelta, setQuantityDelta] = useState("");
  const [unitCost, setUnitCost] = useState("0.00");
  const [reason, setReason] = useState("");
  const [businessDate, setBusinessDate] = useState(new Date().toISOString().slice(0, 10));

  const [posting, setPosting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const loadData = async () => {
    if (!authenticated || !selectedBusinessId) return;
    setLoading(true);
    try {
      const [adjRes, defRes, wsRes, locRes] = await Promise.all([
        fetch("/v1/stock/adjustments"),
        fetch("/v1/stock/deficits"),
        fetch("/v1/sales/workspace"),
        fetch("/v1/locations"),
      ]);

      if (adjRes.ok) {
        setAdjustments(await adjRes.json());
      }
      if (defRes.ok) {
        setDeficits(await defRes.json());
      }
      if (wsRes.ok) {
        const ws = await wsRes.json();
        const goodsItems = (ws.items || []).filter((i: { kind?: string }) => i.kind === "Goods");
        setItems(goodsItems);
        if (goodsItems[0] && !itemId) setItemId(goodsItems[0].id);
      }
      if (locRes.ok) {
        const locs = await locRes.json();
        setLocations(locs);
        if (locs[0] && !locationId) setLocationId(locs[0].id);
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

  // Recalculate delta when counted/system change in CountVariance mode
  const handleCountChange = (counted: string, system: string) => {
    setCountedQty(counted);
    setSystemQty(system);
    if (counted.trim() !== "" && system.trim() !== "") {
      const c = Number(counted);
      const s = Number(system);
      if (!isNaN(c) && !isNaN(s)) {
        const delta = c - s;
        setQuantityDelta(delta.toString());
      }
    }
  };

  const handlePostAdjustment = async () => {
    setErrorMsg("");
    setSuccessMsg("");

    const effectiveLocationId = locationId || locations[0]?.id;
    const effectiveItemId = itemId || items[0]?.id;

    if (!effectiveLocationId || !effectiveItemId) {
      setErrorMsg("Please select both a location and an inventory item.");
      return;
    }

    const deltaNum = Number(quantityDelta);
    if (isNaN(deltaNum) || deltaNum === 0) {
      setErrorMsg("Quantity delta cannot be zero.");
      return;
    }

    if (Number(unitCost) <= 0) {
      setErrorMsg("Unit cost must be greater than zero for inventory adjustment valuation.");
      return;
    }

    if (!reason.trim()) {
      setErrorMsg("Reason is required for audit and stock reconciliation.");
      return;
    }

    setPosting(true);
    try {
      let token = csrfToken;
      if (!token) {
        try {
          const me = await fetch("/v1/auth/me").then((r) => r.json());
          token = me.csrfToken || "";
        } catch {
          // ignore
        }
      }

      const draftId = crypto.randomUUID();
      const commandId = crypto.randomUUID();

      const payload = {
        id: draftId,
        commandId,
        locationId: effectiveLocationId,
        itemId: effectiveItemId,
        adjustmentKind,
        countedQuantity: countedQty.trim() ? countedQty.trim() : null,
        systemQuantity: systemQty.trim() ? systemQty.trim() : null,
        quantityDelta: quantityDelta.trim(),
        unitCost: Number(unitCost).toFixed(2),
        reason: reason.trim(),
        businessDate,
      };

      const draftRes = await fetch("/v1/stock/adjustments/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": token || "" },
        body: JSON.stringify(payload),
      });

      if (!draftRes.ok) {
        const err = await draftRes.json();
        console.error("Draft error response:", err);
        setErrorMsg(err.error || err.message || "Failed to create stock adjustment draft");
        setPosting(false);
        return;
      }

      const postRes = await fetch(`/v1/stock/adjustments/${draftId}/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": token || "" },
        body: JSON.stringify({ commandId }),
      });

      if (!postRes.ok) {
        const err = await postRes.json();
        console.error("Post error response:", err);
        setErrorMsg(err.error || err.message || "Failed to post stock adjustment");
        setPosting(false);
        return;
      }

      const posted = await postRes.json();
      setSuccessMsg(`Stock Adjustment ${posted.id.slice(0, 8)} successfully posted!`);
      await loadData();
      setActiveTab("list");
      setQuantityDelta("");
      setCountedQty("");
      setSystemQty("");
      setReason("");
    } catch {
      setErrorMsg("Unexpected error while posting stock adjustment");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-heading">
        <div>
          <h1>Stock Adjustments & Counts</h1>
          <p className="muted">Stock count variances, physical damage/loss write-offs, and provisional deficit settlement</p>
        </div>
        <div className="actions-cluster">
          <Button
            className={activeTab === "list" ? "btn-primary" : "btn-secondary"}
            onClick={() => setActiveTab("list")}
          >
            Adjustments History
          </Button>
          <Button
            className={activeTab === "new" ? "btn-primary" : "btn-secondary"}
            onClick={() => setActiveTab("new")}
          >
            + New Stock Adjustment
          </Button>
          <Button
            className={activeTab === "deficits" ? "btn-primary" : "btn-secondary"}
            onClick={() => setActiveTab("deficits")}
          >
            Provisional Deficits ({deficits.length})
          </Button>
        </div>
      </div>

      {errorMsg && <div className="alert alert-danger" style={{ marginBottom: "1rem" }}>{errorMsg}</div>}
      {successMsg && <div className="alert alert-success" style={{ marginBottom: "1rem" }}>{successMsg}</div>}

      {activeTab === "list" && (
        <Panel>
          {loading ? (
            <p className="muted">Loading adjustments…</p>
          ) : adjustments.length === 0 ? (
            <EmptyState title="No stock adjustments recorded">
              <p>Physical stock counts, damage write-offs, and inventory variances will appear here.</p>
            </EmptyState>
          ) : (
            <table className="table" style={{ width: "100%", textAlign: "left" }}>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Date</th>
                  <th>Kind</th>
                  <th>Item</th>
                  <th>Location</th>
                  <th>Delta Qty</th>
                  <th>Unit Cost</th>
                  <th>Total Impact</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((adj) => {
                  const isNegative = adj.quantityDelta.startsWith("-");
                  return (
                    <tr key={adj.id}>
                      <td><b>{adj.id.slice(0, 8)}</b></td>
                      <td>{adj.businessDate ? new Date(adj.businessDate).toLocaleDateString() : "—"}</td>
                      <td>
                        <span className={`badge ${isNegative ? "badge-warning" : "badge-info"}`}>
                          {adj.adjustmentKind}
                        </span>
                      </td>
                      <td>
                        <b>{adj.item.name}</b>
                        {adj.item.sku && <small className="muted"> ({adj.item.sku})</small>}
                      </td>
                      <td>{adj.location.name}</td>
                      <td style={{ color: isNegative ? "#dc2626" : "#16a34a", fontWeight: "bold" }}>
                        {adj.quantityDelta}
                      </td>
                      <td>PKR {formatMoney(adj.unitCost)}</td>
                      <td>PKR {formatSignedMoney(adj.totalCostDelta)}</td>
                      <td><span className="badge badge-success">{adj.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {activeTab === "new" && (
        <Panel>
          <h2>Record Stock Count / Adjustment</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "1rem" }}>
            <label>
              Location
              <select
                className="input"
                value={locationId || locations[0]?.id || ""}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} ({loc.code})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Inventory Item (Goods only)
              <select
                className="input"
                value={itemId || items[0]?.id || ""}
                onChange={(e) => setItemId(e.target.value)}
              >
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name} {it.sku ? `(${it.sku})` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Adjustment Kind
              <select
                className="input"
                value={adjustmentKind}
                onChange={(e) =>
                  setAdjustmentKind(
                    e.target.value as "CountVariance" | "Damage" | "Loss" | "Surplus" | "Correction",
                  )
                }
              >
                <option value="CountVariance">Physical Count Variance</option>
                <option value="Damage">Damage / Spoilage</option>
                <option value="Loss">Theft / Loss</option>
                <option value="Surplus">Surplus Found</option>
                <option value="Correction">Data Correction</option>
              </select>
            </label>

            <label>
              Business Date
              <input
                className="input"
                type="date"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
              />
            </label>

            {adjustmentKind === "CountVariance" && (
              <>
                <label>
                  Counted Physical Quantity
                  <input
                    className="input"
                    type="number"
                    step="0.000001"
                    placeholder="e.g. 48"
                    value={countedQty}
                    onChange={(e) => handleCountChange(e.target.value, systemQty)}
                  />
                </label>

                <label>
                  System Expected Quantity
                  <input
                    className="input"
                    type="number"
                    step="0.000001"
                    placeholder="e.g. 50"
                    value={systemQty}
                    onChange={(e) => handleCountChange(countedQty, e.target.value)}
                  />
                </label>
              </>
            )}

            <label>
              Quantity Delta (Negative = Shortage/Loss, Positive = Gain)
              <input
                className="input"
                type="number"
                step="0.000001"
                placeholder="e.g. -2 or 5"
                value={quantityDelta}
                onChange={(e) => setQuantityDelta(e.target.value)}
              />
            </label>

            <label>
              Unit Valuation Cost (PKR)
              <input
                className="input"
                type="number"
                step="0.01"
                placeholder="100.00"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
              />
            </label>
          </div>

          <label style={{ display: "block", marginTop: "1rem" }}>
            Reason / Justification
            <textarea
              className="input"
              rows={2}
              placeholder="e.g. Monthly physical stock audit; broken packaging discovered in aisle 3"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>

          <div style={{ marginTop: "1.5rem" }}>
            <Button
              className="btn-primary"
              disabled={posting}
              onClick={handlePostAdjustment}
            >
              {posting ? "Posting Adjustment…" : "Post Stock Adjustment"}
            </Button>
          </div>
        </Panel>
      )}

      {activeTab === "deficits" && (
        <Panel>
          <h2>Provisional Negative Stock Deficits</h2>
          <p className="muted" style={{ marginBottom: "1rem" }}>
            When sales occur with negative or zero stock, costs are provisionally recorded and resolved deterministically upon subsequent stock receipts.
          </p>

          {loading ? (
            <p className="muted">Loading deficits…</p>
          ) : deficits.length === 0 ? (
            <EmptyState title="No open provisional deficits">
              <p>All historic sales and issues have verified resolved inward valuation.</p>
            </EmptyState>
          ) : (
            <table className="table" style={{ width: "100%", textAlign: "left" }}>
              <thead>
                <tr>
                  <th>Deficit ID</th>
                  <th>Source Date</th>
                  <th>Source Event</th>
                  <th>Provisional Cost</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {deficits.map((def) => (
                  <tr key={def.id}>
                    <td><code>{def.id.slice(0, 8)}…</code></td>
                    <td>{def.sourceEvent?.businessDate ? new Date(def.sourceEvent.businessDate).toLocaleDateString() : "—"}</td>
                    <td>{def.sourceEvent?.sourceType || "Sale"}</td>
                    <td>PKR {formatMoney(def.provisionalUnitCost)}</td>
                    <td><span className="badge badge-warning">{def.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}
    </div>
  );
}
