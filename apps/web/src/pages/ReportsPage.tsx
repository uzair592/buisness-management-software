import { useState, useEffect } from "react";
import { Panel, Button, EmptyState } from "@business/ui";
import { formatMoney } from "@business/domain";
import { useAuth } from "../context/AuthContext";
import type {
  ProfitAndLossReport,
  TrialBalanceReport,
  BalanceSheetReport,
  StockValuationReport,
  PartyLedgerReport,
  CashSessionSummary,
} from "@business/contracts";

type ReportTab =
  | "overview"
  | "pnl"
  | "balanceSheet"
  | "stock"
  | "partyLedger"
  | "cashRegister";

interface WorkspaceParty {
  id: string;
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
}

interface RegisterWorkspace {
  locations: { id: string; name: string }[];
  devices: { id: string; deviceName: string; locationId: string }[];
  cashAccounts: { id: string; name: string; code: string }[];
}

function displayMoney(val: string | null | undefined): string {
  if (!val) return "PKR 0.00";
  const str = String(val).trim();
  const isNegative = str.startsWith("-");
  const abs = isNegative ? str.slice(1) : str;
  try {
    const formatted = formatMoney(abs);
    return isNegative ? `-${formatted}` : formatted;
  } catch {
    return str;
  }
}

export function ReportsPage() {
  const { authenticated, selectedBusinessId, csrfToken } = useAuth();
  const [activeTab, setActiveTab] = useState<ReportTab>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Date filters
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(`${today.slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(today);
  const [asOfDate, setAsOfDate] = useState(today);

  // Reports data states
  const [pnl, setPnl] = useState<ProfitAndLossReport | null>(null);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceReport | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetReport | null>(null);
  const [stockValuation, setStockValuation] = useState<StockValuationReport | null>(null);

  // Party Ledger states
  const [parties, setParties] = useState<WorkspaceParty[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState<string>("");
  const [partyLedger, setPartyLedger] = useState<PartyLedgerReport | null>(null);

  // Cash Register states
  const [currentSession, setCurrentSession] = useState<(CashSessionSummary & { cashInflows?: string; cashOutflows?: string }) | null>(null);
  const [sessionsHistory, setSessionsHistory] = useState<CashSessionSummary[]>([]);
  const [registerWorkspace, setRegisterWorkspace] = useState<RegisterWorkspace | null>(null);
  const [openSessionModal, setOpenSessionModal] = useState(false);
  const [closeSessionModal, setCloseSessionModal] = useState(false);

  // Open session form
  const [openLocationId, setOpenLocationId] = useState("");
  const [openDeviceId, setOpenDeviceId] = useState("");
  const [openCashAccountId, setOpenCashAccountId] = useState("");
  const [openOpeningFloat, setOpenOpeningFloat] = useState("0.00");

  // Close session form
  const [closeCountedAmount, setCloseCountedAmount] = useState("");
  const [closeVarianceReason, setCloseVarianceReason] = useState("");

  // Initial load
  useEffect(() => {
    if (authenticated && selectedBusinessId) {
      loadOverviewData();
      loadParties();
      loadRegisterWorkspace();
      loadCashSession();
    } else {
      // Mock preview data when not connected
      loadPreviewData();
    }
  }, [authenticated, selectedBusinessId]);

  const loadPreviewData = () => {
    setPnl({
      period: { startDate, endDate },
      revenue: {
        grossSales: "15400.00",
        salesReturns: "400.00",
        netSales: "15000.00",
      },
      cogs: {
        salesCogs: "8200.00",
        deficitSettlements: "0.00",
        returnRestockReversals: "200.00",
        netCogs: "8000.00",
      },
      grossProfit: {
        amount: "7000.00",
        marginPercentage: "46.67",
      },
      expenses: {
        categories: [
          { id: "c1", name: "Shop Rent", amount: "1500.00" },
          { id: "c2", name: "Electricity & Utilities", amount: "450.00" },
          { id: "c3", name: "Staff Wages", amount: "2000.00" },
        ],
        totalExpenses: "3950.00",
      },
      netOperatingProfit: "3050.00",
      coverage: {
        openDeficitsCount: 0,
        isProvisional: false,
      },
    });

    setBalanceSheet({
      asOfDate,
      assets: {
        cashAndBank: "9450.00",
        accountsReceivable: "3500.00",
        inventoryValue: "12500.00",
        taxAsset: "600.00",
        totalAssets: "26050.00",
      },
      liabilities: {
        accountsPayable: "4200.00",
        taxLiability: "800.00",
        customerAdvances: "0.00",
        totalLiabilities: "5000.00",
      },
      equity: {
        openingCapital: "18000.00",
        currentPeriodProfit: "3050.00",
        totalEquity: "21050.00",
      },
      isBalanced: true,
    });

    setTrialBalance({
      asOfDate,
      accounts: [
        { id: "1", code: "CASH_DRAWER", name: "Main Cash Drawer", kind: "Asset", totalDebit: "15000.00", totalCredit: "8500.00", netBalance: "6500.00", netKind: "Debit" },
        { id: "2", code: "BANK_PRIMARY", name: "Primary Bank Account", kind: "Asset", totalDebit: "5000.00", totalCredit: "2050.00", netBalance: "2950.00", netKind: "Debit" },
        { id: "3", code: "RECEIVABLES", name: "Trade Receivables", kind: "Asset", totalDebit: "8500.00", totalCredit: "5000.00", netBalance: "3500.00", netKind: "Debit" },
        { id: "4", code: "INVENTORY", name: "Merchandise Inventory", kind: "Asset", totalDebit: "16500.00", totalCredit: "4000.00", netBalance: "12500.00", netKind: "Debit" },
        { id: "5", code: "PAYABLES", name: "Trade Payables", kind: "Liability", totalDebit: "2000.00", totalCredit: "6200.00", netBalance: "4200.00", netKind: "Credit" },
        { id: "6", code: "CAPITAL", name: "Owner Capital", kind: "Equity", totalDebit: "0.00", totalCredit: "18000.00", netBalance: "18000.00", netKind: "Credit" },
        { id: "7", code: "SALES", name: "Sales Revenue", kind: "Revenue", totalDebit: "400.00", totalCredit: "15400.00", netBalance: "15000.00", netKind: "Credit" },
        { id: "8", code: "COGS", name: "Cost of Goods Sold", kind: "Expense", totalDebit: "8200.00", totalCredit: "200.00", netBalance: "8000.00", netKind: "Debit" },
        { id: "9", code: "EXP_RENT", name: "Shop Rent", kind: "Expense", totalDebit: "1500.00", totalCredit: "0.00", netBalance: "1500.00", netKind: "Debit" },
        { id: "10", code: "EXP_UTIL", name: "Utilities", kind: "Expense", totalDebit: "450.00", totalCredit: "0.00", netBalance: "450.00", netKind: "Debit" },
        { id: "11", code: "EXP_WAGE", name: "Staff Wages", kind: "Expense", totalDebit: "2000.00", totalCredit: "0.00", netBalance: "2000.00", netKind: "Debit" },
        { id: "12", code: "TAX_NET", name: "Sales Tax Net", kind: "Liability", totalDebit: "600.00", totalCredit: "800.00", netBalance: "200.00", netKind: "Credit" },
      ],
      totalDebits: "54650.00",
      totalCredits: "54650.00",
      isBalanced: true,
    });

    setStockValuation({
      items: [
        { id: "i1", sku: "PARACET-500", name: "Paracetamol 500mg", categoryName: "Pharmaceuticals", unitCode: "BOX", quantity: "150.00", movingAverageCost: "12.00", totalValuation: "1800.00", isDeficit: false },
        { id: "i2", sku: "AMOX-250", name: "Amoxicillin 250mg", categoryName: "Pharmaceuticals", unitCode: "BOX", quantity: "85.00", movingAverageCost: "25.00", totalValuation: "2125.00", isDeficit: false },
        { id: "i3", sku: "BANDAGE-MED", name: "Elastic Bandage 10cm", categoryName: "First Aid", unitCode: "PCS", quantity: "200.00", movingAverageCost: "4.50", totalValuation: "900.00", isDeficit: false },
        { id: "i4", sku: "SYRINGE-5ML", name: "Disposable Syringe 5ml", categoryName: "Medical Supplies", unitCode: "PACK", quantity: "320.00", movingAverageCost: "8.00", totalValuation: "2560.00", isDeficit: false },
      ],
      totalQuantity: "755.00",
      totalValuation: "7385.00",
      openDeficitsCount: 0,
    });

    setParties([
      { id: "p1", name: "City Pharmacy Corp", isCustomer: true, isSupplier: false },
      { id: "p2", name: "MediLife Distributors", isCustomer: false, isSupplier: true },
    ]);
    setSelectedPartyId("p1");

    setPartyLedger({
      party: { id: "p1", name: "City Pharmacy Corp", isCustomer: true, isSupplier: false },
      totalReceivableDue: "1450.00",
      totalPayableDue: "0.00",
      unallocatedAdvance: "0.00",
      entries: [
        { date: "2026-10-05", documentNumber: "INV-000001", documentType: "Sale Invoice", reference: "Cash/Credit Sale", debit: "2500.00", credit: "0.00", runningBalance: "2500.00" },
        { date: "2026-10-12", documentNumber: "PAY-IN-000001", documentType: "Payment In", reference: "Bank Transfer", debit: "0.00", credit: "1500.00", runningBalance: "1000.00" },
        { date: "2026-10-18", documentNumber: "INV-000005", documentType: "Sale Invoice", reference: "Refill order", debit: "850.00", credit: "0.00", runningBalance: "1850.00" },
        { date: "2026-10-24", documentNumber: "CN-000001", documentType: "Credit Note", reference: "Damaged packaging return", debit: "0.00", credit: "400.00", runningBalance: "1450.00" },
      ],
    });

    setCurrentSession({
      id: "cs-sample-1",
      sessionNumber: "CS-000001",
      locationId: "loc-1",
      locationName: "Main Store Register",
      deviceId: "dev-1",
      deviceName: "Counter Terminal 1",
      cashAccountId: "cash-1",
      cashAccountName: "Cash Drawer 1",
      openedAt: new Date(Date.now() - 6 * 3600000).toISOString(),
      closedAt: null,
      openedByUserId: "u1",
      openedByUserName: "Active Cashier",
      closedByUserId: null,
      closedByUserName: null,
      openingFloat: "500.00",
      countedAmount: null,
      expectedAmount: "3650.00",
      cashInflows: "3400.00",
      cashOutflows: "250.00",
      varianceAmount: null,
      varianceReason: null,
      status: "Open",
      closedWatermarkCursor: null,
      createdAt: new Date().toISOString(),
    });
  };

  const loadOverviewData = async () => {
    setLoading(true);
    try {
      const [resPnl, resBs, resTb, resStock] = await Promise.all([
        fetch(`/v1/reports/profit-and-loss?startDate=${startDate}&endDate=${endDate}`, { credentials: "include" }),
        fetch(`/v1/reports/balance-sheet?asOfDate=${asOfDate}`, { credentials: "include" }),
        fetch(`/v1/reports/trial-balance?asOfDate=${asOfDate}`, { credentials: "include" }),
        fetch(`/v1/reports/stock-summary`, { credentials: "include" }),
      ]);

      if (resPnl.ok) {
        const d = await resPnl.json();
        setPnl(d.report);
      }
      if (resBs.ok) {
        const d = await resBs.json();
        setBalanceSheet(d.report);
      }
      if (resTb.ok) {
        const d = await resTb.json();
        setTrialBalance(d.report);
      }
      if (resStock.ok) {
        const d = await resStock.json();
        setStockValuation(d.report);
      }
    } catch {
      setError("Failed to load financial reports.");
    } finally {
      setLoading(false);
    }
  };

  const loadParties = async () => {
    try {
      const res = await fetch("/v1/payments/workspace", { credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        if (d.parties && d.parties.length > 0) {
          setParties(d.parties);
          if (!selectedPartyId) {
            setSelectedPartyId(d.parties[0].id);
            loadPartyLedger(d.parties[0].id);
          }
        }
      }
    } catch {
      // ignore
    }
  };

  const loadPartyLedger = async (partyId: string) => {
    if (!partyId) return;
    try {
      const res = await fetch(`/v1/reports/party-ledger/${partyId}?startDate=${startDate}&endDate=${endDate}`, {
        credentials: "include",
      });
      if (res.ok) {
        const d = await res.json();
        setPartyLedger(d.report);
      }
    } catch {
      setError("Failed to load party running ledger.");
    }
  };

  const loadRegisterWorkspace = async () => {
    try {
      const res = await fetch("/v1/cash-sessions/workspace", { credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        setRegisterWorkspace(d);
        if (d.locations?.length > 0) setOpenLocationId(d.locations[0].id);
        if (d.devices?.length > 0) setOpenDeviceId(d.devices[0].id);
        if (d.cashAccounts?.length > 0) setOpenCashAccountId(d.cashAccounts[0].id);
      }
    } catch {
      // ignore
    }
  };

  const loadCashSession = async () => {
    try {
      const [resCurrent, resList] = await Promise.all([
        fetch("/v1/cash-sessions/current", { credentials: "include" }),
        fetch("/v1/cash-sessions", { credentials: "include" }),
      ]);
      if (resCurrent.ok) {
        const d = await resCurrent.json();
        setCurrentSession(d.session);
        if (d.session) {
          setCloseCountedAmount(d.session.expectedAmount || d.session.openingFloat || "0.00");
        }
      }
      if (resList.ok) {
        const d = await resList.json();
        setSessionsHistory(d.sessions || []);
      }
    } catch {
      // ignore
    }
  };

  const handleOpenSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authenticated || !selectedBusinessId) {
      setError("Business login required to open register sessions.");
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/v1/cash-sessions/open", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken || "",
        },
        credentials: "include",
        body: JSON.stringify({
          locationId: openLocationId,
          deviceId: openDeviceId,
          cashAccountId: openCashAccountId,
          openingFloat: openOpeningFloat,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to open register session");
      }
      setSuccess(`Cash session ${data.session.sessionNumber} opened successfully.`);
      setOpenSessionModal(false);
      loadCashSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error opening session");
    }
  };

  const handleCloseSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSession) return;
    if (!authenticated || !selectedBusinessId) {
      setError("Business login required to close register sessions.");
      return;
    }
    setError(null);
    setSuccess(null);

    const counted = parseFloat(closeCountedAmount || "0");
    const expected = parseFloat(currentSession.expectedAmount || "0");
    const variance = (counted - expected).toFixed(2);

    if (variance !== "0.00" && (!closeVarianceReason || closeVarianceReason.trim().length === 0)) {
      setError(`Counted cash (${closeCountedAmount}) does not match expected (${currentSession.expectedAmount}). Please enter a variance explanation.`);
      return;
    }

    try {
      const res = await fetch(`/v1/cash-sessions/${currentSession.id}/close`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken || "",
        },
        credentials: "include",
        body: JSON.stringify({
          countedAmount: closeCountedAmount,
          varianceReason: closeVarianceReason.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to close register session");
      }
      setSuccess(`Cash session ${data.session.sessionNumber} closed with variance ${data.session.varianceAmount}.`);
      setCloseSessionModal(false);
      setCloseVarianceReason("");
      loadCashSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error closing session");
    }
  };

  // Quick calculations for close variance
  const countedNum = parseFloat(closeCountedAmount || "0");
  const expectedNum = currentSession ? parseFloat(currentSession.expectedAmount || "0") : 0;
  const currentVariance = (countedNum - expectedNum).toFixed(2);
  const hasVariance = currentVariance !== "0.00" && currentVariance !== "-0.00";

  return (
    <div className="space-y-6">
      {/* Header with EXACT 'Reports' heading for shell.spec.ts */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">
            Authoritative double-entry financial statements, stock valuation, and cash register sessions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {authenticated && (
            <Button
              className="btn-secondary"
              onClick={() => {
                loadOverviewData();
                loadCashSession();
                if (selectedPartyId) loadPartyLedger(selectedPartyId);
              }}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "↻ Refresh Statements"}
            </Button>
          )}
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="rounded-md bg-rose-50 p-4 border border-rose-200">
          <p className="text-sm font-medium text-rose-800">{error}</p>
        </div>
      )}
      {success && (
        <div className="rounded-md bg-emerald-50 p-4 border border-emerald-200">
          <p className="text-sm font-medium text-emerald-800">{success}</p>
        </div>
      )}

      {/* Tabs navigation with flex-wrap for mobile compliance */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        <Button
          className={activeTab === "overview" ? "btn-primary" : "btn-secondary"}
          onClick={() => setActiveTab("overview")}
        >
          Executive Overview
        </Button>
        <Button
          className={activeTab === "pnl" ? "btn-primary" : "btn-secondary"}
          onClick={() => setActiveTab("pnl")}
        >
          Profit & Loss
        </Button>
        <Button
          className={activeTab === "balanceSheet" ? "btn-primary" : "btn-secondary"}
          onClick={() => setActiveTab("balanceSheet")}
        >
          Balance Sheet & Trial Balance
        </Button>
        <Button
          className={activeTab === "stock" ? "btn-primary" : "btn-secondary"}
          onClick={() => setActiveTab("stock")}
        >
          Stock Valuation
        </Button>
        <Button
          className={activeTab === "partyLedger" ? "btn-primary" : "btn-secondary"}
          onClick={() => setActiveTab("partyLedger")}
        >
          Party Ledgers
        </Button>
        <Button
          className={activeTab === "cashRegister" ? "btn-primary" : "btn-secondary"}
          onClick={() => setActiveTab("cashRegister")}
        >
          Cash Register Close
        </Button>
      </div>

      {/* TAB 1: EXECUTIVE OVERVIEW */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Panel className="p-5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Net Sales Revenue
              </span>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {pnl ? displayMoney(pnl.revenue.netSales) : "0.00"}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Gross: {pnl ? displayMoney(pnl.revenue.grossSales) : "0.00"}
              </p>
            </Panel>

            <Panel className="p-5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Gross Margin
              </span>
              <p className="mt-2 text-2xl font-bold text-emerald-600">
                {pnl ? displayMoney(pnl.grossProfit.amount) : "0.00"}
              </p>
              <p className="mt-1 text-xs text-emerald-700 font-medium">
                {pnl ? pnl.grossProfit.marginPercentage : "0"}% margin
              </p>
            </Panel>

            <Panel className="p-5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Net Operating Profit
              </span>
              <p
                className={`mt-2 text-2xl font-bold ${
                  pnl && parseFloat(pnl.netOperatingProfit) >= 0
                    ? "text-emerald-600"
                    : "text-rose-600"
                }`}
              >
                {pnl ? displayMoney(pnl.netOperatingProfit) : "0.00"}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                After operating expenses: {pnl ? displayMoney(pnl.expenses.totalExpenses) : "0.00"}
              </p>
            </Panel>

            <Panel className="p-5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Inventory Valuation
              </span>
              <p className="mt-2 text-2xl font-bold text-indigo-600">
                {stockValuation ? displayMoney(stockValuation.totalValuation) : "0.00"}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {stockValuation ? stockValuation.totalQuantity : "0"} units on hand
              </p>
            </Panel>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Panel className="p-5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Cash & Bank Liquid Funds
              </span>
              <p className="mt-2 text-2xl font-bold text-slate-800">
                {balanceSheet ? displayMoney(balanceSheet.assets.cashAndBank) : "0.00"}
              </p>
              <p className="mt-1 text-xs text-slate-500">Across registers & verified bank accounts</p>
            </Panel>

            <Panel className="p-5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Open Customer Receivables
              </span>
              <p className="mt-2 text-2xl font-bold text-amber-600">
                {balanceSheet ? displayMoney(balanceSheet.assets.accountsReceivable) : "0.00"}
              </p>
              <p className="mt-1 text-xs text-slate-500">Unpaid customer invoices</p>
            </Panel>

            <Panel className="p-5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Open Supplier Payables
              </span>
              <p className="mt-2 text-2xl font-bold text-purple-600">
                {balanceSheet ? displayMoney(balanceSheet.liabilities.accountsPayable) : "0.00"}
              </p>
              <p className="mt-1 text-xs text-slate-500">Pending supplier purchase bills</p>
            </Panel>
          </div>

          {/* Quick shortcuts */}
          <Panel className="p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-3">Audit & Reporting Standards</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm text-slate-600">
              <div className="rounded-lg border border-slate-200 p-4">
                <span className="font-semibold text-slate-800">Double-Entry Immutability</span>
                <p className="mt-1 text-xs text-slate-500">
                  Every figure is calculated from posted journal lines and validated stock ledgers. Never estimated or cached locally.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <span className="font-semibold text-slate-800">Weighted Moving Average Cost</span>
                <p className="mt-1 text-xs text-slate-500">
                  Inventory valuation dynamically tracks restocking purchase bills and inward price variations with zero drift.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <span className="font-semibold text-slate-800">Strict Shift Reconciliation</span>
                <p className="mt-1 text-xs text-slate-500">
                  Cash register close requires exact float reconciliation with server sync-watermarks and mandatory variance audit notes.
                </p>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* TAB 2: PROFIT & LOSS */}
      {activeTab === "pnl" && (
        <div className="space-y-6">
          <Panel className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs font-medium text-slate-600">
                  From:
                  <input
                    type="date"
                    className="ml-2 rounded border border-slate-300 px-2 py-1 text-sm"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  To:
                  <input
                    type="date"
                    className="ml-2 rounded border border-slate-300 px-2 py-1 text-sm"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </label>
                <Button
                  className="btn-secondary"
                  onClick={() => loadOverviewData()}
                  disabled={loading}
                >
                  Apply Dates
                </Button>
              </div>
              {pnl?.coverage.isProvisional && (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                  ⚠ Provisional Stock Deficits: {pnl.coverage.openDeficitsCount}
                </span>
              )}
            </div>
          </Panel>

          {pnl ? (
            <Panel className="overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
                <h2 className="text-base font-semibold text-slate-900">
                  Income Statement (Profit & Loss)
                </h2>
                <p className="text-xs text-slate-500">
                  Period: {pnl.period.startDate} to {pnl.period.endDate}
                </p>
              </div>

              <div className="divide-y divide-slate-200 text-sm">
                {/* 1. Operating Revenue */}
                <div className="p-6">
                  <h3 className="font-semibold text-slate-800 uppercase tracking-wide text-xs">
                    1. Operating Revenue
                  </h3>
                  <div className="mt-3 space-y-2">
                    <div className="flex justify-between text-slate-600">
                      <span>Gross Sales (Invoices)</span>
                      <span>${displayMoney(pnl.revenue.grossSales)}</span>
                    </div>
                    <div className="flex justify-between text-rose-600">
                      <span>Less: Sales Returns & Credit Notes</span>
                      <span>-${displayMoney(pnl.revenue.salesReturns)}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-slate-900 pt-2 border-t border-slate-100">
                      <span>Net Sales</span>
                      <span>${displayMoney(pnl.revenue.netSales)}</span>
                    </div>
                  </div>
                </div>

                {/* 2. Cost of Goods Sold */}
                <div className="p-6">
                  <h3 className="font-semibold text-slate-800 uppercase tracking-wide text-xs">
                    2. Cost of Goods Sold (COGS)
                  </h3>
                  <div className="mt-3 space-y-2">
                    <div className="flex justify-between text-slate-600">
                      <span>Cost of Invoiced Goods (FIFO/Moving Avg)</span>
                      <span>${displayMoney(pnl.cogs.salesCogs)}</span>
                    </div>
                    {parseFloat(pnl.cogs.deficitSettlements) > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>Deficit Stock Settlements</span>
                        <span>${displayMoney(pnl.cogs.deficitSettlements)}</span>
                      </div>
                    )}
                    {parseFloat(pnl.cogs.returnRestockReversals) > 0 && (
                      <div className="flex justify-between text-emerald-600">
                        <span>Less: Return Restock Cost Reversals</span>
                        <span>-${displayMoney(pnl.cogs.returnRestockReversals)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-semibold text-slate-900 pt-2 border-t border-slate-100">
                      <span>Total Cost of Goods Sold</span>
                      <span>${displayMoney(pnl.cogs.netCogs)}</span>
                    </div>
                  </div>
                </div>

                {/* Gross Profit Bar */}
                <div className="p-6 bg-slate-50 flex justify-between items-center font-bold text-base">
                  <div>
                    <span className="text-slate-900">Gross Profit</span>
                    <span className="ml-3 text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      {pnl.grossProfit.marginPercentage}% Margin
                    </span>
                  </div>
                  <span className="text-emerald-700">${displayMoney(pnl.grossProfit.amount)}</span>
                </div>

                {/* 3. Operating Expenses */}
                <div className="p-6">
                  <h3 className="font-semibold text-slate-800 uppercase tracking-wide text-xs">
                    3. Operating Expenses
                  </h3>
                  <div className="mt-3 space-y-2">
                    {pnl.expenses.categories.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">No operating expenses in this period.</p>
                    ) : (
                      pnl.expenses.categories.map((cat) => (
                        <div key={cat.id} className="flex justify-between text-slate-600">
                          <span>{cat.name}</span>
                          <span>${displayMoney(cat.amount)}</span>
                        </div>
                      ))
                    )}
                    <div className="flex justify-between font-semibold text-slate-900 pt-2 border-t border-slate-100">
                      <span>Total Operating Expenses</span>
                      <span>${displayMoney(pnl.expenses.totalExpenses)}</span>
                    </div>
                  </div>
                </div>

                {/* Net Operating Profit Bar */}
                <div className="p-6 bg-slate-100 flex justify-between items-center font-bold text-lg">
                  <span className="text-slate-900">Net Operating Profit</span>
                  <span
                    className={
                      parseFloat(pnl.netOperatingProfit) >= 0
                        ? "text-emerald-700"
                        : "text-rose-700"
                    }
                  >
                    ${displayMoney(pnl.netOperatingProfit)}
                  </span>
                </div>
              </div>
            </Panel>
          ) : (
            <EmptyState title="No Data Available">
              No Profit &amp; Loss data available for selected period.
            </EmptyState>
          )}
        </div>
      )}

      {/* TAB 3: BALANCE SHEET & TRIAL BALANCE */}
      {activeTab === "balanceSheet" && (
        <div className="space-y-6">
          <Panel className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <label className="text-xs font-medium text-slate-600">
                As Of Date:
                <input
                  type="date"
                  className="ml-2 rounded border border-slate-300 px-2 py-1 text-sm"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                />
              </label>
              <Button
                className="btn-secondary"
                onClick={() => loadOverviewData()}
                disabled={loading}
              >
                Recalculate Statement
              </Button>
            </div>
          </Panel>

          {/* Balance Sheet Summary */}
          {balanceSheet && (
            <Panel className="p-6">
              <div className="flex flex-wrap items-center justify-between border-b border-slate-200 pb-4 mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Double-Entry Balance Sheet</h2>
                  <p className="text-xs text-slate-500">As of {balanceSheet.asOfDate}</p>
                </div>
                <div>
                  {balanceSheet.isBalanced ? (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                      ✓ Balanced (Assets = Liabilities + Equity)
                    </span>
                  ) : (
                    <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-800">
                      ⚠ Unbalanced Journal Variance
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-sm">
                {/* Left: Assets */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-slate-900 border-b border-slate-200 pb-2 uppercase tracking-wide text-xs">
                    Assets
                  </h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-slate-600">
                      <span>Cash & Bank Balances</span>
                      <span>${displayMoney(balanceSheet.assets.cashAndBank)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Trade Accounts Receivable</span>
                      <span>${displayMoney(balanceSheet.assets.accountsReceivable)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Inventory / Stock on Hand</span>
                      <span>${displayMoney(balanceSheet.assets.inventoryValue)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Input Tax Asset</span>
                      <span>${displayMoney(balanceSheet.assets.taxAsset)}</span>
                    </div>
                  </div>
                  <div className="pt-3 border-t-2 border-slate-300 flex justify-between font-bold text-slate-900 text-base">
                    <span>Total Assets</span>
                    <span>${displayMoney(balanceSheet.assets.totalAssets)}</span>
                  </div>
                </div>

                {/* Right: Liabilities & Equity */}
                <div className="space-y-6">
                  {/* Liabilities */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-slate-900 border-b border-slate-200 pb-2 uppercase tracking-wide text-xs">
                      Liabilities
                    </h3>
                    <div className="space-y-2">
                      <div className="flex justify-between text-slate-600">
                        <span>Trade Accounts Payable</span>
                        <span>${displayMoney(balanceSheet.liabilities.accountsPayable)}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Sales Tax Payable</span>
                        <span>${displayMoney(balanceSheet.liabilities.taxLiability)}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Customer Advance Deposits</span>
                        <span>${displayMoney(balanceSheet.liabilities.customerAdvances)}</span>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-slate-200 flex justify-between font-semibold text-slate-800">
                      <span>Total Liabilities</span>
                      <span>${displayMoney(balanceSheet.liabilities.totalLiabilities)}</span>
                    </div>
                  </div>

                  {/* Equity */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-slate-900 border-b border-slate-200 pb-2 uppercase tracking-wide text-xs">
                      Equity
                    </h3>
                    <div className="space-y-2">
                      <div className="flex justify-between text-slate-600">
                        <span>Owner Capital / Retained Earnings</span>
                        <span>${displayMoney(balanceSheet.equity.openingCapital)}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Current Period Net Profit</span>
                        <span>${displayMoney(balanceSheet.equity.currentPeriodProfit)}</span>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-slate-200 flex justify-between font-semibold text-slate-800">
                      <span>Total Equity</span>
                      <span>${displayMoney(balanceSheet.equity.totalEquity)}</span>
                    </div>
                  </div>

                  <div className="pt-3 border-t-2 border-slate-300 flex justify-between font-bold text-slate-900 text-base">
                    <span>Total Liabilities & Equity</span>
                    <span>
                      $
                      {displayMoney(
                        (
                          parseFloat(balanceSheet.liabilities.totalLiabilities) +
                          parseFloat(balanceSheet.equity.totalEquity)
                        ).toFixed(2),
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </Panel>
          )}

          {/* Trial Balance Table */}
          {trialBalance && (
            <Panel className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-slate-900 text-base">Full Trial Balance</h3>
                <span className="text-xs text-slate-500">Debits and credits across all ledger accounts</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase">
                    <tr>
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Account Name</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3 text-right">Debit</th>
                      <th className="px-4 py-3 text-right">Credit</th>
                      <th className="px-4 py-3 text-right">Net Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-700">
                    {trialBalance.accounts.map((acc) => (
                      <tr key={acc.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-mono text-xs">{acc.code}</td>
                        <td className="px-4 py-2 font-medium text-slate-900">{acc.name}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">{acc.kind}</td>
                        <td className="px-4 py-2 text-right">
                          {parseFloat(acc.totalDebit) > 0 ? `$${displayMoney(acc.totalDebit)}` : "—"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {parseFloat(acc.totalCredit) > 0 ? `$${displayMoney(acc.totalCredit)}` : "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-medium">
                          ${displayMoney(acc.netBalance)}{" "}
                          <span className="text-xs text-slate-400">({acc.netKind[0]})</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-300 font-bold bg-slate-50 text-slate-900">
                    <tr>
                      <td colSpan={3} className="px-4 py-3">Total Trial Balance</td>
                      <td className="px-4 py-3 text-right">${displayMoney(trialBalance.totalDebits)}</td>
                      <td className="px-4 py-3 text-right">${displayMoney(trialBalance.totalCredits)}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">
                        {trialBalance.isBalanced ? "✓ Balanced" : "⚠ Discrepancy"}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* TAB 4: STOCK VALUATION */}
      {activeTab === "stock" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Panel className="p-4">
              <span className="text-xs font-semibold text-slate-500 uppercase">Total Inventory Valuation</span>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                ${stockValuation ? displayMoney(stockValuation.totalValuation) : "0.00"}
              </p>
            </Panel>
            <Panel className="p-4">
              <span className="text-xs font-semibold text-slate-500 uppercase">Total Items On Hand</span>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {stockValuation ? stockValuation.totalQuantity : "0"} units
              </p>
            </Panel>
            <Panel className="p-4">
              <span className="text-xs font-semibold text-slate-500 uppercase">Stock Deficits</span>
              <p
                className={`mt-1 text-2xl font-bold ${
                  stockValuation && stockValuation.openDeficitsCount > 0
                    ? "text-rose-600"
                    : "text-emerald-600"
                }`}
              >
                {stockValuation ? stockValuation.openDeficitsCount : 0} open
              </p>
            </Panel>
          </div>

          <Panel className="overflow-hidden">
            <div className="border-b border-slate-200 px-6 py-4 bg-slate-50">
              <h2 className="text-base font-semibold text-slate-900">
                Stock Valuation & Moving Average Cost Register
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase">
                  <tr>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Item Name</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3 text-right">On-Hand Qty</th>
                    <th className="px-4 py-3">Unit</th>
                    <th className="px-4 py-3 text-right">Avg Unit Cost</th>
                    <th className="px-4 py-3 text-right">Total Valuation</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {stockValuation && stockValuation.items.length > 0 ? (
                    stockValuation.items.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">
                          {item.sku || "—"}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{item.name}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{item.categoryName || "General"}</td>
                        <td className="px-4 py-3 text-right font-medium">{item.quantity}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{item.unitCode}</td>
                        <td className="px-4 py-3 text-right">${displayMoney(item.movingAverageCost)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          ${displayMoney(item.totalValuation)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {item.isDeficit ? (
                            <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
                              Deficit
                            </span>
                          ) : (
                            <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                              In Stock
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                        No catalog items found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* TAB 5: PARTY LEDGERS */}
      {activeTab === "partyLedger" && (
        <div className="space-y-6">
          <Panel className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs font-medium text-slate-600">
                  Select Customer / Supplier:
                  <select
                    className="ml-2 rounded border border-slate-300 px-3 py-1.5 text-sm"
                    value={selectedPartyId}
                    onChange={(e) => {
                      setSelectedPartyId(e.target.value);
                      loadPartyLedger(e.target.value);
                    }}
                  >
                    {parties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.isCustomer ? "(Customer)" : ""} {p.isSupplier ? "(Supplier)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-medium text-slate-600">
                  From:
                  <input
                    type="date"
                    className="ml-1 rounded border border-slate-300 px-2 py-1 text-sm"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  To:
                  <input
                    type="date"
                    className="ml-1 rounded border border-slate-300 px-2 py-1 text-sm"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </label>
                <Button
                  className="btn-secondary"
                  onClick={() => loadPartyLedger(selectedPartyId)}
                >
                  Filter
                </Button>
              </div>
            </div>
          </Panel>

          {partyLedger ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Panel className="p-4">
                  <span className="text-xs font-semibold text-slate-500 uppercase">Receivable Balance Due</span>
                  <p className="mt-1 text-2xl font-bold text-amber-600">
                    ${displayMoney(partyLedger.totalReceivableDue)}
                  </p>
                  <p className="text-xs text-slate-400">Customer unpaid invoices</p>
                </Panel>
                <Panel className="p-4">
                  <span className="text-xs font-semibold text-slate-500 uppercase">Payable Balance Due</span>
                  <p className="mt-1 text-2xl font-bold text-purple-600">
                    ${displayMoney(partyLedger.totalPayableDue)}
                  </p>
                  <p className="text-xs text-slate-400">Supplier unpaid bills</p>
                </Panel>
                <Panel className="p-4">
                  <span className="text-xs font-semibold text-slate-500 uppercase">Unallocated Advances</span>
                  <p className="mt-1 text-2xl font-bold text-slate-700">
                    ${displayMoney(partyLedger.unallocatedAdvance)}
                  </p>
                  <p className="text-xs text-slate-400">Credits/advances on file</p>
                </Panel>
              </div>

              <Panel className="overflow-hidden">
                <div className="border-b border-slate-200 px-6 py-4 bg-slate-50">
                  <h2 className="text-base font-semibold text-slate-900">
                    Statement of Account: {partyLedger.party.name}
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase">
                      <tr>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Document #</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Reference</th>
                        <th className="px-4 py-3 text-right">Debit ($)</th>
                        <th className="px-4 py-3 text-right">Credit ($)</th>
                        <th className="px-4 py-3 text-right">Running Due ($)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-slate-700">
                      {partyLedger.entries.length > 0 ? (
                        partyLedger.entries.map((entry, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="px-4 py-3 text-slate-600">{entry.date}</td>
                            <td className="px-4 py-3 font-mono font-medium text-slate-900">
                              {entry.documentNumber}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600">{entry.documentType}</td>
                            <td className="px-4 py-3 text-xs text-slate-500">{entry.reference || "—"}</td>
                            <td className="px-4 py-3 text-right">
                              {parseFloat(entry.debit) > 0 ? `$${displayMoney(entry.debit)}` : "—"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {parseFloat(entry.credit) > 0 ? `$${displayMoney(entry.credit)}` : "—"}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-900">
                              ${displayMoney(entry.runningBalance)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                            No ledger transactions recorded for this party.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          ) : (
            <EmptyState title="No Party Selected">
              Select a customer or supplier to view their running ledger.
            </EmptyState>
          )}
        </div>
      )}

      {/* TAB 6: CASH REGISTER CLOSE */}
      {activeTab === "cashRegister" && (
        <div className="space-y-6">
          {/* Active Session Status */}
          {currentSession ? (
            <Panel className="p-6 border-l-4 border-l-emerald-500">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                      REGISTER SESSION OPEN
                    </span>
                    <span className="font-mono text-sm font-bold text-slate-900">
                      {currentSession.sessionNumber}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    Drawer: <span className="font-medium text-slate-900">{currentSession.cashAccountName}</span> | Location:{" "}
                    <span className="font-medium text-slate-900">{currentSession.locationName}</span> | Cashier:{" "}
                    <span className="font-medium text-slate-900">{currentSession.openedByUserName}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    Opened: {new Date(currentSession.openedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="btn-primary"
                    onClick={() => {
                      setCloseCountedAmount(currentSession.expectedAmount || currentSession.openingFloat);
                      setCloseSessionModal(true);
                    }}
                  >
                    Count & Close Shift
                  </Button>
                </div>
              </div>

              {/* Real-time cash summary */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-6 text-sm">
                <div className="rounded-lg bg-slate-50 p-4 border border-slate-200">
                  <span className="text-xs font-semibold text-slate-500 uppercase">Opening Float</span>
                  <p className="mt-1 text-xl font-bold text-slate-900">
                    ${displayMoney(currentSession.openingFloat)}
                  </p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-4 border border-emerald-200">
                  <span className="text-xs font-semibold text-emerald-800 uppercase">Cash Inflows</span>
                  <p className="mt-1 text-xl font-bold text-emerald-700">
                    +${displayMoney(currentSession.cashInflows || "0.00")}
                  </p>
                  <p className="text-xs text-emerald-600">Sales & Customer Receipts</p>
                </div>
                <div className="rounded-lg bg-rose-50 p-4 border border-rose-200">
                  <span className="text-xs font-semibold text-rose-800 uppercase">Cash Outflows</span>
                  <p className="mt-1 text-xl font-bold text-rose-700">
                    -${displayMoney(currentSession.cashOutflows || "0.00")}
                  </p>
                  <p className="text-xs text-rose-600">Expenses, Payouts, Transfers</p>
                </div>
                <div className="rounded-lg bg-indigo-50 p-4 border border-indigo-200">
                  <span className="text-xs font-semibold text-indigo-800 uppercase">Expected in Drawer</span>
                  <p className="mt-1 text-xl font-bold text-indigo-700">
                    ${displayMoney(currentSession.expectedAmount || currentSession.openingFloat)}
                  </p>
                  <p className="text-xs text-indigo-600">Real-time ledger balance</p>
                </div>
              </div>
            </Panel>
          ) : (
            <Panel className="p-8 text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 text-xl">
                🔒
              </div>
              <h3 className="text-base font-semibold text-slate-900">No Register Session Currently Open</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                Opening a register shift tracks initial float money, daily sales receipts, customer payments, cash payouts, and shift close variances.
              </p>
              <div>
                <Button className="btn-primary" onClick={() => setOpenSessionModal(true)}>
                  Open Register Session
                </Button>
              </div>
            </Panel>
          )}

          {/* Past Sessions History */}
          <Panel className="overflow-hidden">
            <div className="border-b border-slate-200 px-6 py-4 bg-slate-50">
              <h2 className="text-base font-semibold text-slate-900">
                Register Shift & Daily Close History
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase">
                  <tr>
                    <th className="px-4 py-3">Session #</th>
                    <th className="px-4 py-3">Cash Drawer</th>
                    <th className="px-4 py-3">Opened At</th>
                    <th className="px-4 py-3">Closed At</th>
                    <th className="px-4 py-3 text-right">Opening Float</th>
                    <th className="px-4 py-3 text-right">Expected</th>
                    <th className="px-4 py-3 text-right">Counted</th>
                    <th className="px-4 py-3 text-right">Variance</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {sessionsHistory.length > 0 ? (
                    sessionsHistory.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono font-medium text-slate-900">{s.sessionNumber}</td>
                        <td className="px-4 py-3 text-slate-600">{s.cashAccountName || "Cash Account"}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {new Date(s.openedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {s.closedAt ? new Date(s.closedAt).toLocaleString() : "Active"}
                        </td>
                        <td className="px-4 py-3 text-right">${displayMoney(s.openingFloat)}</td>
                        <td className="px-4 py-3 text-right">
                          {s.expectedAmount ? `$${displayMoney(s.expectedAmount)}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {s.countedAmount ? `$${displayMoney(s.countedAmount)}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {s.varianceAmount ? (
                            <span
                              className={
                                s.varianceAmount === "0.00"
                                  ? "text-emerald-600"
                                  : "text-rose-600 font-semibold"
                              }
                            >
                              ${displayMoney(s.varianceAmount)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">
                          {s.varianceReason || "—"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`rounded px-2 py-0.5 text-xs font-semibold ${
                              s.status === "Open"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-slate-100 text-slate-800"
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                        No previous cash register sessions recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* MODAL: OPEN REGISTER SESSION */}
      {openSessionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Open Register Shift</h3>
            <form onSubmit={handleOpenSession} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">Store Location</label>
                <select
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={openLocationId}
                  onChange={(e) => setOpenLocationId(e.target.value)}
                  required
                >
                  {registerWorkspace?.locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Terminal / Device</label>
                <select
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={openDeviceId}
                  onChange={(e) => setOpenDeviceId(e.target.value)}
                  required
                >
                  {registerWorkspace?.devices.map((dev) => (
                    <option key={dev.id} value={dev.id}>
                      {dev.deviceName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Cash Drawer Account</label>
                <select
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={openCashAccountId}
                  onChange={(e) => setOpenCashAccountId(e.target.value)}
                  required
                >
                  {registerWorkspace?.cashAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Opening Cash Float ($)</label>
                <input
                  type="text"
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  placeholder="0.00"
                  value={openOpeningFloat}
                  onChange={(e) => setOpenOpeningFloat(e.target.value)}
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button className="btn-secondary" type="button" onClick={() => setOpenSessionModal(false)}>
                  Cancel
                </Button>
                <Button className="btn-primary" type="submit">
                  Open Register
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CLOSE REGISTER SESSION */}
      {closeSessionModal && currentSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">
              Count & Close Shift ({currentSession.sessionNumber})
            </h3>
            <p className="text-xs text-slate-500">
              Compare actual cash drawer float against expected system ledger calculations.
            </p>

            <div className="rounded bg-slate-50 p-3 text-sm space-y-1 border border-slate-200">
              <div className="flex justify-between text-slate-600">
                <span>Opening Float:</span>
                <span>${displayMoney(currentSession.openingFloat)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>System Expected Total:</span>
                <span className="font-bold text-indigo-700">
                  ${displayMoney(currentSession.expectedAmount || currentSession.openingFloat)}
                </span>
              </div>
            </div>

            <form onSubmit={handleCloseSession} className="space-y-4">
              <div>
                <label htmlFor="countedCashInput" className="block text-xs font-medium text-slate-700">
                  Counted Cash in Drawer ($)
                </label>
                <input
                  id="countedCashInput"
                  type="text"
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
                  value={closeCountedAmount}
                  onChange={(e) => setCloseCountedAmount(e.target.value)}
                  required
                />
              </div>

              <div className="rounded p-3 text-sm font-medium border flex justify-between items-center bg-slate-50">
                <span>Calculated Variance:</span>
                <span
                  className={
                    hasVariance
                      ? "text-rose-700 font-bold"
                      : "text-emerald-700 font-bold"
                  }
                >
                  ${displayMoney(currentVariance)} {hasVariance ? "(Discrepancy)" : "(Balanced)"}
                </span>
              </div>

              {hasVariance && (
                <div>
                  <label htmlFor="varianceReasonInput" className="block text-xs font-medium text-rose-700">
                    Mandatory Reason for Variance *
                  </label>
                  <textarea
                    id="varianceReasonInput"
                    className="mt-1 block w-full rounded border border-rose-300 px-3 py-2 text-sm focus:border-rose-500"
                    rows={3}
                    placeholder="e.g. Missing $5 change, customer underpayment, damaged banknote..."
                    value={closeVarianceReason}
                    onChange={(e) => setCloseVarianceReason(e.target.value)}
                    required
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button className="btn-secondary" type="button" onClick={() => setCloseSessionModal(false)}>
                  Cancel
                </Button>
                <Button className="btn-primary" type="submit">
                  Close & Freeze Register
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
