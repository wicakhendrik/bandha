import { router } from "expo-router";
import { Pressable, View } from "react-native";
import useSWR from "swr";
import {
  assetKindLabel, balanceText, dateLong, dateShort, greeting, qty, rp, txView,
  type Account, type Asset, type CashflowMonth, type Dashboard, type HistoryPoint, type Tx,
} from "@bandha/api-client";
import { useAuth } from "../../../src/auth";
import { CashflowBars, Donut, Sparkline } from "../../../src/charts";
import { useRefresh } from "../../../src/data";
import { useT } from "../../../src/i18n";
import { OnboardingCard } from "../../../src/onboarding";
import { usePrivacy } from "../../../src/privacy";
import { AccountLogo, CoinLogo } from "../../../src/logos";
import { SLICE, useTheme } from "../../../src/theme";
import { Avatar, BatikBackground, Banner, Btn, Card, Empty, Icon, Row, Screen, Skeleton, T } from "../../../src/ui";

export default function Home() {
  const c = useTheme();
  const t = useT();
  const { user } = useAuth();
  const { hidden, toggle, mask: m } = usePrivacy();
  const { refreshing, refresh } = useRefresh();
  const dash = useSWR<Dashboard>("/dashboard");
  const flow = useSWR<{ months: CashflowMonth[] }>("/dashboard/cashflow?months=6");
  const hist = useSWR<{ points: HistoryPoint[] }>("/dashboard/history?days=180");
  const accs = useSWR<{ accounts: Account[] }>("/accounts");
  const txs = useSWR<{ transactions: Tx[] }>("/transactions?limit=5");
  const assets = useSWR<{ assets: Asset[] }>("/assets");

  const d = dash.data;
  const months = flow.data?.months ?? [];
  const cur = months[months.length - 1];
  const points = hist.data?.points ?? [];
  const change = points.length >= 2 ? Number(points[points.length - 1]!.netWorth) - Number(points[0]!.netWorth) : null;
  const accountMap = new Map((accs.data?.accounts ?? []).map((a) => [a.id, a]));
  const assetMap = new Map((assets.data?.assets ?? []).map((a) => [a.id, a]));
  const nonFiat = (d?.holdings ?? []).filter((h) => h.kind !== "fiat");

  return (
    <Screen onRefresh={refresh} refreshing={refreshing} bottomPad={96}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <T v="small" muted>{dateLong(new Date())}</T>
          <T v="title" accessibilityRole="header">{greeting()}{user ? `, ${user.name.split(" ")[0]}` : ""}</T>
        </View>
        <Pressable onPress={() => router.push("/settings")} accessibilityRole="button" accessibilityLabel={t("Pengaturan", "Settings")} hitSlop={8}>
          <Avatar label={user ? user.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() : ""} />
        </Pressable>
      </View>

      <OnboardingCard />

      {dash.error ? (
        <Card><Empty title={t("Dashboard gagal dimuat", "Dashboard failed to load")} text={dash.error instanceof Error ? dash.error.message : t("Coba lagi.", "Try again.")} action={<Btn label={t("Coba lagi", "Try again")} kind="ghost" small onPress={refresh} />} /></Card>
      ) : null}

      {d && !d.complete ? <Banner tone="warn">{t(`Total belum lengkap: aset ${d.unpriced.join(", ")} belum punya harga pasar, jadi belum dihitung.`, `Total is incomplete: ${d.unpriced.join(", ")} has no market price yet, so it is not counted.`)}</Banner> : null}

      <View style={{ borderRadius: 22, overflow: "hidden", padding: 20 }}>
        <BatikBackground />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T v="label" color="#E7CFA3" style={{ letterSpacing: 1, textTransform: "uppercase" }}>{t("Total kekayaan bersih", "Net worth")}</T>
          <Pressable
            onPress={toggle} hitSlop={10} accessibilityRole="button" accessibilityState={{ selected: hidden }}
            accessibilityLabel={hidden ? t("Tampilkan jumlah uang", "Show amounts") : t("Sembunyikan jumlah uang", "Hide amounts")}
            style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" }}
          >
            <Icon name={hidden ? "eyeOff" : "eye"} size={20} color="#FBEFD6" />
          </Pressable>
        </View>
        {d ? (
          <T style={{ fontFamily: "Fraunces_600SemiBold", fontSize: 38, lineHeight: 46, marginTop: 6 }} color="#FBEFD6" accessibilityRole="header">{m(rp(d.netWorth))}</T>
        ) : <View style={{ marginVertical: 10 }}><Skeleton h={40} w="70%" /></View>}
        {change !== null ? <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Icon name={change >= 0 ? "arrowUp" : "arrowDown"} size={14} color="#E7CFA3" /><T v="small" color="#E7CFA3">{m(rp(String(Math.abs(change))))} {t("sejak", "since")} {dateShort(`${points[0]!.day}T12:00:00+07:00`)}</T></View> : null}
        <View style={{ marginTop: 14 }}>
          {points.length >= 2 ? <Sparkline points={points} /> : (
            <View style={{ height: 90, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(231,207,163,0.4)", borderRadius: 14, alignItems: "center", justifyContent: "center", padding: 12 }}>
              <T v="small" color="#E7CFA3" style={{ textAlign: "center" }}>{t("Grafik terbentuk seiring Anda memakai Bandha dari hari ke hari.", "The chart builds up as you use Bandha from day to day.")}</T>
            </View>
          )}
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 12 }}>
        <Pressable style={{ flex: 1 }} onPress={() => router.push("/cashflow/income")} accessibilityRole="button" accessibilityLabel={t("Pemasukan bulan ini, lihat detail", "Income this month, see details")}>
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><T v="small" muted>{t("Pemasukan bulan ini", "Income this month")}</T><Icon name="chevronRight" size={16} color={c.muted} /></View>
            {cur ? <T v="mono" color={c.pos} style={{ marginTop: 4 }}>{m(rp(cur.income))}</T> : <Skeleton h={20} />}
          </Card>
        </Pressable>
        <Pressable style={{ flex: 1 }} onPress={() => router.push("/cashflow/expense")} accessibilityRole="button" accessibilityLabel={t("Pengeluaran bulan ini, lihat detail", "Expenses this month, see details")}>
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><T v="small" muted>{t("Pengeluaran bulan ini", "Expenses this month")}</T><Icon name="chevronRight" size={16} color={c.muted} /></View>
            {cur ? <T v="mono" color={c.neg} style={{ marginTop: 4 }}>{m(rp(cur.expense))}</T> : <Skeleton h={20} />}
          </Card>
        </Pressable>
      </View>

      <Card>
        <T v="heading">{t("Arus kas", "Cash flow")}</T>
        <T v="small" muted style={{ marginBottom: 12 }}>{t("6 bulan terakhir · hijau masuk, emas keluar", "Last 6 months · green in, gold out")}</T>
        {months.length ? <CashflowBars months={months} /> : <Skeleton h={150} />}
      </Card>

      <Card>
        <T v="heading">{t("Alokasi aset", "Asset allocation")}</T>
        {!d ? <Skeleton h={140} /> : d.allocation.length === 0 ? <Empty title={t("Belum ada aset bernilai", "No valued assets yet")} /> : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 10 }}>
            <Donut slices={d.allocation.map((a) => ({ percent: Number(a.percent) }))} size={120} />
            <View style={{ flex: 1, gap: 8 }}>
              {d.allocation.map((a, i) => (
                <View key={a.key} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: SLICE[i % SLICE.length] }} />
                    <T v="small">{assetKindLabel(a.key)}</T>
                  </View>
                  <T v="mono" style={{ fontSize: 13 }}>{a.percent}%</T>
                </View>
              ))}
            </View>
          </View>
        )}
      </Card>

      <Pressable onPress={() => router.push("/debts")} accessibilityRole="button" accessibilityLabel={t("Utang dan piutang, lihat detail", "Debts and receivables, see details")}>
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View><T v="heading">{t("Utang & piutang", "Debts & receivables")}</T><T v="small" muted>{t("Sudah termasuk dalam kekayaan bersih", "Already included in net worth")}</T></View>
            <Icon name="chevronRight" size={18} color={c.muted} />
          </View>
          {!d ? <Skeleton h={40} /> : Number(d.debts.payable) === 0 && Number(d.debts.receivable) === 0 ? (
            <T v="small" muted style={{ marginTop: 10 }}>{t("Tidak ada utang atau piutang aktif. Ketuk untuk mencatat.", "No active debts or receivables. Tap to add one.")}</T>
          ) : (
            <View style={{ flexDirection: "row", gap: 12, marginTop: 10 }}>
              <View style={{ flex: 1 }}><T v="small" muted>{t("Utang saya", "I owe")}</T><T v="mono" color={c.neg}>{m(rp(d.debts.payable))}</T></View>
              <View style={{ flex: 1 }}><T v="small" muted>{t("Piutang saya", "Owed to me")}</T><T v="mono" color={c.pos}>{m(rp(d.debts.receivable))}</T></View>
            </View>
          )}
        </Card>
      </Pressable>

      <Card>
        <T v="heading">{t("Rekening", "Accounts")}</T>
        {!accs.data ? <Skeleton h={90} /> : accs.data.accounts.length === 0 ? (
          <Empty title={t("Belum ada rekening", "No accounts yet")} text={t("Tambahkan rekening pertama Anda.", "Add your first account.")} action={<Btn label={t("Tambah rekening", "Add account")} small onPress={() => router.push("/add-account")} />} />
        ) : accs.data.accounts.slice(0, 4).map((a) => (
          <Row key={a.id}>
            <AccountLogo account={a} size={36} />
            <View style={{ flex: 1 }}><T numberOfLines={1}>{a.name}</T></View>
            <T v="mono" style={{ fontSize: 13 }}>{m(balanceText(a))}</T>
          </Row>
        ))}
      </Card>

      <Card>
        <T v="heading">{t("Transaksi terbaru", "Recent transactions")}</T>
        {!txs.data ? <Skeleton h={90} /> : txs.data.transactions.length === 0 ? (
          <Empty title={t("Belum ada transaksi", "No transactions yet")} text={t("Ketuk tombol + untuk mencatat.", "Tap the + button to record one.")} />
        ) : txs.data.transactions.map((tx) => {
          const v = txView(tx, accountMap, assetMap);
          return (
            <Row key={tx.id}>
              <View style={{ flex: 1 }}>
                <T numberOfLines={1}>{v.title}</T>
                <T v="small" muted numberOfLines={1}>{dateShort(tx.occurredAt)} · {v.accountLabel}</T>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <T v="mono" style={{ fontSize: 13 }} color={v.tone === "pos" ? c.pos : v.tone === "neg" ? c.neg : c.ink}>{m(v.amount)}</T>
                {v.secondary ? <T v="small" muted>{m(v.secondary)}</T> : null}
              </View>
            </Row>
          );
        })}
      </Card>

      {nonFiat.length > 0 ? (
        <Card>
          <T v="heading">{t("Aset non-rupiah", "Non-rupiah assets")}</T>
          <T v="small" muted>{t("Harga dalam IDR", "Priced in IDR")}</T>
          {nonFiat.map((h) => (
            <Row key={h.assetId}>
              <CoinLogo symbol={h.symbol} size={36} />
              <View style={{ flex: 1 }}>
                <T>{h.name}</T>
                <T v="small" muted>{m(`${qty(h.quantity)} ${h.symbol}`)}</T>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <T v="mono" style={{ fontSize: 13 }}>{h.value === null ? t("Belum ada harga", "No price yet") : m(rp(h.value))}</T>
                {h.stale ? <T v="small" muted>{t("harga lama", "stale price")}</T> : null}
              </View>
            </Row>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
