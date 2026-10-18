import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@business/ui";
import { useAuth } from "../context/AuthContext";
import {
  type DeviceEnrollment,
  type LocationSummary,
} from "@business/contracts";
import {
  getLocalDatabase,
  bootstrapLocalIdentity,
  readCachedIdentity,
  isOfflineLeaseValid,
  closeActiveLocalDb,
  installCatalogueSnapshot,
  applyCataloguePull,
  type CataloguePull,
} from "../db/index";

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

  // Local IndexedDB bootstrap status
  const [localCache, setLocalCache] = useState<Awaited<
    ReturnType<typeof readCachedIdentity>
  > | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);

  // Finding 4: Deliberately bind browser to a device instead of blindly picking the first enrolled device
  const [boundDeviceId, setBoundDeviceId] = useState<string | null>(() => {
    if (typeof window !== "undefined" && auth.selectedBusinessId) {
      return localStorage.getItem(`bms_device_binding_${auth.selectedBusinessId}`);
    }
    return null;
  });

  const isOwner = auth.activeMembership?.role === "Owner";

  // Synchronize bound device key when selected business changes
  useEffect(() => {
    if (typeof window !== "undefined" && auth.selectedBusinessId) {
      setBoundDeviceId(localStorage.getItem(`bms_device_binding_${auth.selectedBusinessId}`));
    } else {
      setBoundDeviceId(null);
    }
  }, [auth.selectedBusinessId]);

  function bindDeviceToBrowser(deviceId: string) {
    if (typeof window !== "undefined" && auth.selectedBusinessId) {
      localStorage.setItem(`bms_device_binding_${auth.selectedBusinessId}`, deviceId);
      setBoundDeviceId(deviceId);
    }
  }

  // Clear stale UI state and close local database partition when business/user changes or logs out
  useEffect(() => {
    if (!auth.authenticated || !auth.selectedBusinessId) {
      setDevices([]);
      setLocations([]);
      setSessions([]);
      setLocalCache(null);
      setBootstrapStatus(null);
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

        // If authority rejected, close local partition and clear state
        if (
          locRes.status === 401 ||
          locRes.status === 403 ||
          devRes.status === 401 ||
          devRes.status === 403
        ) {
          closeActiveLocalDb();
          setLocalCache(null);
          setDevices([]);
          setLocations([]);
          if (boundDeviceId && auth.selectedBusinessId) {
            localStorage.removeItem(`bms_verified_bootstrap_${auth.selectedBusinessId}_${boundDeviceId}`);
          }
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
        // network/offline handling
      }
    })();
  }, [auth.authenticated, auth.selectedBusinessId]);

  // Load cached local IndexedDB if verified bootstrap metadata is present for the explicitly bound device
  useEffect(() => {
    if (!auth.authenticated || !auth.user || !auth.selectedBusinessId || !boundDeviceId) {
      return;
    }
    const boundDevice = devices.find((d) => d.id === boundDeviceId && d.status === "Enrolled");
    if (!boundDevice) return;

    // Require verified bootstrap metadata before opening the scoped partition
    // Never guess the dataset epoch or assume authority without verified metadata
    const metaKey = `bms_verified_bootstrap_${auth.selectedBusinessId}_${boundDevice.id}`;
    const storedMetaRaw = localStorage.getItem(metaKey);
    if (!storedMetaRaw) {
      return;
    }

    let storedMeta: { userId?: string; businessId?: string; enrollmentId?: string; datasetEpoch?: number };
    try {
      storedMeta = JSON.parse(storedMetaRaw);
    } catch {
      return;
    }

    if (
      storedMeta.userId !== auth.user.id ||
      storedMeta.businessId !== auth.selectedBusinessId ||
      storedMeta.enrollmentId !== boundDevice.id ||
      typeof storedMeta.datasetEpoch !== "number"
    ) {
      return;
    }

    const db = getLocalDatabase({
      userId: auth.user.id,
      businessId: auth.selectedBusinessId,
      enrollmentId: boundDevice.id,
      datasetEpoch: storedMeta.datasetEpoch,
    });

    void readCachedIdentity(db).then((data) => {
      if (data.business) setLocalCache(data);
    });
  }, [auth.authenticated, auth.user, auth.selectedBusinessId, boundDeviceId, devices]);

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
        if (!boundDeviceId) {
          bindDeviceToBrowser(data.id);
        }
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
    if (!confirm("Are you sure you want to revoke this device? Offline authority will be cancelled.")) {
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

  async function handleBootstrapLocal(device: DeviceEnrollment) {
    setBootstrapStatus("Downloading permitted identity bootstrap...");
    bindDeviceToBrowser(device.id);
    try {
      const res = await fetch(`/v1/sync/bootstrap?deviceEnrollmentId=${device.id}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        setBootstrapStatus(`Bootstrap failed: ${err.error || "Access denied"}`);
        if (res.status === 401 || res.status === 403) {
          closeActiveLocalDb();
          setLocalCache(null);
          if (auth.selectedBusinessId) {
            localStorage.removeItem(`bms_verified_bootstrap_${auth.selectedBusinessId}_${device.id}`);
          }
        }
        return;
      }

      const bootstrapData = await res.json();

      const db = getLocalDatabase({
        userId: auth.user!.id,
        businessId: auth.selectedBusinessId!,
        enrollmentId: device.id,
        datasetEpoch: bootstrapData.business.datasetEpoch,
      });

      if (bootstrapData.business.id !== auth.selectedBusinessId || bootstrapData.device.id !== device.id ||
        bootstrapData.membership.id !== device.membershipId) throw new Error("Bootstrap identity scope changed");
      await bootstrapLocalIdentity(db, bootstrapData);
      await installCatalogueSnapshot(db, bootstrapData, ["Owner", "Accountant"].includes(bootstrapData.membership.role));
      const cached = await readCachedIdentity(db);
      setLocalCache(cached);

      localStorage.setItem(
        `bms_verified_bootstrap_${auth.selectedBusinessId}_${device.id}`,
        JSON.stringify({
          userId: auth.user!.id,
          businessId: auth.selectedBusinessId!,
          enrollmentId: device.id,
          datasetEpoch: bootstrapData.business.datasetEpoch,
          bootstrappedAt: new Date().toISOString(),
        }),
      );

      setBootstrapStatus("Permitted catalogue cached. Online billing remains required while offline issue is under development.");
    } catch (err: unknown) {
      setBootstrapStatus(`Bootstrap error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  async function handlePullCatalogue() {
    if (!auth.user || !auth.selectedBusinessId || !boundDeviceId || !localCache?.business) return;
    setSyncBusy(true);
    try {
      const db = getLocalDatabase({ userId: auth.user.id, businessId: auth.selectedBusinessId,
        enrollmentId: boundDeviceId, datasetEpoch: localCache.business.datasetEpoch });
      for (let page = 0; page < 100; page++) {
        const saved = await db.syncState.get("catalogueCursor");
        if (typeof saved?.value !== "string") throw new Error("Catalogue needs a fresh bootstrap");
        const query = new URLSearchParams({ deviceEnrollmentId: boundDeviceId, afterCursor: saved.value });
        const response = await fetch(`/v1/sync/pull?${query}`, { credentials: "include" });
        if (!response.ok) throw new Error(`Pull stopped (${response.status}); local cursor and data were kept`);
        const pull = await response.json() as CataloguePull & { hasMore: boolean };
        await applyCataloguePull(db, pull, ["Owner", "Accountant"].includes(localCache.membership?.role ?? ""));
        if (!pull.hasMore) {
          setBootstrapStatus(`Catalogue updated through cursor ${pull.nextCursor}. Online billing remains required.`);
          return;
        }
      }
      setBootstrapStatus("More catalogue changes remain. Pull again to continue.");
    } catch (error) {
      setBootstrapStatus(error instanceof Error ? error.message : "Could not update catalogue");
    } finally { setSyncBusy(false); }
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
          Account, business isolation, device enrollment, and local offline partition.
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

      {/* Device Enrollment & Offline Leases */}
      <div className="bg-white p-6 rounded-lg border shadow-sm space-y-6">
        <div>
          <h2 className="text-base font-bold text-gray-900">Enrolled Devices & Offline Leases</h2>
          <p className="text-xs text-gray-500 mt-1">
            Owner-controlled device enrollment allocates a never-reused numbering prefix and bounded offline lease.
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
                          {boundDeviceId === dev.id ? (
                            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-blue-100 text-blue-800 border border-blue-200">
                              Bound Browser
                            </span>
                          ) : (
                            <Button
                              onClick={() => bindDeviceToBrowser(dev.id)}
                              className="btn-secondary text-[11px] py-1 px-2"
                            >
                              Bind Browser
                            </Button>
                          )}
                          <Button
                            onClick={() => void handleBootstrapLocal(dev)}
                            className="btn-secondary text-[11px] py-1 px-2"
                          >
                            Bootstrap IndexedDB
                          </Button>
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

        {/* Bootstrap status */}
        {bootstrapStatus && (
          <div className="p-3 bg-blue-50 border border-blue-200 text-xs text-blue-900 rounded">
            {bootstrapStatus}
          </div>
        )}

        {/* Cached Partition Overview */}
        {localCache && (
          <div className="p-3 bg-gray-50 border rounded text-xs space-y-1">
            <Button onClick={() => void handlePullCatalogue()} disabled={syncBusy || !boundDeviceId}
              className="btn-secondary text-xs py-1 px-2">
              {syncBusy ? "Updating catalogue…" : "Update catalogue"}
            </Button>
            <p className="font-semibold text-gray-700">IndexedDB Partition Verified:</p>
            <p>
              <b>Business:</b> {localCache.business?.name} (Epoch {localCache.business?.datasetEpoch})
            </p>
            <p>
              <b>Permitted Locations:</b> {localCache.locations.length}
            </p>
            <p>
              <b>Offline Lease:</b>{" "}
              {localCache.lease ? (
                isOfflineLeaseValid(localCache.lease) ? (
                  <span className="text-green-700 font-medium">Valid (72h lease signed)</span>
                ) : (
                  <span className="text-red-600 font-medium">Expired / Revoked</span>
                )
              ) : (
                "None"
              )}
            </p>
            <p className="text-[11px] text-gray-400">
              Zero passwords, password hashes, or session tokens stored locally.
            </p>
          </div>
        )}
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
