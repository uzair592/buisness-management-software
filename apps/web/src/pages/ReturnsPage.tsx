import { useState, useEffect } from "react";
import { Panel, Button, EmptyState } from "@business/ui";
import { formatMoney } from "@business/domain";
import { useAuth } from "../context/AuthContext";

interface ReturnRecord {
  id: string;
  number: string | null;
  kind: "SaleReturn" | "PurchaseReturn";
  businessDate: string;
  status: "Draft" | "Posted";
  reason: string;
  total: string | null;
  allocatedCredit: string | null;
  refundedAmount: string | null;
  customerCredit: string | null;
  party: { name: string } | null;
  lines: Array<{
    id: string;
    quantity: string;
    total: string;
    disposition: string;
    item: { name: string };
  }>;
}

type DocumentDetail = {
  id: string;
  number?: string | null;
  total?: string | null;
  due?: string | null;
  lines?: Array<{
    id: string;
    itemId?: string;
    unitPrice?: string;
    unitCost?: string;
    quantity?: string;
    item?: { name: string };
    snapshot?: { name?: string; unitPrice?: string; unitCost?: string; quantity?: string };
  }>;
};

export function ReturnsPage() {
  const { authenticated, selectedBusinessId, csrfToken } = useAuth();
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"list" | "new">("list");

  // New return form state
  const [returnKind, setReturnKind] = useState<"SaleReturn" | "PurchaseReturn">("SaleReturn");
  const [originalDocId, setOriginalDocId] = useState("");
  const [reason, setReason] = useState("");
  const [businessDate, setBusinessDate] = useState(new Date().toISOString().slice(0, 10));

  // Original document detail
  const [originalDoc, setOriginalDoc] = useState<DocumentDetail | null>(null);
  const [lineQuantities, setLineQuantities] = useState<Record<string, string>>({});
  const [lineDispositions, setLineDispositions] = useState<Record<string, string>>({});

  // Settlement
  const [allocToDue, setAllocToDue] = useState("0.00");
  const [customerCredit, setCustomerCredit] = useState("0.00");
  const [refundAmount, setRefundAmount] = useState("0.00");
  const [refundAccountId, setRefundAccountId] = useState("");
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; kind: string }>>([]);

  const [posting, setPosting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const loadReturns = async () => {
    if (!authenticated || !selectedBusinessId) return;
    setLoading(true);
    try {
      const res = await fetch("/v1/returns");
      if (res.ok) {
        setReturns(await res.json());
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const loadAccounts = async () => {
    try {
      const res = await fetch("/v1/accounts/setup");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts?.filter((a: { kind?: string }) => a.kind === "Cash" || a.kind === "Bank") ?? []);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadReturns();
    loadAccounts();
  }, [authenticated, selectedBusinessId]);

  const fetchOriginalDoc = async () => {
    if (!originalDocId.trim()) return;
    setErrorMsg("");
    try {
      const url = returnKind === "SaleReturn"
        ? `/v1/sales/documents/${originalDocId.trim()}`
        : `/v1/purchases/documents/${originalDocId.trim()}`;
      const res = await fetch(url);
      if (!res.ok) {
        setErrorMsg("Original document not found. Verify the document UUID.");
        setOriginalDoc(null);
        return;
      }
      const data = await res.json();
      setOriginalDoc(data);

      // Default quantities
      const initQty: Record<string, string> = {};
      const initDisp: Record<string, string> = {};
      for (const line of data.lines || []) {
        initQty[line.id] = "0";
        initDisp[line.id] = "Restocked";
      }
      setLineQuantities(initQty);
      setLineDispositions(initDisp);
      setAllocToDue("0.00");
      setCustomerCredit("0.00");
      setRefundAmount("0.00");
    } catch {
      setErrorMsg("Failed to load original document");
    }
  };

  const updateLineQty = (lineId: string, val: string) => {
    const updated = { ...lineQuantities, [lineId]: val };
    setLineQuantities(updated);

    if (originalDoc) {
      let total = 0;
      for (const line of originalDoc.lines || []) {
        const q = Number(updated[line.id] || 0);
        const p = Number(line.unitPrice || line.snapshot?.unitPrice || line.unitCost || line.snapshot?.unitCost || 0);
        total += q * p;
      }
      const origDue = Number(originalDoc.due || 0);
      const toDue = Math.min(total, origDue);
      setAllocToDue(toDue.toFixed(2));
      setCustomerCredit(Math.max(0, total - toDue).toFixed(2));
      setRefundAmount("0.00");
    }
  };

  const getCsrf = async () => {
    if (csrfToken) return csrfToken;
    try {
      const res = await fetch("/v1/auth/me");
      if (res.ok) {
        const data = await res.json();
        return data.csrfToken || "";
      }
    } catch {
      // ignore
    }
    return "";
  };

  const handlePostReturn = async () => {
    if (!originalDoc) return;
    setErrorMsg("");
    setSuccessMsg("");
    setPosting(true);

    try {
      const token = await getCsrf();
      const commandId = crypto.randomUUID();
      const draftId = crypto.randomUUID();

      const activeLines = Object.entries(lineQuantities)
        .filter(([_, q]) => Number(q) > 0)
        .map(([origLineId, q]) => ({
          id: crypto.randomUUID(),
          originalLineId: origLineId,
          quantity: q,
          ...(returnKind === "SaleReturn" ? { disposition: lineDispositions[origLineId] || "Restocked" } : {}),
        }));

      if (!activeLines.length) {
        setErrorMsg("Enter a return quantity greater than 0 for at least one line.");
        setPosting(false);
        return;
      }

      if (returnKind === "SaleReturn") {
        const payload = {
          id: draftId,
          commandId,
          originalSaleId: originalDoc.id,
          reason: reason || "Customer return",
          businessDate,
          lines: activeLines,
          settlement: {
            allocateToDue: Number(allocToDue || 0).toFixed(2),
            customerCredit: Number(customerCredit || 0).toFixed(2),
            refund: Number(refundAmount) > 0 && refundAccountId ? {
              accountId: refundAccountId,
              kind: accounts.find(a => a.id === refundAccountId)?.kind || "Cash",
              amount: Number(refundAmount).toFixed(2),
              reference: null,
            } : null,
          },
        };

        const draftRes = await fetch("/v1/returns/sales/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-csrf-token": token },
          body: JSON.stringify(payload),
        });

        if (!draftRes.ok) {
          const err = await draftRes.json();
          console.error("Return draft error:", err);
          setErrorMsg(err.error || err.message || "Failed to create return draft");
          setPosting(false);
          return;
        }

        const postRes = await fetch(`/v1/returns/sales/${draftId}/post`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({ commandId }),
        });

        if (!postRes.ok) {
          const err = await postRes.json();
          console.error("Return post error:", err);
          setErrorMsg(err.error || err.message || "Failed to post credit note");
          setPosting(false);
          return;
        }

        const posted = await postRes.json();
        setSuccessMsg(`Credit Note ${posted.number} successfully posted!`);
      } else {
        const payload = {
          id: draftId,
          commandId,
          originalPurchaseId: originalDoc.id,
          reason: reason || "Supplier return",
          businessDate,
          lines: activeLines,
        };

        const draftRes = await fetch("/v1/returns/purchases/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-csrf-token": token },
          body: JSON.stringify(payload),
        });

        if (!draftRes.ok) {
          const err = await draftRes.json();
          console.error("Debit draft error:", err);
          setErrorMsg(err.error || err.message || "Failed to create debit note draft");
          setPosting(false);
          return;
        }

        const postRes = await fetch(`/v1/returns/purchases/${draftId}/post`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({ commandId }),
        });

        if (!postRes.ok) {
          const err = await postRes.json();
          console.error("Debit post error:", err);
          setErrorMsg(err.error || err.message || "Failed to post debit note");
          setPosting(false);
          return;
        }

        const posted = await postRes.json();
        setSuccessMsg(`Debit Note ${posted.number} successfully posted!`);
      }

      await loadReturns();
      setActiveTab("list");
      setOriginalDoc(null);
    } catch {
      setErrorMsg("An unexpected error occurred while posting return");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-heading">
        <div>
          <h1>Returns & Credits</h1>
          <p className="muted">Customer credit notes, supplier debit notes, and refunds</p>
        </div>
        <div className="actions-cluster">
          <Button
            className={activeTab === "list" ? "btn-primary" : "btn-secondary"}
            onClick={() => setActiveTab("list")}
          >
            Return History
          </Button>
          <Button
            className={activeTab === "new" ? "btn-primary" : "btn-secondary"}
            onClick={() => setActiveTab("new")}
          >
            + New Return
          </Button>
        </div>
      </div>

      {errorMsg && <div className="alert alert-danger" style={{ marginBottom: "1rem" }}>{errorMsg}</div>}
      {successMsg && <div className="alert alert-success" style={{ marginBottom: "1rem" }}>{successMsg}</div>}

      {activeTab === "list" ? (
        <Panel>
          {loading ? (
            <p className="muted">Loading returns…</p>
          ) : returns.length === 0 ? (
            <EmptyState title="No returns recorded yet">
              <p>Record customer sales returns or supplier purchase returns with full accounting and stock restitution.</p>
            </EmptyState>
          ) : (
            <table className="table" style={{ width: "100%", textAlign: "left" }}>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Date</th>
                  <th>Kind</th>
                  <th>Party</th>
                  <th>Total</th>
                  <th>Allocated Due</th>
                  <th>Refund</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((ret) => (
                  <tr key={ret.id}>
                    <td><b>{ret.number || "Draft"}</b></td>
                    <td>{ret.businessDate ? new Date(ret.businessDate).toLocaleDateString() : "—"}</td>
                    <td>
                      <span className={`badge ${ret.kind === "SaleReturn" ? "badge-info" : "badge-warning"}`}>
                        {ret.kind === "SaleReturn" ? "Customer Return (CN)" : "Supplier Return (DN)"}
                      </span>
                    </td>
                    <td>{ret.party?.name || "Walk-in Customer"}</td>
                    <td><b>PKR {ret.total ? formatMoney(ret.total) : "0.00"}</b></td>
                    <td>{ret.allocatedCredit ? formatMoney(ret.allocatedCredit) : "—"}</td>
                    <td>{ret.refundedAmount && Number(ret.refundedAmount) > 0 ? formatMoney(ret.refundedAmount) : "—"}</td>
                    <td><span className="badge badge-success">{ret.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      ) : (
        <Panel>
          <h2>Create Return Note</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "1rem" }}>
            <label>
              Return Type
              <select
                className="input"
                value={returnKind}
                onChange={(e) => {
                  setReturnKind(e.target.value as "SaleReturn" | "PurchaseReturn");
                  setOriginalDoc(null);
                }}
              >
                <option value="SaleReturn">Customer Return (Credit Note)</option>
                <option value="PurchaseReturn">Supplier Return (Debit Note)</option>
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
          </div>

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", alignItems: "flex-end" }}>
            <label style={{ flexGrow: 1 }}>
              Original Document UUID
              <input
                className="input"
                placeholder="Paste original Sale or Purchase UUID…"
                value={originalDocId}
                onChange={(e) => setOriginalDocId(e.target.value)}
              />
            </label>
            <Button className="btn-secondary" onClick={fetchOriginalDoc}>
              Load Document
            </Button>
          </div>

          {originalDoc && (
            <div style={{ marginTop: "1.5rem" }}>
              <h3>Original Invoice: {originalDoc.number || originalDoc.id}</h3>
              <p className="muted">
                Total: PKR {formatMoney(originalDoc.total || "0.00")} · Due: PKR {formatMoney(originalDoc.due || "0.00")}
              </p>

              <h4 style={{ marginTop: "1rem" }}>Select Lines to Return</h4>
              <table className="table" style={{ width: "100%", marginTop: "0.5rem" }}>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Price/Cost</th>
                    <th>Return Quantity</th>
                    {returnKind === "SaleReturn" && <th>Disposition</th>}
                  </tr>
                </thead>
                <tbody>
                  {(originalDoc.lines || []).map((line) => (
                    <tr key={line.id}>
                      <td>
                        <b>{line.item?.name || line.snapshot?.name || "Item"}</b>
                        <br />
                        <small className="muted">Sold/Purchased: {line.quantity || line.snapshot?.quantity}</small>
                      </td>
                      <td>PKR {formatMoney(line.unitPrice || line.snapshot?.unitPrice || line.unitCost || line.snapshot?.unitCost || "0.00")}</td>
                      <td>
                        <input
                          className="input"
                          style={{ width: "100px" }}
                          type="number"
                          step="0.000001"
                          min="0"
                          value={lineQuantities[line.id] || "0"}
                          onChange={(e) => updateLineQty(line.id, e.target.value)}
                        />
                      </td>
                      {returnKind === "SaleReturn" && (
                        <td>
                          <select
                            className="input"
                            value={lineDispositions[line.id] || "Restocked"}
                            onChange={(e) =>
                              setLineDispositions({ ...lineDispositions, [line.id]: e.target.value })
                            }
                          >
                            <option value="Restocked">Restocked (Restore Sellable Stock)</option>
                            <option value="Damaged">Damaged / Scrapped (No Stock Added)</option>
                          </select>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              {returnKind === "SaleReturn" && (
                <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                  <h4>Settlement Distribution</h4>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginTop: "0.5rem" }}>
                    <label>
                      Allocate to Unpaid Due
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        value={allocToDue}
                        onChange={(e) => setAllocToDue(e.target.value)}
                      />
                    </label>
                    <label>
                      Customer Credit (On Account)
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        value={customerCredit}
                        onChange={(e) => setCustomerCredit(e.target.value)}
                      />
                    </label>
                    <label>
                      Cash / Bank Refund Amount
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        value={refundAmount}
                        onChange={(e) => setRefundAmount(e.target.value)}
                      />
                    </label>
                  </div>

                  {Number(refundAmount) > 0 && (
                    <label style={{ display: "block", marginTop: "0.5rem" }}>
                      Refund Payment Account
                      <select
                        className="input"
                        value={refundAccountId}
                        onChange={(e) => setRefundAccountId(e.target.value)}
                      >
                        <option value="">Select cash till or bank account…</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.kind})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}

              <label style={{ display: "block", marginTop: "1rem" }}>
                Reason for Return
                <textarea
                  className="input"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Broken item, customer changed specification, wrong dispatch…"
                />
              </label>

              <div style={{ marginTop: "1.5rem", display: "flex", gap: "1rem" }}>
                <Button
                  className="btn-primary"
                  disabled={posting}
                  onClick={handlePostReturn}
                >
                  {posting ? "Posting…" : "Post Return Note (Ctrl+Enter)"}
                </Button>
                <Button className="btn-secondary" onClick={() => setActiveTab("list")}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
