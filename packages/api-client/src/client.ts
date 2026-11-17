import type {
  Account, AccountLedger, Asset, CashflowDetail, CoinChoice, CreateDebtBody, DebtDetail, DebtList, EditableTx, ImportCommitBody, ImportPreview, ImportPreviewBody, Onboarding, SettleDebtBody, Holdings, CashflowMonth, CreateAccountBody, CreateTransactionBody, Dashboard, HistoryPoint, Me, Portfolio, PublicUser, Tx,
} from "./types";

export interface Tokens { accessToken: string; refreshToken: string; expiresIn: number }

/** Where the session lives. Mobile uses the OS keychain/keystore; tests use memory. */
export interface TokenStorage {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens | null): Promise<void>;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly issues?: Array<{ path: string; message: string }>) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ClientOptions {
  baseUrl: string;
  storage: TokenStorage;
  fetch?: typeof fetch;
  /** Called when the server rejects the refresh token, i.e. the user must log in again. */
  onSignedOut?: () => void;
  timeoutMs?: number;
}

interface Session { accessToken: string; refreshToken: string; expiresAt: number }

const SKEW_MS = 30_000;

export function createClient(opts: ClientOptions) {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, "");
  let session: Session | null | undefined; // undefined = not loaded from storage yet
  let refreshing: Promise<boolean> | null = null;

  const toSession = (t: Tokens): Session => ({ accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Date.now() + t.expiresIn * 1000 });

  async function load(): Promise<Session | null> {
    if (session === undefined) {
      const t = await opts.storage.load();
      session = t ? toSession(t) : null;
    }
    return session;
  }

  async function setTokens(t: Tokens | null) {
    session = t ? toSession(t) : null;
    await opts.storage.save(t);
  }

  async function send(path: string, init: { method: string; body?: unknown; token?: string | null }): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
    try {
      return await doFetch(`${base}/api${path}`, {
        method: init.method,
        headers: {
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: ctrl.signal,
      });
    } catch {
      throw new ApiError(0, "Tidak dapat terhubung ke server. Periksa koneksi Anda.");
    } finally {
      clearTimeout(timer);
    }
  }

  async function parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: Array<{ path: string; message: string }> };
    if (!res.ok) throw new ApiError(res.status, data.error ?? "Terjadi kesalahan", data.issues);
    return data as T;
  }

  /**
   * Refresh-token rotation. Concurrent callers share ONE refresh: presenting an already-rotated token
   * would look like theft to the server and revoke the whole session family.
   * Returns false if the session ended; a network failure keeps the session (user may just be offline).
   */
  function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      const s = await load();
      if (!s) return false;
      let res: Response;
      try {
        res = await send("/auth/refresh", { method: "POST", body: { refreshToken: s.refreshToken } });
      } catch {
        return false;
      }
      if (res.ok) {
        const json = (await res.json()) as { tokens: Tokens };
        await setTokens(json.tokens);
        return true;
      }
      if (res.status === 401 || res.status === 400) {
        await setTokens(null);
        opts.onSignedOut?.();
      }
      return false;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const method = init.method ?? "GET";
    let s = await load();
    if (!s) throw new ApiError(401, "Tidak terautentikasi");

    if (s.expiresAt - Date.now() < SKEW_MS) {
      await refresh();
      s = await load();
      if (!s) throw new ApiError(401, "Tidak terautentikasi");
    }

    let res = await send(path, { method, body: init.body, token: s.accessToken });
    if (res.status === 401) {
      if (await refresh()) {
        s = await load();
        res = await send(path, { method, body: init.body, token: s?.accessToken });
      }
    }
    return parse<T>(res);
  }

  async function authenticate(path: string, body: unknown): Promise<PublicUser> {
    const res = await send(path, { method: "POST", body });
    const data = await parse<{ user: PublicUser; tokens: Tokens }>(res);
    await setTokens(data.tokens);
    return data.user;
  }

  return {
    hasSession: async () => (await load()) !== null,
    register: (input: { name: string; email: string; password: string }) => authenticate("/auth/register", input),
    login: (input: { email: string; password: string }) => authenticate("/auth/login", input),
    /** Always resolves the same way, whether or not the email has an account. */
    forgotPassword: async (email: string): Promise<void> => { await parse<{ ok: boolean }>(await send("/auth/forgot", { method: "POST", body: { email } })); },
    resetPassword: async (token: string, password: string): Promise<void> => { await parse<{ ok: boolean }>(await send("/auth/reset", { method: "POST", body: { token, password } })); },
    async logout() {
      const s = await load();
      if (s) await send("/auth/logout", { method: "POST", body: { refreshToken: s.refreshToken } }).catch(() => undefined);
      await setTokens(null);
    },
    request,
    me: () => request<Me>("/me"),
    updateName: (name: string) => request<{ user: PublicUser }>("/me", { method: "PATCH", body: { name } }).then((r) => r.user),
    /** A wrong current password is a 400. On success the server revokes every session, so sign in again afterwards. */
    changePassword: (currentPassword: string, newPassword: string) => request<void>("/me/password", { method: "POST", body: { currentPassword, newPassword } }),
    assets: () => request<{ assets: Asset[] }>("/assets").then((r) => r.assets),
    dashboard: () => request<Dashboard>("/dashboard"),
    cashflow: (months = 6) => request<{ months: CashflowMonth[] }>(`/dashboard/cashflow?months=${months}`).then((r) => r.months),
    history: (days = 180) => request<{ points: HistoryPoint[] }>(`/dashboard/history?days=${days}`).then((r) => r.points),
    assetsByKind: (kind?: "fiat" | "crypto" | "gold", q = "") =>
      request<{ assets: Asset[] }>(`/assets?${new URLSearchParams({ ...(kind ? { kind } : {}), ...(q ? { q } : {}) }).toString()}`).then((r) => r.assets),
    searchCrypto: (q: string) => request<{ coins: CoinChoice[]; remote: boolean }>(`/assets/crypto/search?q=${encodeURIComponent(q)}`),
    addCrypto: (coingeckoId: string) => request<{ asset: Asset }>("/assets/crypto", { method: "POST", body: { coingeckoId } }).then((r) => r.asset),
    cashflowDetail: (kind: "income" | "expense", month?: string) => request<CashflowDetail>(`/dashboard/cashflow/${kind}${month ? `?month=${month}` : ""}`),
    updateAccount: (id: string, body: { name?: string; kind?: string; brandKey?: string | null; includeInNetWorth?: boolean }) =>
      request<{ account: { id: string } }>(`/accounts/${id}`, { method: "PATCH", body }),
    holdings: () => request<Holdings>("/holdings"),
    accountLedger: (id: string, opts: { assetId?: string; limit?: number; offset?: number } = {}) => {
      const q = new URLSearchParams();
      if (opts.assetId) q.set("assetId", opts.assetId);
      if (opts.limit) q.set("limit", String(opts.limit));
      if (opts.offset) q.set("offset", String(opts.offset));
      const qs = q.toString();
      return request<AccountLedger>(`/accounts/${id}/ledger${qs ? `?${qs}` : ""}`);
    },
    portfolio: () => request<Portfolio>("/portfolio"),
    accounts: () => request<{ accounts: Account[] }>("/accounts").then((r) => r.accounts),
    createAccount: (body: CreateAccountBody) => request<{ account: { id: string } }>("/accounts", { method: "POST", body }),
    archiveAccount: (id: string) => request<void>(`/accounts/${id}/archive`, { method: "POST", body: {} }),
    transactions: (limit = 50) => request<{ transactions: Tx[] }>(`/transactions?limit=${limit}`).then((r) => r.transactions),
    createTransaction: (body: CreateTransactionBody) => request<{ transaction: { id: string }; replayed: boolean }>("/transactions", { method: "POST", body }),
    transaction: (id: string) => request<{ transaction: EditableTx }>(`/transactions/${id}`).then((r) => r.transaction),
    replaceTransaction: (id: string, body: Record<string, unknown>) => request<void>(`/transactions/${id}`, { method: "PUT", body }),
    onboarding: () => request<Onboarding>("/onboarding"),
    dismissOnboarding: () => request<void>("/onboarding/dismiss", { method: "POST", body: {} }),
    previewImport: (body: ImportPreviewBody) => request<ImportPreview>("/imports/preview", { method: "POST", body }),
    commitImport: (body: ImportCommitBody) => request<{ batchKey: string; imported: number; replayed: boolean }>("/imports", { method: "POST", body }),
    undoImport: (batchKey: string) => request<{ voided: number }>(`/imports/${batchKey}/undo`, { method: "POST", body: {} }),
    voidTransaction: (id: string) => request<void>(`/transactions/${id}/void`, { method: "POST", body: {} }),
    debts: () => request<DebtList>("/debts"),
    debt: (id: string) => request<DebtDetail>(`/debts/${id}`),
    createDebt: (body: CreateDebtBody) => request<{ debt: { id: string }; replayed: boolean }>("/debts", { method: "POST", body }),
    settleDebt: (id: string, body: SettleDebtBody) => request<{ transaction: { id: string }; replayed: boolean }>(`/debts/${id}/payments`, { method: "POST", body }),
    updateDebt: (id: string, body: { counterparty?: string; kind?: string; note?: string | null; dueDate?: string | null }) =>
      request<void>(`/debts/${id}`, { method: "PATCH", body }),
    voidDebt: (id: string) => request<void>(`/debts/${id}/void`, { method: "POST", body: {} }),
  };
}

export type BandhaClient = ReturnType<typeof createClient>;
