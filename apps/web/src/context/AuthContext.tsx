import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type {
  SessionUser,
  MembershipInfo,
  LoginInput,
  RegisterInput,
  ChangePasswordInput,
  SessionState,
} from "@business/contracts";
import { closeActiveLocalDb } from "../db/index";

interface AuthContextType {
  authenticated: boolean;
  user: SessionUser | null;
  csrfToken: string | null;
  selectedBusinessId: string | null;
  activeMembership: MembershipInfo | null;
  memberships: MembershipInfo[];
  loading: boolean;
  login: (input: LoginInput) => Promise<{ success: boolean; error?: string }>;
  register: (input: RegisterInput) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  selectBusiness: (businessId: string) => Promise<{ success: boolean; error?: string }>;
  changePassword: (input: ChangePasswordInput) => Promise<{ success: boolean; error?: string }>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({
    authenticated: false,
    user: null,
    csrfToken: null,
    selectedBusinessId: null,
    activeMembership: null,
    memberships: [],
  });
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/v1/auth/me", {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = (await res.json()) as SessionState;
        setSession(data);
      } else {
        setSession({
          authenticated: false,
          user: null,
          csrfToken: null,
          selectedBusinessId: null,
          activeMembership: null,
          memberships: [],
        });
      }
    } catch {
      // API unavailable or network down
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined" && document.cookie.includes("bms_csrf=")) {
      void refreshSession();
    } else {
      setLoading(false);
    }
  }, [refreshSession]);

  const login = useCallback(
    async (input: LoginInput) => {
      try {
        const res = await fetch("/v1/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const data = await res.json();
        if (!res.ok) {
          return { success: false, error: data.error || "Login failed" };
        }
        await refreshSession();
        return { success: true };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [refreshSession],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      try {
        const res = await fetch("/v1/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const data = await res.json();
        if (!res.ok) {
          return { success: false, error: data.error || "Registration failed" };
        }
        await refreshSession();
        return { success: true };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [refreshSession],
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/v1/auth/logout", {
        method: "POST",
        headers: {
          "x-csrf-token": session.csrfToken || "",
        },
      });
    } finally {
      closeActiveLocalDb();
      if (typeof document !== "undefined") {
        document.cookie = "bms_csrf=; path=/; max-age=0;";
      }
      setSession({
        authenticated: false,
        user: null,
        csrfToken: null,
        selectedBusinessId: null,
        activeMembership: null,
        memberships: [],
      });
    }
  }, [session.csrfToken]);

  const selectBusiness = useCallback(
    async (businessId: string) => {
      try {
        const res = await fetch("/v1/auth/select-business", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": session.csrfToken || "",
          },
          body: JSON.stringify({ businessId }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { success: false, error: data.error || "Business selection failed" };
        }
        // Business switched - close current partitioned DB connection
        closeActiveLocalDb();
        await refreshSession();
        return { success: true };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [session.csrfToken, refreshSession],
  );

  const changePassword = useCallback(
    async (input: ChangePasswordInput) => {
      try {
        const res = await fetch("/v1/auth/change-password", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": session.csrfToken || "",
          },
          body: JSON.stringify(input),
        });
        const data = await res.json();
        if (!res.ok) {
          return { success: false, error: data.error || "Failed to change password" };
        }
        return { success: true };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [session.csrfToken],
  );

  return (
    <AuthContext.Provider
      value={{
        ...session,
        loading,
        login,
        register,
        logout,
        selectBusiness,
        changePassword,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
