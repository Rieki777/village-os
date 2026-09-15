import React, { createContext, useContext, useEffect, useState } from "react";
import { TOKEN_KEY } from "@/lib/gameApi";
import { forgetExamplesCache } from "@/components/ExamplesBanner";
import { removeStored, storedText, writeStored } from "@/lib/safeStorage";
import { SIGN_IN_STORAGE_BLOCKED, canKeepSignedIn, sessionWriteRefused } from "@/lib/signInStorage";

export interface User {
  id: string;
  name: string;
  email: string;
  /** member (default) | admin | founder — founder is the master-admin tier. */
  role?: "member" | "admin" | "founder";
  /** Public name-tag for @mentions and audit views; emails never leak. */
  handle?: string;
  paths: string[];
  contributions: Array<{
    id: string;
    type: string;
    description: string;
    recognitionEarned: number;
    date: string;
  }>;
  quests: any[];
  recognitionBalance: number;
  joinedAt: string;
  bio: string;
  avatar: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (name: string, email: string, password: string, paths: string[]) => Promise<void>;
  updateProfile: (updates: Partial<Omit<User, "id" | "email" | "joinedAt">>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Synchronous initializer, not an effect: consumers that key off the token
  // (ModuleProvider fetches the module manifest with it) would otherwise see
  // null on first render and fetch an anonymous manifest, flashing NotFound
  // on gated pages before the real one lands.
  // A browser blocking site data used to throw HERE, during the first render
  // of the provider every page mounts under, which is how one blocked setting
  // took the whole app down. A blocked store now reads as no session, which is
  // the truth: nothing was ever stored in it. The member is told why at the
  // moment they try to sign in. See client/src/lib/signInStorage.ts.
  const [token, setToken] = useState<string | null>(() => storedText("local", TOKEN_KEY));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = storedText("local", TOKEN_KEY);
    if (storedToken) {
      validateToken(storedToken);
    } else {
      setLoading(false);
    }
  }, []);

  async function validateToken(tk: string) {
    try {
      const res = await fetch("/api/profile", {
        headers: { Authorization: `Bearer ${tk}` },
      });
      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
      } else if (res.status === 401 || res.status === 403) {
        // ONLY a genuine rejection clears the credential. A 500 or a 502
        // while the container restarts used to delete the member's only
        // stored token and sign them out for a server-side blip.
        // A removal that refuses leaves a dead token on disk, and the next
        // load re-validates it and lands right back here. Signing this tab
        // out is still the right move, so the result is read and not acted on.
        removeStored("local", TOKEN_KEY);
        setToken(null);
        forgetExamplesCache();
      }
    } catch (err) {
      // A dropped connection says nothing about whether the token is valid.
      // Keep it: the next load with signal re-validates and signs them in.
      console.error("Token validation failed:", err);
    } finally {
      setLoading(false);
    }
  }

  async function login(email: string, password: string) {
    // Asked before the password is sent, so a blocked browser costs a member
    // a sentence and never a spent session. Rye's ruling, 2026-09-04: tell
    // them, and tell them how to fix it.
    if (!canKeepSignedIn()) throw new Error(SIGN_IN_STORAGE_BLOCKED);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Login failed");
    }
    const data = await res.json();
    // Checked again, because a store can fill between the question and the
    // answer. Nothing below this line runs on a refusal, so no part of the
    // app is left believing the member is signed in.
    if (sessionWriteRefused(writeStored("local", TOKEN_KEY, data.token))) {
      throw new Error(SIGN_IN_STORAGE_BLOCKED);
    }
    setToken(data.token);
    setUser(data.user);
    // Session-scoped caches that live outside React state have to be dropped
    // here: login is a pure SPA transition with no reload. /api/examples is
    // answered per viewer (preview-lifecycle modules are hidden from
    // non-admins), so an admin who signs in keeps the anonymous answer and
    // loses the banner on every module they are previewing.
    forgetExamplesCache();
  }

  async function register(name: string, email: string, password: string, paths: string[]) {
    // Ahead of the request for a sharper reason than login has: registering
    // behind a blocked store would create an account the member cannot reach,
    // and then refuse them at the door of their own village.
    if (!canKeepSignedIn()) throw new Error(SIGN_IN_STORAGE_BLOCKED);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, paths }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Registration failed");
    }
    const data = await res.json();
    if (sessionWriteRefused(writeStored("local", TOKEN_KEY, data.token))) {
      throw new Error(SIGN_IN_STORAGE_BLOCKED);
    }
    setToken(data.token);
    setUser(data.user);
    forgetExamplesCache();
  }

  async function logout() {
    // Tell the server first: without this the token stays valid for its full
    // 30 days and anyone who copied it stays signed in. tokenVersion is the
    // only revocation lever, so this ends every session on every device.
    const tk = storedText("local", TOKEN_KEY);
    if (tk) {
      try {
        await fetch("/api/auth/logout", {
          // save-ok: sign-out must finish whether or not the server hears. A
          // refusal read here could only be reported by keeping somebody in a
          // session they asked to leave, which is the worse of the two.
          method: "POST",
          headers: { Authorization: `Bearer ${tk}` },
        });
      } catch (err) {
        // Local sign-out still proceeds — an unreachable server must not
        // trap someone in a session they asked to leave.
        console.error("Logout request failed:", err);
      }
    }
    // Signing out never refuses. A store that will not take the removal is
    // no reason to hold somebody in a session they asked to leave.
    removeStored("local", TOKEN_KEY);
    setToken(null);
    setUser(null);
    forgetExamplesCache();
  }

  async function updateProfile(updates: Partial<Omit<User, "id" | "email" | "joinedAt">>) {
    if (!token) throw new Error("Not authenticated");
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Update failed");
    }
    const updated = await res.json();
    setUser(updated);
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, register, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
