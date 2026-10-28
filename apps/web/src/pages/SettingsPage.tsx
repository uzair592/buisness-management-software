import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@business/ui";
import { useAuth } from "../context/AuthContext";
import {
  type DeviceEnrollment,
  type LocationSummary,
} from "@business/contracts";
import {
  closeActiveLocalDb,
  PartitionedLocalDatabase,
} from "../db/index";
import { exportPendingRecovery, inspectPendingRecovery, listPendingPartitions, type PendingPartitionSummary } from "../db/recovery";
import {
  type PrintSettings,
  type TemplateFormat,
  type LogoSize,
  loadPrintSettings,
  savePrintSettings,
  PrintDocumentModal,
} from "../templates";

interface RestoreDifference {
  active: number;
  archive: number;
  delta: number;
}

interface RestoreInspectionResult {
  valid: boolean;
  manifest: {
    businessName: string;
    datasetEpoch: number;
    exportedAt: string;
  };
  activeBusiness: {
    currentEpoch: number;
  };
  differences: Record<string, RestoreDifference>;
}

interface CsvValidationError {
  row: number;
  field: string;
  message: string;
}

interface CsvDryRunResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: CsvValidationError[];
  preview: unknown[];
}

export function SettingsPage() {
  const auth = useAuth();
  const [tab, setTab] = useState<"signin" | "register">("signin");

  // Sign in form state
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  // Register form state
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regFullName, setRegFullName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regBusinessName, setRegBusinessName] = useState("");
  const [regCurrency, setRegCurrency] = useState("PKR");
  const [regError, setRegError] = useState<string | null>(null);
  const [regSubmitting, setRegSubmitting] = useState(false);

  // Password change form state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [pwStatus, setPwStatus] = useState<{ success?: boolean; error?: string } | null>(
    null,
  );
  const [pwSubmitting, setPwSubmitting] = useState(false);

  // Devices & Locations state
  const [devices, setDevices] = useState<DeviceEnrollment[]>([]);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [newDeviceName, setNewDeviceName] = useState("");
  const [newDeviceLocationId, setNewDeviceLocationId] = useState("");
  const [newDevicePrefix, setNewDevicePrefix] = useState("");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceSubmitting, setDeviceSubmitting] = useState(false);

  // Active Sessions
  const [sessions, setSessions] = useState<
    Array<{
      id: string;
      createdAt: string;
      expiresAt: string;
      userAgent: string | null;
      ipAddress: string | null;
      isCurrent: boolean;
    }>
  >([]);

  // Existing local issued work remains accessible during the online cutover.
  const [pendingPartitions, setPendingPartitions] = useState<PendingPartitionSummary[]>([]);
  const [recoveryPassphrase, setRecoveryPassphrase] = useState("");
  const [recoveryConfirm, setRecoveryConfirm] = useState("");
  const [recoveryStatus, setRecoveryStatus] = useState("");
  const [inspectionPassphrase, setInspectionPassphrase] = useState("");
  const [inspection, setInspection] = useState<Awaited<ReturnType<typeof inspectPendingRecovery>> | null>(null);
  const [inspectionError, setInspectionError] = useState("");
  useEffect(() => { setInspection(null); setInspectionError(""); setInspectionPassphrase(""); }, [auth.selectedBusinessId]);

  // Print & Invoice Templates state
  const [printSettings, setPrintSettings] = useState<PrintSettings>(() => loadPrintSettings());
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [printSavedNotice, setPrintSavedNotice] = useState(false);

  function handleUpdatePrintSettings(patch: Partial<PrintSettings>) {
    const updated = savePrintSettings(patch);
    setPrintSettings(updated);
    setPrintSavedNotice(true);
    setTimeout(() => setPrintSavedNotice(false), 2000);
  }

  // Backup & Restore state
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [backupExporting, setBackupExporting] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [restoreEnvelope, setRestoreEnvelope] = useState<unknown | null>(null);
  const [restoreInspection, setRestoreInspection] = useState<RestoreInspectionResult | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restorePromoting, setRestorePromoting] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);

  // CSV Import/Export state
  const [csvTab, setCsvTab] = useState<"items" | "parties">("items");
  const [csvText, setCsvText] = useState("");
  const [csvDryRun, setCsvDryRun] = useState<CsvDryRunResult | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvSuccess, setCsvSuccess] = useState<string | null>(null);

  async function handleExportArchive() {
    if (backupPassphrase.length < 8) {
      setBackupStatus("Passphrase must be at least 8 characters");
      return;
    }
    setBackupExporting(true);
    setBackupStatus(null);
    try {
      const res = await fetch("/v1/backup/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": auth.csrfToken || "",
        },
        body: JSON.stringify({ passphrase: backupPassphrase }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Export failed");

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bms-backup-${auth.selectedBusinessId}-${new Date().toISOString().slice(0, 10)}.bms.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupPassphrase("");
      setBackupStatus("Encrypted backup downloaded successfully. Store passphrase securely.");
    } catch (err: unknown) {
      setBackupStatus(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBackupExporting(false);
    }
  }

  async function handleLoadRestoreFile(file: File | undefined) {
    setRestoreError(null);
    setRestoreInspection(null);
    setRestoreEnvelope(null);
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (parsed.format !== "bms-tenant-archive-v1") {
        throw new Error("Invalid file format. Please select a .bms.json archive.");
      }
      setRestoreEnvelope(parsed);
    } catch (err: unknown) {
      setRestoreError(err instanceof Error ? err.message : "Could not read backup file");
    }
  }

  async function handleInspectRestore() {
    if (!restoreEnvelope) {
      setRestoreError("Please upload a backup file first");
      return;
    }
    if (restorePassphrase.length < 8) {
      setRestoreError("Enter archive passphrase (min 8 characters)");
      return;
    }
    setRestoreLoading(true);
    setRestoreError(null);
    try {
      const res = await fetch("/v1/backup/inspect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": auth.csrfToken || "",
        },
        body: JSON.stringify({
          envelope: restoreEnvelope,
          passphrase: restorePassphrase,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Inspection failed");
      setRestoreInspection(data);
    } catch (err: unknown) {
      setRestoreError(err instanceof Error ? err.message : "Inspection failed");
    } finally {
      setRestoreLoading(false);
    }
  }

  async function handlePromoteRestore() {
    if (!restoreEnvelope || !restorePassphrase) return;
    if (
      !confirm(
        "WARNING: Restoring this archive will advance the dataset epoch, revoke all active cashier sessions, and fence existing devices. Continue?",
      )
    ) {
      return;
    }
    setRestorePromoting(true);
    setRestoreError(null);
    try {
      const res = await fetch("/v1/backup/promote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": auth.csrfToken || "",
        },
        body: JSON.stringify({
          envelope: restoreEnvelope,
          passphrase: restorePassphrase,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Promotion failed");
      setRestoreSuccess(`Archive restored! Dataset epoch advanced to ${data.newDatasetEpoch}.`);
      setRestoreInspection(null);
      setRestoreEnvelope(null);
      setRestorePassphrase("");
    } catch (err: unknown) {
      setRestoreError(err instanceof Error ? err.message : "Promotion failed");
    } finally {
      setRestorePromoting(false);
    }
  }

  async function handleCsvDryRun() {
    if (!csvText.trim()) {
      setCsvError("Paste or upload CSV content first");
      return;
    }
    setCsvLoading(true);
    setCsvError(null);
    setCsvDryRun(null);
    setCsvSuccess(null);
    try {
      const res = await fetch(`/v1/import/${csvTab}/dry-run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": auth.csrfToken || "",
        },
        body: JSON.stringify({ csvText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Validation failed");
      setCsvDryRun(data);
    } catch (err: unknown) {
      setCsvError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setCsvLoading(false);
    }
  }

  async function handleCsvCommit() {
    if (!csvDryRun || !csvDryRun.preview.length) return;
    setCsvLoading(true);
    setCsvError(null);
    try {
      const batchId = crypto.randomUUID();
      const res = await fetch(`/v1/import/${csvTab}/commit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": auth.csrfToken || "",
        },
        body: JSON.stringify({
          batchId,
          [csvTab]: csvDryRun.preview,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Commit failed");
      setCsvSuccess(`Successfully imported ${data.count} ${csvTab}!`);
      setCsvDryRun(null);
      setCsvText("");
    } catch (err: unknown) {
      setCsvError(err instanceof Error ? err.message : "Commit failed");
    } finally {
      setCsvLoading(false);
    }
  }

  const refreshPendingPartitions = useCallback(async () => {
    if (!auth.user || !auth.selectedBusinessId) { setPendingPartitions([]); return; }
    try { setPendingPartitions(await listPendingPartitions(auth.user.id, auth.selectedBusinessId)); }
    catch { setRecoveryStatus("Could not inspect this browser's saved work. Keep this browser profile for review."); }
  }, [auth.user, auth.selectedBusinessId]);
  useEffect(() => { void refreshPendingPartitions(); }, [refreshPendingPartitions]);

  async function downloadPartitionRecovery(partition: PendingPartitionSummary) {
    if (recoveryPassphrase.length < 12 || recoveryPassphrase !== recoveryConfirm) {
      setRecoveryStatus("Enter matching recovery passphrases of at least 12 characters."); return;
    }
    const db = new PartitionedLocalDatabase(partition.name);
    try {
      const encrypted = await exportPendingRecovery(db, recoveryPassphrase);
      const url = URL.createObjectURL(new Blob([encrypted], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = `bms-recovery-epoch-${partition.datasetEpoch}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setRecoveryPassphrase(""); setRecoveryConfirm("");
      setRecoveryStatus("Encrypted recovery downloaded. Keep its passphrase separately; the file cannot be opened without it.");
    } catch (cause) { setRecoveryStatus(cause instanceof Error ? cause.message : "Recovery export failed"); }
    finally { db.close(); }
  }

  async function inspectRecoveryFile(file: File | undefined) {
    setInspection(null); setInspectionError("");
    if (!file || !auth.selectedBusinessId) return;
    if (file.size > 10_000_000) { setInspectionError("Recovery file is too large for review."); return; }
    try {
      setInspection(await inspectPendingRecovery(await file.text(), inspectionPassphrase, auth.selectedBusinessId));
      setInspectionPassphrase("");
    } catch (cause) { setInspectionError(cause instanceof Error ? cause.message : "Recovery inspection failed"); }
  }

  const isOwner = auth.activeMembership?.role === "Owner";

  // Clear stale UI state and close local database partition when business/user changes or logs out
  useEffect(() => {
    if (!auth.authenticated || !auth.selectedBusinessId) {
      setDevices([]);
      setLocations([]);
      setSessions([]);
      closeActiveLocalDb();
    }
  }, [auth.authenticated, auth.selectedBusinessId]);

  // Load locations, devices, sessions when authenticated with selected business
  useEffect(() => {
    if (!auth.authenticated || !auth.selectedBusinessId) return;

    void (async () => {
      try {
        const [locRes, devRes, sessRes] = await Promise.all([
          fetch("/v1/locations", { credentials: "include" }),
          fetch("/v1/devices", { credentials: "include" }),
          fetch("/v1/auth/sessions", { credentials: "include" }),
        ]);

        // An authorization failure must not erase older issued browser records.
        if (
          locRes.status === 401 ||
          locRes.status === 403 ||
          devRes.status === 401 ||
          devRes.status === 403
        ) {
          closeActiveLocalDb();
          setDevices([]);
          setLocations([]);
          return;
        }

        if (locRes.ok) {
          const locs = await locRes.json();
          setLocations(locs);
          if (locs.length > 0 && !newDeviceLocationId) {
            setNewDeviceLocationId(locs[0].id);
          }
        }
        if (devRes.ok) {
          const fetchedDevices = await devRes.json();
          setDevices(fetchedDevices);
        }
        if (sessRes.ok) {
          setSessions(await sessRes.json());
        }
      } catch {
        // Network errors are shown by the affected online action.
      }
    })();
  }, [auth.authenticated, auth.selectedBusinessId]);


  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setLoginSubmitting(true);
    const res = await auth.login({
      username: loginUsername,
      password: loginPassword,
    });
    setLoginSubmitting(false);
    if (!res.success) {
      setLoginError(res.error || "Login failed");
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setRegError(null);
    setRegSubmitting(true);
    const res = await auth.register({
      username: regUsername,
      password: regPassword,
      fullName: regFullName,
      email: regEmail || null,
      businessName: regBusinessName,
      currency: regCurrency,
    });
    setRegSubmitting(false);
    if (!res.success) {
      setRegError(res.error || "Registration failed");
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwStatus(null);
    setPwSubmitting(true);
    const res = await auth.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: revokeOthers,
    });
    setPwSubmitting(false);
    if (res.success) {
      setPwStatus({ success: true });
      setCurrentPassword("");
      setNewPassword("");
      // Refresh sessions
      const sRes = await fetch("/v1/auth/sessions", { credentials: "include" });
      if (sRes.ok) setSessions(await sRes.json());
    } else {
      setPwStatus({ error: res.error || "Failed to update password" });
    }
  }

  async function handleEnrollDevice(e: FormEvent) {
    e.preventDefault();
    setDeviceError(null);
    setDeviceSubmitting(true);

    const targetLocationId =
      newDeviceLocationId ||
      locations[0]?.id ||
      auth.activeMembership?.locationId ||
      "";

    try {
      const res = await fetch("/v1/devices/enroll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": auth.csrfToken || "",
        },
        body: JSON.stringify({
          deviceName: newDeviceName,
          locationId: targetLocationId,
          numberPrefix: newDevicePrefix.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setDeviceError(data.error || "Device enrollment failed");
      } else {
        setNewDeviceName("");
        setNewDevicePrefix("");
        // Reload devices
        const devRes = await fetch("/v1/devices", { credentials: "include" });
        if (devRes.ok) setDevices(await devRes.json());
      }
    } catch (err: unknown) {
      setDeviceError(err instanceof Error ? err.message : "Network error");
    } finally {
      setDeviceSubmitting(false);
    }
  }

  async function handleRevokeDevice(deviceEnrollmentId: string) {
    if (!confirm("Revoke this device? It can no longer be used for online billing. Preserve any older browser-issued bills for review.")) {
      return;
    }

    try {
      const res = await fetch("/v1/devices/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": auth.csrfToken || "",
        },
        body: JSON.stringify({ deviceEnrollmentId }),
      });
      if (res.ok) {
        const devRes = await fetch("/v1/devices", { credentials: "include" });
        if (devRes.ok) setDevices(await devRes.json());
      }
    } catch {
      // network error
    }
  }

  async function handleRevokeSession(sessionId: string) {
    try {
      await fetch(`/v1/auth/sessions/${sessionId}/revoke`, {
        method: "POST",
        headers: {
          "x-csrf-token": auth.csrfToken || "",
        },
      });
      const sRes = await fetch("/v1/auth/sessions", { credentials: "include" });
      if (sRes.ok) setSessions(await sRes.json());
    } catch {
      // network error
    }
  }

  if (auth.loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <p className="text-gray-500">Checking authentication state...</p>
      </div>
    );
  }

  if (!auth.authenticated) {
    return (
      <div className="p-6 max-w-xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Settings
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Sign in with your username and password, or create a new business owner account.
          </p>
        </div>

        <div className="flex border-b border-gray-200">
          <button
            type="button"
            className={`py-2 px-4 text-sm font-medium border-b-2 transition-colors ${
              tab === "signin"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setTab("signin")}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`py-2 px-4 text-sm font-medium border-b-2 transition-colors ${
              tab === "register"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setTab("register")}
          >
            Register Owner Account
          </button>
        </div>

        {tab === "signin" && (
          <form onSubmit={handleLogin} className="space-y-4 bg-white p-6 rounded-lg border shadow-sm">
            {loginError && (
              <div
                role="alert"
                className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded"
              >
                {loginError}
              </div>
            )}
            <div>
              <label
                htmlFor="login-username"
                className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1"
              >
                Username
              </label>
              <input
                id="login-username"
                type="text"
                required
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Enter username"
              />
              <p className="text-xs text-gray-400 mt-1">Global unique username (not email)</p>
            </div>
            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1"
              >
                Password
              </label>
              <input
                id="login-password"
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Enter password"
              />
            </div>
            <Button type="submit" disabled={loginSubmitting} className="w-full">
              {loginSubmitting ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        )}

        {tab === "register" && (
          <form onSubmit={handleRegister} className="space-y-4 bg-white p-6 rounded-lg border shadow-sm">
            {regError && (
              <div
                role="alert"
                className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded"
              >
                {regError}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="reg-username"
                  className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1"
                >
                  Username *
                </label>
                <input
                  id="reg-username"
                  type="text"
                  required
                  value={regUsername}
                  onChange={(e) => setRegUsername(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="e.g. uzair"
                />
              </div>
              <div>
                <label
                  htmlFor="reg-fullname"
                  className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1"
                >
                  Full Name *
                </label>
                <input
                  id="reg-fullname"
                  type="text"
                  required
                  value={regFullName}
                  onChange={(e) => setRegFullName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="e.g. Muhammad Uzair"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="reg-password"
                className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1"
              >
                Password * (min 8 chars)
              </label>
              <input
                id="reg-password"
                type="password"
                required
                minLength={8}
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Choose a strong password"
              />
            </div>
            <div>
              <label
                htmlFor="reg-email"
                className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1"
              >
                Recovery Email (Optional)
              </label>
              <input
                id="reg-email"
                type="email"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="optional@example.com"
              />
              <p className="text-xs text-gray-400 mt-1">Used for optional owner recovery, not required for login</p>
            </div>
            <div className="pt-2 border-t">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Initial Business Profile</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="reg-business-name"
                    className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1"
                  >
                    Business Name *
                  </label>
                  <input
                    id="reg-business-name"
                    type="text"
                    required
                    value={regBusinessName}
                    onChange={(e) => setRegBusinessName(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="e.g. Apex Traders"
                  />
                </div>
                <div>
                  <label
                    htmlFor="reg-currency"
                    className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1"
                  >
                    Currency
                  </label>
                  <select
                    id="reg-currency"
                    value={regCurrency}
                    onChange={(e) => setRegCurrency(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="PKR">PKR (Pakistani Rupee)</option>
                    <option value="USD">USD (US Dollar)</option>
                    <option value="EUR">EUR (Euro)</option>
                    <option value="GBP">GBP (British Pound)</option>
                    <option value="AED">AED (UAE Dirham)</option>
                    <option value="SAR">SAR (Saudi Riyal)</option>
                  </select>
                </div>
              </div>
            </div>
            <Button type="submit" disabled={regSubmitting} className="w-full">
              {regSubmitting ? "Creating Account & Business..." : "Create Owner Account"}
            </Button>
          </form>
        )}
      </div>
    );
  }

  // Authenticated state
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Account, business access, devices and recovery of older browser-issued bills.
        </p>
      </div>

      {/* Profile Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-lg border shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-gray-900">{auth.user?.fullName}</h2>
            <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
              {auth.activeMembership?.role ?? "Member"}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Username: <b>@{auth.user?.username}</b>
            {auth.user?.email && ` · Email: ${auth.user.email}`}
          </p>
        </div>
        <Button onClick={() => void auth.logout()} className="btn-secondary">
          Log Out
        </Button>
      </div>

      {/* Business Switcher */}
      <div className="bg-white p-6 rounded-lg border shadow-sm space-y-4">
        <h2 className="text-base font-bold text-gray-900">Active Business & Scope</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="select-business"
              className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1"
            >
              Select Authorized Business
            </label>
            <select
              id="select-business"
              value={auth.selectedBusinessId ?? ""}
              onChange={(e) => void auth.selectBusiness(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm bg-white"
            >
              {auth.memberships.map((m) => (
                <option key={m.businessId} value={m.businessId}>
                  {m.businessName} ({m.role})
                </option>
              ))}
            </select>
          </div>
          <div className="bg-gray-50 p-3 rounded border text-xs space-y-1">
            <p>
              <b>Location:</b> {auth.activeMembership?.locationName ?? "Main Branch"}
            </p>
            <p>
              <b>Role:</b> {auth.activeMembership?.role}
            </p>
            <p>
              <b>Permission Version:</b> {auth.activeMembership?.permissionVersion}
            </p>
          </div>
        </div>
      </div>

      {/* Invoice Templates & Print Settings */}
      <div className="bg-white p-6 rounded-lg border shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b pb-4">
          <div>
            <h2 className="text-base font-bold text-gray-900">Invoice Templates & Printing</h2>
            <p className="text-xs text-gray-500 mt-1">
              Configure invoice formats (A4 standard, 80mm thermal, 58mm compact), business logo, and tax numbering.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {printSavedNotice && (
              <span className="text-xs text-emerald-700 font-semibold bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200">
                Settings Saved
              </span>
            )}
            <Button
              type="button"
              onClick={() => setPreviewModalOpen(true)}
              className="btn-primary text-xs py-1.5 px-3"
            >
              Preview & Test Print
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1">
              Default Format
            </label>
            <select
              value={printSettings.template}
              onChange={(e) => handleUpdatePrintSettings({ template: e.target.value as TemplateFormat })}
              className="w-full px-3 py-2 border rounded-md text-sm bg-white"
            >
              <option value="a4">A4 Full Page (Formal Tax Invoice)</option>
              <option value="80mm">80mm Thermal (POS Counter Receipt)</option>
              <option value="58mm">58mm Thermal (Compact Roll Receipt)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1">
              Custom Invoice Title
            </label>
            <input
              type="text"
              value={printSettings.customTitle}
              onChange={(e) => handleUpdatePrintSettings({ customTitle: e.target.value })}
              placeholder="e.g. TAX INVOICE, CASH MEMO"
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1">
              Tax / NTN / GST Number
            </label>
            <input
              type="text"
              value={printSettings.taxNumber}
              onChange={(e) => handleUpdatePrintSettings({ taxNumber: e.target.value })}
              placeholder="e.g. NTN: 1234567-8"
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1">
              Business Phone (Print Header)
            </label>
            <input
              type="text"
              value={printSettings.businessPhone}
              onChange={(e) => handleUpdatePrintSettings({ businessPhone: e.target.value })}
              placeholder="e.g. +92 300 1234567"
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1">
              Business Address (Print Header)
            </label>
            <input
              type="text"
              value={printSettings.businessAddress}
              onChange={(e) => handleUpdatePrintSettings({ businessAddress: e.target.value })}
              placeholder="Shop #, Market, City"
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1">
              Logo Image URL (or Data URI)
            </label>
            <input
              type="text"
              value={printSettings.logoUrl}
              onChange={(e) => handleUpdatePrintSettings({ logoUrl: e.target.value })}
              placeholder="https://... or data:image/png;base64,..."
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1">
              Logo Display Size
            </label>
            <select
              value={printSettings.logoSize}
              onChange={(e) => handleUpdatePrintSettings({ logoSize: e.target.value as LogoSize })}
              className="w-full px-3 py-2 border rounded-md text-sm bg-white"
            >
              <option value="none">Hidden (No Logo)</option>
              <option value="sm">Small (Compact)</option>
              <option value="md">Medium (Standard)</option>
              <option value="lg">Large (Prominent)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1">
            Footer Terms & Conditions
          </label>
          <textarea
            rows={2}
            value={printSettings.footerNotes}
            onChange={(e) => handleUpdatePrintSettings({ footerNotes: e.target.value })}
            className="w-full px-3 py-2 border rounded-md text-sm resize-none"
            placeholder="Terms, return policy, or thank you note"
          />
        </div>

        <div className="flex flex-wrap gap-6 pt-2 border-t">
          <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={printSettings.showTaxDetails}
              onChange={(e) => handleUpdatePrintSettings({ showTaxDetails: e.target.checked })}
              className="rounded text-blue-600"
            />
            <span>Show Tax Breakdown Column</span>
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={printSettings.showSignature}
              onChange={(e) => handleUpdatePrintSettings({ showSignature: e.target.checked })}
              className="rounded text-blue-600"
            />
            <span>Show Authorized Signature Box (A4)</span>
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={printSettings.showReprintWatermark}
              onChange={(e) => handleUpdatePrintSettings({ showReprintWatermark: e.target.checked })}
              className="rounded text-blue-600"
            />
            <span>Show Distinct Reprint / Duplicate Badge on History Reprints</span>
          </label>
        </div>
      </div>

      {/* Devices remain necessary for server-issued invoice numbers. */}
      <div className="bg-white p-6 rounded-lg border shadow-sm space-y-6">
        <div>
          <h2 className="text-base font-bold text-gray-900">Enrolled Devices</h2>
          <p className="text-xs text-gray-500 mt-1">
            Each device has its own invoice number prefix. Billing requires a live server connection.
          </p>
        </div>

        {/* Enroll form (Owner only) */}
        {isOwner && (
          <form onSubmit={handleEnrollDevice} className="p-4 bg-gray-50 rounded-lg border space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Enroll New Device</h3>
            {deviceError && (
              <p className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
                {deviceError}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="new-device-name"
                  className="block text-xs text-gray-600 mb-1"
                >
                  Device Name *
                </label>
                <input
                  id="new-device-name"
                  type="text"
                  required
                  placeholder="e.g. Counter Register"
                  value={newDeviceName}
                  onChange={(e) => setNewDeviceName(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm border rounded bg-white"
                />
              </div>
              <div>
                <label
                  htmlFor="new-device-loc"
                  className="block text-xs text-gray-600 mb-1"
                >
                  Location *
                </label>
                <select
                  id="new-device-loc"
                  value={newDeviceLocationId}
                  onChange={(e) => setNewDeviceLocationId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm border rounded bg-white"
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="new-device-prefix"
                  className="block text-xs text-gray-600 mb-1"
                >
                  Prefix (Optional)
                </label>
                <input
                  id="new-device-prefix"
                  type="text"
                  placeholder="Auto (e.g. D01)"
                  value={newDevicePrefix}
                  onChange={(e) => setNewDevicePrefix(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm border rounded bg-white"
                />
              </div>
            </div>
            <Button type="submit" disabled={deviceSubmitting} className="text-xs">
              {deviceSubmitting ? "Enrolling..." : "Enroll Device"}
            </Button>
          </form>
        )}

        {/* Devices list */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 border-b text-gray-600">
              <tr>
                <th className="p-2">Device Name</th>
                <th className="p-2">Prefix</th>
                <th className="p-2">Status</th>
                <th className="p-2">Enrolled</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {devices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-gray-400">
                    No devices enrolled for this business yet.
                  </td>
                </tr>
              ) : (
                devices.map((dev) => (
                  <tr key={dev.id} className="hover:bg-gray-50">
                    <td className="p-2 font-medium">{dev.deviceName}</td>
                    <td className="p-2 font-mono text-blue-700 bg-blue-50 rounded inline-block my-1 px-1.5">
                      {dev.numberPrefix}
                    </td>
                    <td className="p-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                          dev.status === "Enrolled"
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {dev.status}
                      </span>
                    </td>
                    <td className="p-2 text-gray-500">
                      {new Date(dev.enrolledAt).toLocaleDateString()}
                    </td>
                    <td className="p-2 space-x-2">
                      {dev.status === "Enrolled" && (
                        <>
                          {isOwner && (
                            <Button
                              onClick={() => void handleRevokeDevice(dev.id)}
                              className="btn-ghost text-[11px] text-red-600 py-1 px-2"
                            >
                              Revoke
                            </Button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!pendingPartitions.length && recoveryStatus && <p role="alert" className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">{recoveryStatus}</p>}
        {pendingPartitions.length > 0 && <section aria-label="Saved issued work" className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
          <h3 className="font-bold">Issued work saved in this browser</h3>
          <p className="text-sm">These are older device-issued bills. Online-only billing does not upload them automatically. Export each encrypted recovery file and keep this browser profile for authorised reconciliation; do not issue a second sale for the same transaction.</p>
          <ul className="text-sm list-disc pl-5">{pendingPartitions.map((partition) =>
            <li key={partition.name}>Epoch {partition.datasetEpoch} · Device {partition.enrollmentId} · {partition.count} bill(s)
              <button type="button" className="btn-ghost" onClick={() => void downloadPartitionRecovery(partition)}>Download encrypted recovery</button>
            </li>)}</ul>
          <label className="block text-sm">Recovery passphrase<input className="input" type="password" autoComplete="new-password"
            value={recoveryPassphrase} onChange={(event) => setRecoveryPassphrase(event.target.value)} /></label>
          <label className="block text-sm">Confirm passphrase<input className="input" type="password" autoComplete="new-password"
            value={recoveryConfirm} onChange={(event) => setRecoveryConfirm(event.target.value)} /></label>
          {recoveryStatus && <p role="status" className="text-sm">{recoveryStatus}</p>}
        </section>}
        {auth.selectedBusinessId && <section aria-label="Inspect recovery file" className="p-4 bg-white border rounded-lg space-y-3">
          <h3 className="font-bold">Inspect encrypted recovery</h3>
          <p className="text-sm">Review saved bills for this business. The file is decrypted in this browser; inspection does not upload, restore or replay issued work.</p>
          <label className="block text-sm">File passphrase<input className="input" type="password" autoComplete="off"
            value={inspectionPassphrase} onChange={(event) => setInspectionPassphrase(event.target.value)} /></label>
          <label className="block text-sm">Recovery file<input className="input" type="file" accept=".json,application/json"
            onChange={(event) => { void inspectRecoveryFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
          {inspectionError && <p role="alert" className="text-sm text-red-700">{inspectionError}</p>}
          {inspection && inspection.businessId === auth.selectedBusinessId && <div role="status" className="text-sm space-y-2">
            <p>Epoch {inspection.datasetEpoch} · Device {inspection.deviceEnrollmentId} · {inspection.records.length} issued bill(s)</p>
            <ul className="list-disc pl-5">{inspection.records.map((record) =>
              <li key={record.number}>{record.number} · {record.state} · {new Date(record.issuedAt).toLocaleString()}</li>)}</ul>
            <p>Keep this file and its passphrase for authorised review. No commands were submitted.</p>
          </div>}
        </section>}
      </div>

      {/* Backup, Restore & Data Portability (M11) */}
      <div className="bg-white p-6 rounded-lg border shadow-sm space-y-6">
        <div>
          <h2 className="text-base font-bold text-gray-900">Backup, Restore & Data Portability</h2>
          <p className="text-xs text-gray-500 mt-1">
            Export encrypted business archives, inspect restore diffs with epoch fencing, and import/export CSV catalogue records.
          </p>
        </div>

        {/* Cloud Archive Export & Restore */}
        <div className="p-4 bg-gray-50 rounded-lg border space-y-4">
          <h3 className="text-sm font-bold text-gray-800">1. Encrypted Single-Business Archive</h3>
          <p className="text-xs text-gray-600">
            Export a complete, self-contained JSON archive protected with AES-256-GCM. Includes all catalogue items, parties, sales, purchases, payments, expenses, and double-entry journals.
          </p>

          {backupStatus && (
            <p className="text-xs p-2 bg-blue-50 border border-blue-200 text-blue-800 rounded">
              {backupStatus}
            </p>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-gray-600 mb-1 font-semibold">
                Backup Passphrase (min 8 chars)
              </label>
              <input
                type="password"
                value={backupPassphrase}
                onChange={(e) => setBackupPassphrase(e.target.value)}
                placeholder="Choose a strong passphrase"
                className="w-full px-2.5 py-1.5 text-sm border rounded bg-white"
              />
            </div>
            <Button
              type="button"
              disabled={backupExporting || backupPassphrase.length < 8}
              onClick={() => void handleExportArchive()}
              className="btn-primary text-xs"
            >
              {backupExporting ? "Exporting..." : "Download Encrypted Backup (.bms.json)"}
            </Button>
          </div>

          <div className="pt-4 border-t border-gray-200 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700">
              Inspect & Restore Backup Archive
            </h4>
            <p className="text-xs text-gray-500">
              Inspecting an archive verifies integrity checksums and compares record counts against current business activity without modifying data.
            </p>

            {restoreError && (
              <p className="text-xs p-2 bg-red-50 border border-red-200 text-red-700 rounded">
                {restoreError}
              </p>
            )}
            {restoreSuccess && (
              <p className="text-xs p-2 bg-green-50 border border-green-200 text-green-800 rounded">
                {restoreSuccess}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Upload Backup (.bms.json)
                </label>
                <input
                  type="file"
                  accept=".json,.bms.json,application/json"
                  onChange={(e) => void handleLoadRestoreFile(e.target.files?.[0])}
                  className="w-full text-xs text-gray-600 file:mr-2 file:py-1 file:px-2 file:rounded file:border file:text-xs file:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Archive Passphrase
                </label>
                <input
                  type="password"
                  value={restorePassphrase}
                  onChange={(e) => setRestorePassphrase(e.target.value)}
                  placeholder="Enter archive passphrase"
                  className="w-full px-2.5 py-1.5 text-sm border rounded bg-white"
                />
              </div>
            </div>

            <Button
              type="button"
              disabled={restoreLoading || !restoreEnvelope || restorePassphrase.length < 8}
              onClick={() => void handleInspectRestore()}
              className="btn-secondary text-xs"
            >
              {restoreLoading ? "Inspecting..." : "Inspect Archive Differences"}
            </Button>

            {restoreInspection && (
              <div className="mt-4 p-3 bg-white rounded border border-gray-300 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-gray-900">
                    Archive: {restoreInspection.manifest.businessName} (Epoch {restoreInspection.manifest.datasetEpoch})
                  </span>
                  <span className="text-gray-500">
                    Exported: {new Date(restoreInspection.manifest.exportedAt).toLocaleDateString()}
                  </span>
                </div>

                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-100 text-gray-600 border-b">
                    <tr>
                      <th className="p-1.5">Record Type</th>
                      <th className="p-1.5 text-right">Active Business</th>
                      <th className="p-1.5 text-right">In Archive</th>
                      <th className="p-1.5 text-right">Net Difference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-[11px]">
                    {Object.entries(restoreInspection.differences).map(([k, d]: [string, RestoreDifference]) => (
                      <tr key={k}>
                        <td className="p-1.5 font-medium capitalize">{k}</td>
                        <td className="p-1.5 text-right">{d.active}</td>
                        <td className="p-1.5 text-right">{d.archive}</td>
                        <td className={`p-1.5 text-right font-bold ${d.delta > 0 ? "text-green-700" : d.delta < 0 ? "text-red-700" : "text-gray-500"}`}>
                          {d.delta > 0 ? `+${d.delta}` : d.delta}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900 space-y-1">
                  <p className="font-bold">⚠️ Promotion & Epoch Fencing Policy:</p>
                  <p>
                    Promoting this backup advances the active dataset epoch from {restoreInspection.activeBusiness.currentEpoch} to {restoreInspection.activeBusiness.currentEpoch + 1}. All existing cashier sessions and enrolled devices will be revoked immediately. Older devices attempting to sync will be fenced out to prevent duplicate billing replay.
                  </p>
                </div>

                {isOwner && (
                  <Button
                    type="button"
                    disabled={restorePromoting}
                    onClick={() => void handlePromoteRestore()}
                    className="btn-primary text-xs bg-red-600 hover:bg-red-700 text-white font-bold"
                  >
                    {restorePromoting ? "Promoting..." : "Confirm & Restore (Advance Epoch)"}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* CSV Import & Export */}
        <div className="p-4 bg-gray-50 rounded-lg border space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <div>
              <h3 className="text-sm font-bold text-gray-800">2. CSV Data Portability</h3>
              <p className="text-xs text-gray-600">
                Formula-safe CSV import and export for catalogue items and parties.
              </p>
            </div>
            <div className="flex gap-2">
              <a
                href="/v1/export/items.csv"
                download="items-export.csv"
                className="btn-secondary text-xs py-1 px-2.5"
              >
                Export Items CSV
              </a>
              <a
                href="/v1/export/parties.csv"
                download="parties-export.csv"
                className="btn-secondary text-xs py-1 px-2.5"
              >
                Export Parties CSV
              </a>
            </div>
          </div>

          <div className="flex border-b border-gray-300">
            <button
              type="button"
              className={`py-1.5 px-3 text-xs font-semibold border-b-2 ${
                csvTab === "items" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500"
              }`}
              onClick={() => { setCsvTab("items"); setCsvDryRun(null); setCsvError(null); }}
            >
              Import Items (Goods)
            </button>
            <button
              type="button"
              className={`py-1.5 px-3 text-xs font-semibold border-b-2 ${
                csvTab === "parties" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500"
              }`}
              onClick={() => { setCsvTab("parties"); setCsvDryRun(null); setCsvError(null); }}
            >
              Import Customers / Suppliers
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs text-gray-600">
              <label htmlFor="csv-content-input" className="font-semibold">
                Paste CSV or type content (Required headers: {csvTab === "items" ? "Name,Price,SKU,Barcode" : "Name,Phone,Email,Type"})
              </label>
              <button
                type="button"
                className="text-blue-600 underline text-[11px]"
                onClick={() =>
                  setCsvText(
                    csvTab === "items"
                      ? "Name,Price,SKU,Barcode\nBasmati Rice 25kg,3800.00,RICE-25K,8901234\nCooking Oil 5L,2400.00,OIL-5L,8905678"
                      : "Name,Phone,Email,Type\nAl-Madina Traders,+92 300 1122334,contact@almadina.pk,Customer\nSuper Flour Mills,+92 321 4455667,info@superflour.pk,Supplier",
                  )
                }
              >
                Load Sample CSV
              </button>
            </div>
            <textarea
              id="csv-content-input"
              rows={4}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder="Name,Price,..."
              className="w-full px-2.5 py-1.5 text-xs font-mono border rounded bg-white"
            />
          </div>

          {csvError && (
            <p className="text-xs p-2 bg-red-50 border border-red-200 text-red-700 rounded">
              {csvError}
            </p>
          )}
          {csvSuccess && (
            <p className="text-xs p-2 bg-green-50 border border-green-200 text-green-800 rounded">
              {csvSuccess}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              disabled={csvLoading || !csvText.trim()}
              onClick={() => void handleCsvDryRun()}
              className="btn-secondary text-xs"
            >
              {csvLoading ? "Validating..." : "Dry Run Validate"}
            </Button>
            {csvDryRun && csvDryRun.validRows > 0 && (
              <Button
                type="button"
                disabled={csvLoading}
                onClick={() => void handleCsvCommit()}
                className="btn-primary text-xs"
              >
                Commit {csvDryRun.validRows} Records
              </Button>
            )}
          </div>

          {csvDryRun && (
            <div className="p-3 bg-white rounded border text-xs space-y-2">
              <div className="flex gap-4 font-semibold">
                <span className="text-gray-700">Total: {csvDryRun.totalRows}</span>
                <span className="text-green-700">Valid: {csvDryRun.validRows}</span>
                <span className="text-red-700">Errors: {csvDryRun.invalidRows}</span>
              </div>
              {csvDryRun.errors.length > 0 && (
                <div className="p-2 bg-red-50 border border-red-200 rounded space-y-1 text-red-800 text-[11px]">
                  <p className="font-bold">Validation Errors:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {csvDryRun.errors.map((err: CsvValidationError, idx: number) => (
                      <li key={idx}>
                        Row {err.row} ({err.field}): {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Change Password */}
      <form onSubmit={handleChangePassword} className="bg-white p-6 rounded-lg border shadow-sm space-y-4">
        <h2 className="text-base font-bold text-gray-900">Change Password</h2>
        {pwStatus?.success && (
          <p className="text-xs text-green-700 bg-green-50 p-2 rounded border border-green-200">
            Password updated successfully.
          </p>
        )}
        {pwStatus?.error && (
          <p className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
            {pwStatus.error}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="curr-password"
              className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1"
            >
              Current Password *
            </label>
            <input
              id="curr-password"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="new-pw"
              className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1"
            >
              New Password * (min 8 chars)
            </label>
            <input
              id="new-pw"
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm outline-none"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="revoke-others"
            type="checkbox"
            checked={revokeOthers}
            onChange={(e) => setRevokeOthers(e.target.checked)}
            className="rounded text-blue-600"
          />
          <label htmlFor="revoke-others" className="text-xs text-gray-600">
            Revoke all other active sessions upon password change
          </label>
        </div>
        <Button type="submit" disabled={pwSubmitting} className="text-sm">
          {pwSubmitting ? "Updating Password..." : "Update Password"}
        </Button>
      </form>

      {/* Active Sessions */}
      <div className="bg-white p-6 rounded-lg border shadow-sm space-y-4">
        <h2 className="text-base font-bold text-gray-900">Active Sessions</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 border-b text-gray-600">
              <tr>
                <th className="p-2">IP / User Agent</th>
                <th className="p-2">Created</th>
                <th className="p-2">Expires</th>
                <th className="p-2">Status</th>
                <th className="p-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sessions.map((sess) => (
                <tr key={sess.id} className="hover:bg-gray-50">
                  <td className="p-2">
                    <p className="font-mono text-gray-800">{sess.ipAddress || "Localhost"}</p>
                    <p className="text-[11px] text-gray-400 truncate max-w-xs">{sess.userAgent}</p>
                  </td>
                  <td className="p-2 text-gray-500">
                    {new Date(sess.createdAt).toLocaleString()}
                  </td>
                  <td className="p-2 text-gray-500">
                    {new Date(sess.expiresAt).toLocaleString()}
                  </td>
                  <td className="p-2">
                    {sess.isCurrent ? (
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-green-100 text-green-800">
                        Current Session
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-700">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="p-2">
                    {!sess.isCurrent && (
                      <Button
                        onClick={() => void handleRevokeSession(sess.id)}
                        className="btn-ghost text-red-600 text-[11px] py-1 px-2"
                      >
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {previewModalOpen && (
        <PrintDocumentModal
          data={{
            documentType: "Sale",
            id: "preview-inv-001",
            number: "INV-2026-00042",
            businessName: auth.activeMembership?.businessName ?? "Apex General Traders",
            businessDate: new Date().toISOString(),
            status: "Posted",
            isReprint: false,
            customerOrSupplier: {
              name: "Al-Rehman General Store (Haji Usman)",
              phone: "+92 300 9876543",
              address: "Shop #14, Grain Market, Railway Road",
              taxId: "NTN: 9876543-2",
            },
            lines: [
              {
                name: "Basmati Super Kernel Aged Rice (50kg Bag) Grade-A Polished Grain",
                unitName: "Bag",
                quantity: "5",
                unitPrice: "8500.00",
                discount: "500.00",
                taxPercent: "0",
                total: "42000.00",
              },
              {
                name: "Refined White Granulated Sugar (50kg Sack)",
                unitName: "Sack",
                quantity: "3",
                unitPrice: "7200.00",
                taxPercent: "0",
                total: "21600.00",
              },
              {
                name: "Pure Mustard Cold-Pressed Cooking Oil (16 Litre Premium Tin)",
                unitName: "Tin",
                quantity: "2",
                unitPrice: "9800.00",
                taxPercent: "0",
                total: "19600.00",
              },
              {
                name: "Supreme Black Dust Leaf Tea (1kg Moisture-Proof Pouch)",
                unitName: "Pouch",
                quantity: "10",
                unitPrice: "1450.00",
                discount: "500.00",
                taxPercent: "0",
                total: "14000.00",
              },
            ],
            calculation: {
              base: "98200.00",
              tax: "0.00",
              documentDiscount: "1000.00",
              total: "96200.00",
            },
            payment: {
              total: "96200.00",
              paid: "70000.00",
              due: "26200.00",
              cashApplied: "50000.00",
              bankApplied: "20000.00",
              cashTendered: "50000.00",
              change: "0.00",
              bankReference: "MCB-TRX-882201",
              payments: [
                { id: "p1", kind: "Cash", applied: "50000.00", reference: null },
                { id: "p2", kind: "Bank", applied: "20000.00", reference: "MCB-TRX-882201" },
              ],
            },
          }}
          onClose={() => setPreviewModalOpen(false)}
        />
      )}
    </div>
  );
}
