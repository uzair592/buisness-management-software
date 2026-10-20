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
    </div>
  );
}
