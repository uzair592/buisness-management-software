import { useState, useEffect } from "react";
import { Panel, Button, EmptyState } from "@business/ui";
import { formatMoney } from "@business/domain";
import { useAuth } from "../context/AuthContext";

interface PaymentRecord {
  id: string;
  commandId: string;
  number: string | null;
  paymentKind: "PaymentIn" | "PaymentOut";
  partyId: string;
  partyName?: string;
  accountId: string;
  accountName?: string;
  accountKind?: string;
  amount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  reference: string | null;
  note: string | null;
  status: "Draft" | "Posted";
  businessDate: string;
  createdAt: string;
  postedAt: string | null;
  allocations: {
    id: string;
    saleDocumentId?: string | null;
    purchaseDocumentId?: string | null;
    documentNumber?: string | null;
    allocatedAmount: string;
  }[];
}

interface OpenDocument {
  documentId: string;
  number: string;
  businessDate: string;
  total: string;
  remainingDue: string;
}

interface WorkspaceParty {
  id: string;
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
}

interface WorkspaceAccount {
  id: string;
  name: string;
  kind: string;
}

export function PaymentsPage() {
  const { authenticated, selectedBusinessId, csrfToken } = useAuth();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"list" | "newIn" | "newOut">("list");
  const [filterKind, setFilterKind] = useState<"All" | "PaymentIn" | "PaymentOut">("All");

  // Workspace data
  const [parties, setParties] = useState<WorkspaceParty[]>([]);
  const [accounts, setAccounts] = useState<WorkspaceAccount[]>([]);

  // Form State
  const [partyId, setPartyId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [businessDate, setBusinessDate] = useState(new Date().toISOString().slice(0, 10));

  // Open documents for allocation
  const [openDocs, setOpenDocs] = useState<OpenDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  // Detail modal state
  const [selectedPayment, setSelectedPayment] = useState<PaymentRecord | null>(null);

  const paymentKind = activeTab === "newOut" ? "PaymentOut" : "PaymentIn";

  // Fetch payments list and workspace
  const fetchPayments = async () => {
    if (!authenticated || !selectedBusinessId) return;
    setLoading(true);
    try {
      const res = await fetch("/v1/payments", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setPayments(data.payments || []);
      }
    } catch {
      setError("Failed to load payments");
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkspace = async () => {
    if (!authenticated || !selectedBusinessId) return;
    try {
      const res = await fetch("/v1/payments/workspace", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setParties(data.parties || []);
        setAccounts(data.accounts || []);
        if (data.accounts?.length > 0 && !accountId) {
          setAccountId(data.accounts[0].id);
        }
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    fetchPayments();
    fetchWorkspace();
  }, [authenticated, selectedBusinessId]);

  // When party changes in New Payment form, fetch open documents
  useEffect(() => {
    if (!partyId || activeTab === "list") {
      setOpenDocs([]);
      setAllocations({});
      return;
    }
    const fetchDocs = async () => {
      setLoadingDocs(true);
      try {
        const res = await fetch(
          `/v1/payments/open-documents/${partyId}?paymentKind=${paymentKind}`,
          { credentials: "include" },
        );
        if (res.ok) {
          const data = await res.json();
          setOpenDocs(data.documents || []);
          setAllocations({});
        }
      } catch {
        // Ignore
      } finally {
        setLoadingDocs(false);
      }
    };
    fetchDocs();
  }, [partyId, paymentKind, activeTab]);

  // Handle allocation change
  const handleAllocationChange = (docId: string, val: string) => {
    setAllocations((prev) => ({
      ...prev,
      [docId]: val,
    }));
  };

  // Auto-allocate full remaining due
  const handleAutoAllocate = (doc: OpenDocument) => {
    const currentAlloc = allocations[doc.documentId] || "";
    if (currentAlloc && currentAlloc !== "0" && currentAlloc !== "0.00") {
      // Clear
      setAllocations((prev) => {
        const next = { ...prev };
        delete next[doc.documentId];
        return next;
      });
    } else {
      // Set to remaining due
      setAllocations((prev) => ({
        ...prev,
        [doc.documentId]: doc.remainingDue,
      }));
      // If payment amount is empty or smaller than allocated, suggest updating amount
      const currentTotal = parseFloat(amount || "0");
      const docDue = parseFloat(doc.remainingDue);
      if (currentTotal < docDue) {
        setAmount(doc.remainingDue);
      }
    }
  };

  // Calculate totals
  const totalAllocated = Object.values(allocations).reduce((sum, v) => {
    const num = parseFloat(v || "0");
    return sum + (isNaN(num) ? 0 : num);
  }, 0);

  const numAmount = parseFloat(amount || "0");
  const unallocatedAdvance = Math.max(0, (isNaN(numAmount) ? 0 : numAmount) - totalAllocated);

  const resetForm = () => {
    setPartyId("");
    setAmount("");
    setReference("");
    setNote("");
    setAllocations({});
    setOpenDocs([]);
    setError(null);
    setSuccess(null);
  };

  const handlePostPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!partyId) {
      setError("Please select a party");
      return;
    }
    if (!accountId) {
      setError("Please select a Cash or Bank account");
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      setError("Please enter a valid positive payment amount");
      return;
    }
    if (totalAllocated > parseFloat(amount)) {
      setError(`Allocated sum (${totalAllocated.toFixed(2)}) cannot exceed total payment amount (${parseFloat(amount).toFixed(2)})`);
      return;
    }

    // Build allocations payload
    const allocationItems = Object.entries(allocations)
      .filter(([_, val]) => parseFloat(val || "0") > 0)
      .map(([docId, val]) => ({
        id: crypto.randomUUID(),
        documentId: docId,
        allocatedAmount: parseFloat(val).toFixed(2),
      }));

    const paymentId = crypto.randomUUID();
    const commandId = crypto.randomUUID();

    const payload = {
      id: paymentId,
      commandId,
      partyId,
      accountId,
      paymentKind,
      amount: parseFloat(amount).toFixed(2),
      reference: reference.trim() || null,
      note: note.trim() || null,
      businessDate,
      allocations: allocationItems,
    };

    setLoading(true);
    try {
      const res = await fetch("/v1/payments/post", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken || "",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to post payment");
      }

      setSuccess(`Payment ${data.number} posted successfully!`);
      resetForm();
      setActiveTab("list");
      fetchPayments();
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Filtered list
  const filteredPayments = payments.filter((p) => {
    if (filterKind === "All") return true;
    return p.paymentKind === filterKind;
  });

  const availableParties = parties.filter((p) =>
    paymentKind === "PaymentIn" ? p.isCustomer || !p.isSupplier : p.isSupplier,
  );

  return (
    <div className="space-y-6">
      {/* Header and tabs */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments & Receipts</h1>
          <p className="text-sm text-muted-foreground">
            Record customer payment receipts (Payment In), supplier payouts (Payment Out), and invoice allocations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            className={activeTab === "list" ? "btn-primary" : "btn-secondary"}
            onClick={() => {
              setActiveTab("list");
              resetForm();
            }}
          >
            All Payments
          </Button>
          <Button
            className={`text-white ${activeTab === "newIn" ? "bg-emerald-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
            onClick={() => {
              setActiveTab("newIn");
              resetForm();
            }}
          >
            + Payment In
          </Button>
          <Button
            className={`text-white ${activeTab === "newOut" ? "bg-sky-700" : "bg-sky-600 hover:bg-sky-700"}`}
            onClick={() => {
              setActiveTab("newOut");
              resetForm();
            }}
          >
            + Payment Out
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm font-medium">
          {error}
        </div>
      )}
      {success && (
        <div className="p-4 rounded-md bg-emerald-50 text-emerald-800 text-sm font-medium">
          {success}
        </div>
      )}

      {/* List Tab */}
      {activeTab === "list" && (
        <Panel className="space-y-4">
          <div className="flex justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Filter:</span>
              <button
                type="button"
                onClick={() => setFilterKind("All")}
                className={`px-3 py-1 rounded text-xs font-semibold ${
                  filterKind === "All"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                All ({payments.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterKind("PaymentIn")}
                className={`px-3 py-1 rounded text-xs font-semibold ${
                  filterKind === "PaymentIn"
                    ? "bg-emerald-600 text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Payment In ({payments.filter((p) => p.paymentKind === "PaymentIn").length})
              </button>
              <button
                type="button"
                onClick={() => setFilterKind("PaymentOut")}
                className={`px-3 py-1 rounded text-xs font-semibold ${
                  filterKind === "PaymentOut"
                    ? "bg-sky-600 text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Payment Out ({payments.filter((p) => p.paymentKind === "PaymentOut").length})
              </button>
            </div>
            <Button className="btn-secondary" onClick={fetchPayments} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>

          {filteredPayments.length === 0 ? (
            <EmptyState title="No payments recorded">
              Record payments received from customers or paid out to suppliers.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted text-muted-foreground font-medium text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Number</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Party</th>
                    <th className="px-4 py-3">Account</th>
                    <th className="px-4 py-3 text-right">Total Amount</th>
                    <th className="px-4 py-3 text-right">Allocated</th>
                    <th className="px-4 py-3 text-right">Advance</th>
                    <th className="px-4 py-3">Reference</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredPayments.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedPayment(p)}
                      className="hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-semibold text-primary">
                        {p.number || "Draft"}
                      </td>
                      <td className="px-4 py-3">{p.businessDate}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                            p.paymentKind === "PaymentIn"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-sky-100 text-sky-800"
                          }`}
                        >
                          {p.paymentKind === "PaymentIn" ? "Payment In" : "Payment Out"}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium">{p.partyName || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.accountName} <span className="text-xs">({p.accountKind})</span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {formatMoney(p.amount)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {formatMoney(p.allocatedAmount)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {parseFloat(p.unallocatedAmount) > 0 ? (
                          <span className="text-amber-600 font-medium">
                            {formatMoney(p.unallocatedAmount)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{p.reference || "—"}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {/* New Payment Form Tab */}
      {(activeTab === "newIn" || activeTab === "newOut") && (
        <form onSubmit={handlePostPayment} className="space-y-6">
          <Panel className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span
                className={`w-3 h-3 rounded-full ${
                  paymentKind === "PaymentIn" ? "bg-emerald-600" : "bg-sky-600"
                }`}
              />
              {paymentKind === "PaymentIn" ? "Record Payment In (Customer Receipt)" : "Record Payment Out (Supplier Payout)"}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  {paymentKind === "PaymentIn" ? "Customer *" : "Supplier *"}
                </label>
                <select
                  value={partyId}
                  onChange={(e) => setPartyId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                >
                  <option value="">Select {paymentKind === "PaymentIn" ? "Customer" : "Supplier"}...</option>
                  {availableParties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Deposit / Paid From Account *
                </label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.kind})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Payment Date *
                </label>
                <input
                  type="date"
                  value={businessDate}
                  onChange={(e) => setBusinessDate(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Total Payment Amount *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm font-semibold text-lg focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Reference / Cheque #
                </label>
                <input
                  type="text"
                  placeholder="e.g. TR-99823 or Cheque #102"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  placeholder="Optional notes or remarks"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          </Panel>

          {/* Allocation against open invoices / bills */}
          <Panel className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-md font-semibold">
                  Allocate against {paymentKind === "PaymentIn" ? "Open Invoices" : "Open Purchase Bills"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Allocate this payment to specific unpaid documents or leave excess as an advance.
                </p>
              </div>
              <div className="text-right text-xs">
                <div>
                  Allocated: <span className="font-semibold text-primary">{formatMoney(totalAllocated.toFixed(2))}</span>
                </div>
                <div>
                  Unallocated Advance:{" "}
                  <span className="font-semibold text-amber-600">
                    {formatMoney(unallocatedAdvance.toFixed(2))}
                  </span>
                </div>
              </div>
            </div>

            {loadingDocs ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                Loading open documents...
              </div>
            ) : !partyId ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                Select a party above to view unpaid documents.
              </div>
            ) : openDocs.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground bg-muted/30 rounded border border-dashed border-border">
                No open unpaid documents for this party. The full amount ({formatMoney(amount || "0.00")}) will be held as an advance balance.
              </div>
            ) : (
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted text-muted-foreground font-medium text-xs uppercase">
                    <tr>
                      <th className="px-4 py-2 w-12 text-center">Action</th>
                      <th className="px-4 py-2">Document #</th>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2 text-right">Invoice Total</th>
                      <th className="px-4 py-2 text-right">Remaining Due</th>
                      <th className="px-4 py-2 text-right w-48">Allocated Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {openDocs.map((doc) => {
                      const isAllocated = parseFloat(allocations[doc.documentId] || "0") > 0;
                      return (
                        <tr key={doc.documentId} className={isAllocated ? "bg-primary/5" : ""}>
                          <td className="px-4 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={isAllocated}
                              onChange={() => handleAutoAllocate(doc)}
                              className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                            />
                          </td>
                          <td className="px-4 py-2 font-medium">{doc.number}</td>
                          <td className="px-4 py-2 text-muted-foreground">{doc.businessDate}</td>
                          <td className="px-4 py-2 text-right">{formatMoney(doc.total)}</td>
                          <td className="px-4 py-2 text-right font-semibold text-rose-600">
                            {formatMoney(doc.remainingDue)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max={doc.remainingDue}
                              placeholder="0.00"
                              value={allocations[doc.documentId] || ""}
                              onChange={(e) => handleAllocationChange(doc.documentId, e.target.value)}
                              className="w-full h-8 text-right px-2 rounded border border-input text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setActiveTab("list");
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className={`btn-primary text-white ${paymentKind === "PaymentIn" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-sky-600 hover:bg-sky-700"}`}
            >
              {loading ? "Posting..." : `Post ${paymentKind === "PaymentIn" ? "Payment In" : "Payment Out"}`}
            </Button>
          </div>
        </form>
      )}

      {/* Details Modal */}
      {selectedPayment && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-lg shadow-lg max-w-lg w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <div>
                <h3 className="text-lg font-bold">
                  {selectedPayment.number || "Payment Details"}
                </h3>
                <span
                  className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${
                    selectedPayment.paymentKind === "PaymentIn"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-sky-100 text-sky-800"
                  }`}
                >
                  {selectedPayment.paymentKind === "PaymentIn" ? "Payment In" : "Payment Out"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPayment(null)}
                className="text-muted-foreground hover:text-foreground text-lg"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground text-xs block">Party:</span>
                <span className="font-semibold">{selectedPayment.partyName || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">Account:</span>
                <span className="font-semibold">{selectedPayment.accountName}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">Date:</span>
                <span>{selectedPayment.businessDate}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">Total Amount:</span>
                <span className="font-bold text-primary">{formatMoney(selectedPayment.amount)}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">Allocated to Invoices:</span>
                <span>{formatMoney(selectedPayment.allocatedAmount)}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">Unallocated Advance:</span>
                <span className="font-semibold text-amber-600">
                  {formatMoney(selectedPayment.unallocatedAmount)}
                </span>
              </div>
              {selectedPayment.reference && (
                <div className="col-span-2">
                  <span className="text-muted-foreground text-xs block">Reference:</span>
                  <span>{selectedPayment.reference}</span>
                </div>
              )}
            </div>

            {selectedPayment.allocations.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                  Document Allocations
                </h4>
                <div className="space-y-1">
                  {selectedPayment.allocations.map((a) => (
                    <div
                      key={a.id}
                      className="flex justify-between items-center text-sm py-1 border-b border-border/50"
                    >
                      <span>{a.documentNumber || "Document"}</span>
                      <span className="font-medium">{formatMoney(a.allocatedAmount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button className="btn-secondary" onClick={() => setSelectedPayment(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
