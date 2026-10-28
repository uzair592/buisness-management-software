import { useState, useEffect } from "react";
import { Panel, Button, EmptyState } from "@business/ui";
import { formatMoney } from "@business/domain";
import { useAuth } from "../context/AuthContext";

interface ExpenseRecord {
  id: string;
  commandId: string;
  number: string | null;
  expenseCategoryId: string;
  categoryName?: string;
  expenseAccountId: string;
  expenseAccountName?: string;
  paidFromAccountId: string;
  paidFromAccountName?: string;
  paidFromAccountKind?: string;
  amount: string;
  taxAmount: string;
  reference: string | null;
  note: string | null;
  status: "Draft" | "Posted";
  businessDate: string;
  createdAt: string;
  postedAt: string | null;
}

interface ExpenseCategory {
  id: string;
  name: string;
}

interface ExpenseAccount {
  id: string;
  name: string;
  code: string;
  expenseCategoryId: string | null;
}

interface PaidFromAccount {
  id: string;
  name: string;
  kind: string;
}

export function ExpensesPage() {
  const { authenticated, selectedBusinessId, csrfToken } = useAuth();
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"list" | "new" | "categories">("list");
  const [filterCategory, setFilterCategory] = useState<string>("All");

  // Workspace data
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<ExpenseAccount[]>([]);
  const [paidFromAccounts, setPaidFromAccounts] = useState<PaidFromAccount[]>([]);

  // Form State
  const [categoryId, setCategoryId] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [paidFromAccountId, setPaidFromAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [taxAmount] = useState("0.00");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [businessDate, setBusinessDate] = useState(new Date().toISOString().slice(0, 10));

  // Quick category creation modal/state
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  const fetchExpenses = async () => {
    if (!authenticated || !selectedBusinessId) return;
    setLoading(true);
    try {
      const res = await fetch("/v1/expenses", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setExpenses(data.expenses || []);
      }
    } catch {
      setError("Failed to load expenses");
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkspace = async () => {
    if (!authenticated || !selectedBusinessId) return;
    try {
      const res = await fetch("/v1/expenses/workspace", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
        setExpenseAccounts(data.expenseAccounts || []);
        setPaidFromAccounts(data.paidFromAccounts || []);

        if (data.categories?.length > 0 && !categoryId) {
          setCategoryId(data.categories[0].id);
        }
        if (data.expenseAccounts?.length > 0 && !expenseAccountId) {
          setExpenseAccountId(data.expenseAccounts[0].id);
        }
        if (data.paidFromAccounts?.length > 0 && !paidFromAccountId) {
          setPaidFromAccountId(data.paidFromAccounts[0].id);
        }
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    fetchExpenses();
    fetchWorkspace();
  }, [authenticated, selectedBusinessId]);

  useEffect(() => {
    if (categoryId) {
      const matching = expenseAccounts.find((a) => a.expenseCategoryId === categoryId);
      if (matching) {
        setExpenseAccountId(matching.id);
      } else if (expenseAccounts.length > 0 && !expenseAccountId) {
        setExpenseAccountId(expenseAccounts[0].id);
      }
    }
  }, [categoryId, expenseAccounts]);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    setCreatingCategory(true);
    setError(null);
    try {
      const res = await fetch("/v1/expenses/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken || "",
        },
        credentials: "include",
        body: JSON.stringify({ name: newCategoryName.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create category");
      }

      const created = await res.json();
      await fetchWorkspace();
      setCategoryId(created.id);
      setNewCategoryName("");
      setSuccess(`Category "${created.name}" created!`);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setCreatingCategory(false);
    }
  };

  const handlePostExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!categoryId) {
      setError("Please select an expense category");
      return;
    }
    if (!expenseAccountId) {
      setError("Please select an expense account");
      return;
    }
    if (!paidFromAccountId) {
      setError("Please select a Cash or Bank account to pay from");
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      setError("Please enter a valid positive expense amount");
      return;
    }

    const payload = {
      id: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      expenseCategoryId: categoryId,
      expenseAccountId,
      paidFromAccountId,
      amount: parseFloat(amount).toFixed(2),
      taxAmount: parseFloat(taxAmount || "0").toFixed(2),
      reference: reference.trim() || null,
      note: note.trim() || null,
      businessDate,
    };

    setLoading(true);
    try {
      const res = await fetch("/v1/expenses/post", {
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
        throw new Error(data.error || "Failed to post expense");
      }

      setSuccess(`Expense ${data.number} recorded successfully!`);
      setAmount("");
      setReference("");
      setNote("");
      setActiveTab("list");
      fetchExpenses();
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const filteredExpenses = expenses.filter((e) => {
    if (filterCategory === "All") return true;
    return e.expenseCategoryId === filterCategory;
  });

  const totalExpenseAmount = expenses.reduce(
    (sum, e) => sum + (parseFloat(e.amount) || 0),
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
          <p className="text-sm text-muted-foreground">
            Track daily operating shop expenses (Rent, Utilities, Salaries, Tea, Maintenance) and categorize payouts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className={activeTab === "list" ? "btn-primary" : "btn-secondary"}
            onClick={() => setActiveTab("list")}
          >
            All Expenses
          </Button>
          <Button
            className={`text-white ${activeTab === "new" ? "bg-amber-700" : "bg-amber-600 hover:bg-amber-700"}`}
            onClick={() => setActiveTab("new")}
          >
            + Record Expense
          </Button>
          <Button
            className={activeTab === "categories" ? "btn-primary" : "btn-secondary"}
            onClick={() => setActiveTab("categories")}
          >
            Categories
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Panel className="p-4 space-y-1">
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
            Total Expenses
          </span>
          <div className="text-2xl font-bold text-primary">
            {formatMoney(totalExpenseAmount.toFixed(2))}
          </div>
          <span className="text-xs text-muted-foreground">
            {expenses.length} transaction{expenses.length === 1 ? "" : "s"} recorded
          </span>
        </Panel>

        <Panel className="p-4 space-y-1">
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
            Active Categories
          </span>
          <div className="text-2xl font-bold text-foreground">{categories.length}</div>
          <span className="text-xs text-muted-foreground">Utilities, Rent, Supplies, etc.</span>
        </Panel>

        <Panel className="p-4 space-y-1">
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
            Cash / Bank Accounts
          </span>
          <div className="text-2xl font-bold text-foreground">{paidFromAccounts.length}</div>
          <span className="text-xs text-muted-foreground">Source accounts for payouts</span>
        </Panel>
      </div>

      {/* List Tab */}
      {activeTab === "list" && (
        <Panel className="space-y-4">
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Category:</span>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="All">All Categories ({expenses.length})</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <Button className="btn-secondary" onClick={fetchExpenses} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>

          {filteredExpenses.length === 0 ? (
            <EmptyState title="No expenses found">
              Record daily operating expenses to keep track of shop spending.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted text-muted-foreground font-medium text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Expense #</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Expense Head</th>
                    <th className="px-4 py-3">Paid From</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Reference</th>
                    <th className="px-4 py-3">Note</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredExpenses.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-primary">{e.number}</td>
                      <td className="px-4 py-3">{e.businessDate}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                          {e.categoryName}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium">{e.expenseAccountName}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {e.paidFromAccountName} <span className="text-xs">({e.paidFromAccountKind})</span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-rose-600">
                        {formatMoney(e.amount)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{e.reference || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{e.note || "—"}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                          {e.status}
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

      {/* Record Expense Tab */}
      {activeTab === "new" && (
        <form onSubmit={handlePostExpense} className="space-y-6">
          <Panel className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-600" />
              Record Shop Expense
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Expense Category *
                </label>
                <div className="flex gap-2">
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    required
                  >
                    <option value="">Select Category...</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    className="btn-secondary px-2.5"
                    onClick={() => setActiveTab("categories")}
                    title="Add Category"
                  >
                    +
                  </Button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Expense Account Head *
                </label>
                <select
                  value={expenseAccountId}
                  onChange={(e) => setExpenseAccountId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                >
                  <option value="">Select Expense Account...</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Paid From (Cash / Bank) *
                </label>
                <select
                  value={paidFromAccountId}
                  onChange={(e) => setPaidFromAccountId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                >
                  <option value="">Select Payment Account...</option>
                  {paidFromAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.kind})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Amount *
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
                  Date *
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
                  Reference / Receipt #
                </label>
                <input
                  type="text"
                  placeholder="e.g. Bill #8839, Receipt"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Note / Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Paid monthly shop electricity bill"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          </Panel>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              className="btn-secondary"
              onClick={() => setActiveTab("list")}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="btn-primary bg-amber-600 hover:bg-amber-700 text-white"
            >
              {loading ? "Recording..." : "Record Expense"}
            </Button>
          </div>
        </form>
      )}

      {/* Categories Management Tab */}
      {activeTab === "categories" && (
        <Panel className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Expense Categories</h2>
            <p className="text-xs text-muted-foreground">
              Categories allow you to organize expenses by operational head.
            </p>
          </div>

          <form onSubmit={handleCreateCategory} className="flex gap-2 max-w-md">
            <input
              type="text"
              placeholder="e.g. Office Supplies, Staff Welfare"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              required
            />
            <Button type="submit" className="btn-primary" disabled={creatingCategory}>
              {creatingCategory ? "Adding..." : "+ Add Category"}
            </Button>
          </form>

          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted text-muted-foreground font-medium text-xs uppercase">
                <tr>
                  <th className="px-4 py-2">Category Name</th>
                  <th className="px-4 py-2 text-right">Associated Expenses</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {categories.map((c) => {
                  const count = expenses.filter((e) => e.expenseCategoryId === c.id).length;
                  return (
                    <tr key={c.id}>
                      <td className="px-4 py-2 font-medium">{c.name}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
