import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { mutate } from "swr";
import type { PublicUser } from "@bandha/api-client";
import { client, setSignedOutHandler } from "./api";
import { googleSignOut } from "./google";

type Status = "loading" | "authed" | "anon";
interface AuthCtx {
  status: Status;
  user: PublicUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** Signs in, or signs up, with the ID token Google gave the app (one call for both). */
  signInWithGoogle: (idToken: string) => Promise<void>;
  /** Resolves with the address that now has to be confirmed with the emailed code, or null when the person was signed in at once. */
  signUp: (name: string, email: string, password: string) => Promise<{ verifyEmail: string | null }>;
  /** Confirms the 6-digit code from the registration email and signs in. */
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Saves the new name and shows it everywhere without a restart. */
  updateName: (name: string) => Promise<void>;
  /**
   * Changes the password. The server then signs every session out, this device included, so it signs in again with the
   * new password; false means that sign-in failed and the user has been sent to the login screen.
   */
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<PublicUser | null>(null);

  const clear = useCallback(() => {
    setUser(null);
    setStatus("anon");
    void mutate(() => true, undefined, { revalidate: false });
  }, []);

  useEffect(() => {
    setSignedOutHandler(clear);
    (async () => {
      if (!(await client.hasSession())) return setStatus("anon");
      try {
        setUser((await client.me()).user);
        setStatus("authed");
      } catch (e) {
        // Offline at launch: keep the stored session and let screens show their own error state.
        if (e instanceof Error && "status" in e && (e as { status: number }).status === 0) setStatus("authed");
        else clear();
      }
    })();
  }, [clear]);

  const value = useMemo<AuthCtx>(
    () => ({
      status,
      user,
      signIn: async (email, password) => { setUser(await client.login({ email, password })); setStatus("authed"); },
      signInWithGoogle: async (idToken) => { setUser((await client.google(idToken)).user); setStatus("authed"); },
      signUp: async (name, email, password) => {
        const r = await client.register({ name, email, password });
        if (r.kind === "verify") return { verifyEmail: r.email };
        setUser(r.user);
        setStatus("authed");
        return { verifyEmail: null };
      },
      verifyEmail: async (email, code) => { setUser(await client.verifyEmail(email, code)); setStatus("authed"); },
      resendCode: (email) => client.resendVerification(email),
      signOut: async () => { await client.logout(); void googleSignOut(); clear(); },
      updateName: async (name) => { setUser(await client.updateName(name)); },
      changePassword: async (currentPassword, newPassword) => {
        await client.changePassword(currentPassword, newPassword);
        const email = user?.email;
        try {
          if (!email) throw new Error("no email");
          setUser(await client.login({ email, password: newPassword }));
          return true;
        } catch {
          await client.logout().catch(() => undefined);
          clear();
          return false;
        }
      },
    }),
    [status, user, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
