import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { mutate } from "swr";
import type { PublicUser } from "@bandha/api-client";
import { client, setSignedOutHandler } from "./api";

type Status = "loading" | "authed" | "anon";
interface AuthCtx {
  status: Status;
  user: PublicUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
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
      signUp: async (name, email, password) => { setUser(await client.register({ name, email, password })); setStatus("authed"); },
      signOut: async () => { await client.logout(); clear(); },
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
