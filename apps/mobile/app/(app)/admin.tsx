import { useEffect, useState } from "react";
import { View } from "react-native";
import useSWR, { mutate } from "swr";
import { ApiError, dateShort, type AdminAuditEntry, type AdminStats, type AdminUserRow, type Me } from "@bandha/api-client";
import { client } from "../../src/api";
import { useRefresh } from "../../src/data";
import { useT } from "../../src/i18n";
import { goBack } from "../../src/nav";
import { useTheme } from "../../src/theme";
import { Banner, Btn, Card, Empty, Field, Pill, Screen, Segmented, Skeleton, T } from "../../src/ui";

type Tab = "stats" | "users" | "audit";
type Filter = "all" | "active" | "disabled" | "unverified";
const PAGE = 25;
const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
/** "18 Nov, 06:00" in Asia/Jakarta (no Intl: it must read the same on every phone). */
const stamp = (iso: string) => {
  const j = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  return `${dateShort(iso)}, ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
};
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export default function AdminScreen() {
  const t = useT();
  const { refreshing, refresh } = useRefresh();
  const me = useSWR<Me>("/me");
  const [tab, setTab] = useState<Tab>("stats");

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <View style={{ flexDirection: "row" }}><Btn label={t("Kembali", "Back")} icon="arrowLeft" kind="ghost" small onPress={goBack} /></View>
      <T v="title" accessibilityRole="header">{t("Panel admin", "Admin panel")}</T>
      {!me.data ? <Card><Skeleton h={120} /></Card> : me.data.role !== "admin" ? (
        <Card><Empty title={t("Halaman ini hanya untuk admin.", "This page is for admins only.")} /></Card>
      ) : (
        <>
          <Segmented<Tab> value={tab} onChange={setTab} options={[
            { key: "stats", label: t("Statistik", "Statistics") }, { key: "users", label: t("Pengguna", "Users") }, { key: "audit", label: t("Log audit", "Audit log") },
          ]} />
          {tab === "stats" ? <Stats /> : tab === "users" ? <Users /> : <Audit />}
        </>
      )}
    </Screen>
  );
}

function Stats() {
  const c = useTheme();
  const t = useT();
  const { data: s, error } = useSWR<AdminStats>("/admin/stats", { refreshInterval: 60_000 });
  if (error) return <Card><Empty title={t("Gagal memuat data admin.", "Could not load the admin data.")} /></Card>;
  if (!s) return <Card><Skeleton h={220} /></Card>;

  const cards: Array<[string, number, boolean?]> = [
    [t("Total pengguna", "Total users"), s.users.total],
    [t("Email terverifikasi", "Email verified"), s.users.verified],
    [t("Belum verifikasi", "Not verified yet"), s.users.unverified],
    [t("Dinonaktifkan", "Disabled"), s.users.disabled, s.users.disabled > 0],
    [t("Admin", "Admins"), s.users.admins],
    [t("Daftar 7 hari terakhir", "Signed up, last 7 days"), s.newUsers.last7d],
    [t("Daftar 30 hari terakhir", "Signed up, last 30 days"), s.newUsers.last30d],
    [t("Aktif 24 jam terakhir", "Active, last 24 hours"), s.active.last24h],
    [t("Aktif 7 hari terakhir", "Active, last 7 days"), s.active.last7d],
    [t("Aktif 30 hari terakhir", "Active, last 30 days"), s.active.last30d],
    [t("Rekening (semua pengguna)", "Accounts (all users)"), s.data.accounts],
    [t("Transaksi (semua pengguna)", "Transactions (all users)"), s.data.transactions],
    [t("Harga aset tersimpan", "Asset prices stored"), s.market.quotes],
  ];
  const max = Math.max(1, ...s.signups.map((d) => d.count));
  return (
    <>
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 14 }}>
          {cards.map(([label, value, bad], i) => (
            <View key={label} style={{ width: "50%", paddingRight: i % 2 === 0 ? 8 : 0, paddingLeft: i % 2 === 1 ? 8 : 0 }}>
              <T v="small" muted>{label}</T>
              <T v="mono" color={bad ? c.neg : undefined}>{num(value)}</T>
            </View>
          ))}
        </View>
        <T v="small" muted style={{ marginTop: 14 }}>
          {t("Harga terakhir diperbarui", "Prices last updated")}: {s.market.lastQuoteAt ? stamp(s.market.lastQuoteAt) : "—"}
        </T>
      </Card>
      <Card>
        <T v="heading">{t("Pendaftar per hari, 30 hari terakhir", "Sign-ups per day, last 30 days")}</T>
        <View accessibilityRole="image" accessibilityLabel={t("Grafik pendaftar per hari", "Sign-ups per day chart")} style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height: 110, marginTop: 12 }}>
          {s.signups.map((d) => (
            <View key={d.day} style={{ flex: 1, height: `${Math.max(2, (d.count / max) * 100)}%`, minHeight: 2, backgroundColor: d.count === 0 ? c.line : c.gold, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
          ))}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
          <T v="small" muted>{s.signups[0]?.day}</T>
          <T v="small" muted>max {max}</T>
          <T v="small" muted>{s.signups[s.signups.length - 1]?.day}</T>
        </View>
      </Card>
      <T v="small" muted>{t("“Aktif” berarti masuk atau menyegarkan sesi dalam rentang itu. Admin hanya melihat angka, tidak pernah isi keuangan pengguna.", "“Active” means signed in or refreshed a session in that period. Admins only see counts, never anyone's finances.")}</T>
    </>
  );
}

function Users() {
  const c = useTheme();
  const t = useT();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  // The search runs a moment after typing stops.
  useEffect(() => { const id = setTimeout(() => { setQ(typed.trim()); setLimit(PAGE); }, 300); return () => clearTimeout(id); }, [typed]);
  const { data, error } = useSWR<{ users: AdminUserRow[]; total: number }>(
    `/admin/users?limit=${limit}&status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}`, { keepPreviousData: true },
  );
  // One inline confirmation at a time; its answer or error stays on the row it belongs to.
  const [confirm, setConfirm] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<{ id: string; text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(id: string, action: () => Promise<string | void>) {
    setBusy(true); setNote(null);
    try {
      const text = await action();
      setConfirm(null); setReason("");
      if (text) setNote({ id, text });
      await mutate((k) => typeof k === "string" && k.startsWith("/admin/"));
    } catch (e) {
      setNote({ id, text: errText(e, t("Terjadi kesalahan", "Something went wrong")), bad: true });
    } finally { setBusy(false); }
  }

  const filters: Array<[Filter, string]> = [["all", t("Semua", "All")], ["active", t("Aktif", "Active")], ["disabled", t("Nonaktif", "Disabled")], ["unverified", t("Belum verifikasi", "Not verified")]];

  return (
    <>
      <Field label={t("Cari nama atau email", "Search name or email")} value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} maxLength={100} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {filters.map(([k, label]) => <Pill key={k} label={label} on={status === k} onPress={() => { setStatus(k); setLimit(PAGE); }} />)}
      </View>
      {data ? <T v="small" muted>{t(`${num(data.total)} pengguna`, `${num(data.total)} users`)}</T> : null}
      <Card>
        {error ? <Empty title={t("Gagal memuat data admin.", "Could not load the admin data.")} /> : !data ? <Skeleton h={220} /> : data.users.length === 0 ? (
          <Empty title={t("Tidak ada pengguna yang cocok.", "No matching users.")} />
        ) : (
          <>
            {data.users.map((u, i) => {
              const disabled = u.disabledAt !== null;
              const badge = (label: string, bad?: boolean) => (
                <View key={label} style={{ backgroundColor: bad ? "rgba(168,71,45,0.14)" : c.mori, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 }}>
                  <T v="small" color={bad ? c.neg : undefined} style={{ fontSize: 11.5 }}>{label}</T>
                </View>
              );
              return (
                <View key={u.id} style={{ gap: 3, paddingVertical: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.line }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <T>{u.name}</T>
                    {u.role === "admin" ? badge("Admin") : null}
                    {disabled ? badge(t("Nonaktif", "Disabled"), true) : null}
                    {!u.verified ? badge(t("Belum verifikasi", "Not verified")) : null}
                  </View>
                  <T v="small">{u.email}</T>
                  <T v="small" muted>
                    {t(`Daftar ${dateShort(u.createdAt)}`, `Joined ${dateShort(u.createdAt)}`)} · {u.lastActiveAt ? t(`Aktif terakhir ${dateShort(u.lastActiveAt)}`, `Last active ${dateShort(u.lastActiveAt)}`) : t("Belum pernah masuk", "Never signed in")}
                  </T>
                  <T v="small" muted>{t(`${u.accounts} rekening · ${u.transactions} transaksi`, `${u.accounts} accounts · ${u.transactions} transactions`)}</T>
                  {note?.id === u.id ? <View style={{ marginTop: 6 }}>{note.bad ? <Banner tone="err">{note.text}</Banner> : <T v="small" color={c.pos}>{note.text}</T>}</View> : null}
                  {confirm === u.id ? (
                    <View style={{ gap: 8, marginTop: 8 }}>
                      <T v="small">{t("Nonaktifkan akun ini? Semua perangkatnya langsung keluar dan tidak bisa masuk lagi sampai diaktifkan.", "Disable this account? All its devices are signed out at once and cannot sign in until it is enabled again.")}</T>
                      <Field label={t("Alasan (opsional, tercatat di log audit)", "Reason (optional, written to the audit log)")} value={reason} onChangeText={setReason} maxLength={200} />
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Btn label={t("Ya, nonaktifkan", "Yes, disable")} kind="danger" small busy={busy} onPress={() => run(u.id, () => client.adminDisable(u.id, reason.trim() || undefined))} />
                        <Btn label={t("Batal", "Cancel")} kind="ghost" small onPress={() => { setConfirm(null); setReason(""); }} />
                      </View>
                    </View>
                  ) : (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
                      {disabled ? (
                        <Btn label={t("Aktifkan kembali", "Enable again")} kind="ghost" small busy={busy} onPress={() => run(u.id, () => client.adminEnable(u.id))} />
                      ) : u.role === "admin" ? (
                        <T v="small" muted>{t("Akun admin tidak bisa dinonaktifkan dari panel ini.", "Admin accounts cannot be disabled from this panel.")}</T>
                      ) : (
                        <Btn label={t("Nonaktifkan", "Disable")} kind="ghost" small onPress={() => { setConfirm(u.id); setNote(null); }} />
                      )}
                      {u.role !== "admin" ? (
                        <Btn label={t("Keluarkan dari semua perangkat", "Sign out of all devices")} kind="ghost" small busy={busy}
                          onPress={() => run(u.id, async () => { const r = await client.adminRevokeSessions(u.id); return t(`${r.revoked} sesi dikeluarkan.`, `${r.revoked} sessions signed out.`); })} />
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })}
            {data.users.length < data.total ? <View style={{ marginTop: 12 }}><Btn label={t("Muat lebih banyak", "Load more")} kind="ghost" onPress={() => setLimit((l) => l + PAGE)} /></View> : null}
          </>
        )}
      </Card>
    </>
  );
}

const KNOWN = ["user.disable", "user.enable", "user.revoke_sessions", "role.grant", "role.revoke"];

function Audit() {
  const c = useTheme();
  const t = useT();
  const [limit, setLimit] = useState(30);
  const { data, error } = useSWR<{ entries: AdminAuditEntry[]; total: number }>(`/admin/audit?limit=${limit}`);
  const action = (a: string) => ({
    "user.disable": t("Menonaktifkan", "Disabled"), "user.enable": t("Mengaktifkan kembali", "Enabled again"),
    "user.revoke_sessions": t("Mengeluarkan dari semua perangkat", "Signed out of all devices"),
    "role.grant": t("Menjadikan admin", "Made admin"), "role.revoke": t("Mencabut peran admin", "Removed admin role"),
  } as Record<string, string>)[a] ?? a;
  return (
    <Card>
      <T v="small" muted>{t("Setiap kali admin menonaktifkan, mengaktifkan, atau mengeluarkan pengguna, tercatat di sini.", "Every time an admin disables, enables or signs out a user, it is recorded here.")}</T>
      {error ? <Empty title={t("Gagal memuat data admin.", "Could not load the admin data.")} /> : !data ? <Skeleton h={200} /> : data.entries.length === 0 ? (
        <Empty title={t("Belum ada catatan.", "Nothing recorded yet.")} />
      ) : (
        <>
          {data.entries.map((e, i) => (
            <View key={e.id} style={{ gap: 2, paddingVertical: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.line }}>
              <T>{KNOWN.includes(e.action) ? action(e.action) : e.action}</T>
              {e.target ? <T v="small">{e.target}</T> : null}
              <T v="small" muted>{stamp(e.at)} · {e.actor === "cli" ? t("perintah server", "server command") : e.actor}</T>
              {e.detail ? <T v="small">{e.detail}</T> : null}
            </View>
          ))}
          {data.entries.length < data.total ? <View style={{ marginTop: 12 }}><Btn label={t("Muat lebih banyak", "Load more")} kind="ghost" onPress={() => setLimit((l) => l + 30)} /></View> : null}
        </>
      )}
    </Card>
  );
}
