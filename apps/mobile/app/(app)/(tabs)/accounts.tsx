import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import useSWR, { mutate } from "swr";
import { ACCOUNT_FILTERS, ApiError, accountKindLabel, balanceText, type Account } from "@bandha/api-client";
import { client } from "../../../src/api";
import { useAuth } from "../../../src/auth";
import { useRefresh } from "../../../src/data";
import { useT } from "../../../src/i18n";
import { AccountLogo } from "../../../src/logos";
import { font, useTheme } from "../../../src/theme";
import { Avatar, Banner, Btn, Card, Empty, Icon, Row, Screen, Skeleton, T } from "../../../src/ui";

export default function Accounts() {
  const c = useTheme();
  const t = useT();
  const { user, signOut } = useAuth();
  const { refreshing, refresh } = useRefresh();
  const { data, error } = useSWR<{ accounts: Account[] }>("/accounts");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");

  const accounts = data?.accounts ?? [];
  // Only types that actually exist get a chip, with how many accounts each has.
  const chips = useMemo(
    () => ACCOUNT_FILTERS.map((f) => ({ ...f, count: accounts.filter((a) => f.kinds.includes(a.kind)).length })).filter((f) => f.count > 0),
    [accounts],
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const kinds = ACCOUNT_FILTERS.find((f) => f.key === filter)?.kinds;
    return accounts.filter((a) => (!kinds || kinds.includes(a.kind)) && (!q || `${a.name} ${accountKindLabel(a.kind)}`.toLowerCase().includes(q)));
  }, [accounts, filter, search]);

  async function archive(id: string) {
    setMsg("");
    try {
      await client.archiveAccount(id);
      setConfirm(null);
      await mutate(() => true);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : t("Terjadi kesalahan", "Something went wrong"));
    }
  }

  const chip = (key: string, label: string, count: number) => {
    const on = filter === key;
    return (
      <Pressable key={key} onPress={() => setFilter(key)} accessibilityRole="button" accessibilityState={{ selected: on }}
        style={{ flexDirection: "row", gap: 6, alignItems: "center", paddingHorizontal: 13, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: on ? c.gold : c.line, backgroundColor: on ? c.goldSoft : c.card }}>
        <Text style={{ color: on ? c.ink : c.muted, fontFamily: font.sansSemi, fontSize: 13 }}>{label}</Text>
        <Text style={{ color: c.muted, fontFamily: font.monoMedium, fontSize: 11 }}>{count}</Text>
      </Pressable>
    );
  };

  return (
    <Screen onRefresh={refresh} refreshing={refreshing} bottomPad={96}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T v="title" accessibilityRole="header">{t("Rekening", "Accounts")}</T>
        <Btn label={t("Tambah", "Add")} icon="plus" small onPress={() => router.push("/add-account")} accessibilityLabel={t("Tambah rekening", "Add account")} />
      </View>
      <T v="small" muted>{t("Bank, dompet digital, bursa kripto, dan lainnya. Saldo dihitung dari catatan transaksi.", "Banks, e-wallets, crypto exchanges and more. Balances are calculated from your transactions.")}</T>
      {msg ? <Banner tone="err">{msg}</Banner> : null}

      {accounts.length > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, backgroundColor: c.card, borderColor: c.line, borderWidth: 1, borderRadius: 12 }}>
          <Icon name="search" size={18} color={c.muted} />
          <TextInput value={search} onChangeText={setSearch} placeholder={t("Cari rekening…", "Search accounts…")} placeholderTextColor={c.muted} autoCapitalize="none" autoCorrect={false} accessibilityLabel={t("Cari rekening", "Search accounts")}
            style={{ flex: 1, paddingVertical: 12, color: c.ink, fontFamily: font.sansMedium, fontSize: 15 }} />
        </View>
      ) : null}
      {chips.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist">
          {chip("all", t("Semua", "All"), accounts.length)}
          {chips.map((f) => chip(f.key, accountKindLabel(f.kinds[0]!), f.count))}
        </ScrollView>
      ) : null}

      <Card>
        {error ? (
          <Empty title={t("Gagal memuat rekening", "Failed to load accounts")} text={error instanceof Error ? error.message : undefined} action={<Btn label={t("Coba lagi", "Try again")} kind="ghost" small onPress={refresh} />} />
        ) : !data ? (
          <Skeleton h={120} />
        ) : accounts.length === 0 ? (
          <Empty title={t("Belum ada rekening", "No accounts yet")} text={t("Mulai dengan menambahkan rekening bank atau dompet Anda.", "Start by adding your bank account or wallet.")} />
        ) : shown.length === 0 ? (
          <Empty title={t("Tidak ada rekening yang cocok", "No matching accounts")} text={t("Ubah filter jenis atau kata pencarian.", "Change the type filter or search text.")} />
        ) : shown.map((a) => (
          <Row key={a.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <AccountLogo account={a} size={40} />
              <Pressable style={{ flex: 1 }} onPress={() => router.push(`/account/${a.id}`)} accessibilityRole="button" accessibilityLabel={t(`Lihat transaksi ${a.name}`, `View transactions of ${a.name}`)}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                  <View style={{ flexShrink: 1 }}><T numberOfLines={1}>{a.name}</T></View>
                  <Icon name="chevronRight" size={16} color={c.muted} />
                </View>
                <T v="small" muted numberOfLines={1}>{accountKindLabel(a.kind)}{a.includeInNetWorth ? "" : t(" · tidak dihitung", " · not counted")}</T>
              </Pressable>
              <Pressable onPress={() => router.push({ pathname: "/add-account", params: { id: a.id } })} accessibilityRole="button" accessibilityLabel={t(`Edit ${a.name}`, `Edit ${a.name}`)} hitSlop={8}
                style={{ width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: c.line, alignItems: "center", justifyContent: "center" }}>
                <Icon name="edit" size={16} color={c.ink} />
              </Pressable>
              {confirm !== a.id ? <Btn label={t("Arsip", "Archive")} kind="ghost" small onPress={() => setConfirm(a.id)} accessibilityLabel={t(`Arsipkan ${a.name}`, `Archive ${a.name}`)} /> : null}
            </View>
            {confirm === a.id ? (
              <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
                <Btn label={t("Arsipkan", "Archive")} kind="danger" small onPress={() => archive(a.id)} />
                <Btn label={t("Batal", "Cancel")} kind="ghost" small onPress={() => setConfirm(null)} />
              </View>
            ) : null}
            <T v="mono" style={{ fontSize: 13 }}>{balanceText(a)}</T>
          </Row>
        ))}
      </Card>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar label={user ? user.name.slice(0, 2).toUpperCase() : "?"} />
          <View style={{ flex: 1 }}>
            <T numberOfLines={1}>{user?.name}</T>
            <T v="small" muted numberOfLines={1}>{user?.email}</T>
          </View>
        </View>
        <View style={{ marginTop: 14 }}>
          {logoutConfirm ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}><Btn label={t("Ya, keluar", "Yes, sign out")} kind="danger" onPress={() => void signOut()} /></View>
              <View style={{ flex: 1 }}><Btn label={t("Batal", "Cancel")} kind="ghost" onPress={() => setLogoutConfirm(false)} /></View>
            </View>
          ) : (
            <Btn label={t("Keluar", "Sign out")} kind="ghost" onPress={() => setLogoutConfirm(true)} />
          )}
        </View>
      </Card>
    </Screen>
  );
}
