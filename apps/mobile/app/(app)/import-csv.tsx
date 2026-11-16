import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import useSWR, { mutate } from "swr";
import { ApiError, dateShort, rp, type Account, type ImportMapping, type ImportPreview, type ImportRow } from "@bandha/api-client";
import { client } from "../../src/api";
import { newIdempotencyKey } from "../../src/data";
import { useT } from "../../src/i18n";
import { AccountLogo } from "../../src/logos";
import { goBack } from "../../src/nav";
import { SearchPicker, type PickerOption } from "../../src/picker";
import { useTheme } from "../../src/theme";
import { Banner, Btn, Card, Chips, Empty, Icon, Screen, Skeleton, T } from "../../src/ui";

const MAX_BYTES = 1_000_000;
const PAGE = 60;
const NONE = "none";
const FIELD_KEYS: Array<keyof ImportMapping> = ["date", "description", "amount", "debit", "credit", "category"];

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? (e.issues?.[0] ? `${e.issues[0].path}: ${e.issues[0].message}` : e.message) : fallback);

export default function ImportCsv() {
  const c = useTheme();
  const t = useT();
  const oops = t("Terjadi kesalahan", "Something went wrong");
  const fieldLabel: Record<keyof ImportMapping, string> = {
    date: t("Tanggal", "Date"), description: t("Keterangan", "Description"), amount: t("Jumlah (satu kolom, minus = keluar)", "Amount (one column, minus = out)"),
    debit: t("Debit / uang keluar", "Debit / money out"), credit: t("Kredit / uang masuk", "Credit / money in"), category: t("Kategori", "Category"),
  };
  const accs = useSWR<{ accounts: Account[] }>("/accounts");
  const accounts = accs.data?.accounts ?? [];
  const [accountId, setAccountId] = useState("");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [dateOrder, setDateOrder] = useState<"dmy" | "mdy">("dmy");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [showMap, setShowMap] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ batchKey: string; imported: number } | null>(null);
  const [undone, setUndone] = useState<number | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  // One key per prepared import: a double tap or a retry after a dropped connection cannot import twice.
  const batchKey = useRef(newIdempotencyKey());

  const effAccount = accounts.some((a) => a.id === accountId) ? accountId : (accounts[0]?.id ?? "");

  useEffect(() => {
    if (!csv || !effAccount) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    client.previewImport({ accountId: effAccount, csv, dateOrder, ...(mapping ? { mapping } : {}) })
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setSelected(new Set(p.rows.filter((r) => !r.duplicate).map((r) => r.line)));
        setShown(PAGE);
        if (p.needsMapping) setShowMap(true);
      })
      .catch((e) => { if (!cancelled) { setPreview(null); setError(message(e, oops)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [csv, effAccount, mapping, dateOrder]);

  async function pick() {
    setError("");
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain", "application/vnd.ms-excel", "*/*"], copyToCacheDirectory: true });
      if (res.canceled || !res.assets[0]) return;
      const asset = res.assets[0];
      if (asset.size !== undefined && asset.size > MAX_BYTES) return setError(t("File terlalu besar (maksimal 1 MB)", "The file is too large (1 MB maximum)"));
      const text = await (await fetch(asset.uri)).text();
      if (text.length > MAX_BYTES) return setError(t("File terlalu besar (maksimal 1 MB)", "The file is too large (1 MB maximum)"));
      setMapping(null); setPreview(null); setDone(null); setUndone(null); setConfirmUndo(false);
      batchKey.current = newIdempotencyKey();
      setFileName(asset.name);
      setCsv(text);
    } catch {
      setError(t("File tidak bisa dibaca", "The file could not be read"));
    }
  }

  const rows = preview?.rows ?? [];
  const chosen = rows.filter((r) => selected.has(r.line));
  const total = (type: ImportRow["type"]) => chosen.filter((r) => r.type === type).reduce((a, r) => a + Number(r.amount), 0);
  const toggle = (line: number) => setSelected((s) => { const n = new Set(s); if (n.has(line)) n.delete(line); else n.add(line); return n; });
  const accountOptions: PickerOption[] = accounts.map((a) => ({ value: a.id, label: a.name, icon: <AccountLogo account={a} size={30} />, keywords: a.kind }));
  const columnOptions: PickerOption[] = [{ value: NONE, label: t("— tidak ada —", "— none —") }, ...(preview?.headers ?? []).map((h, i) => ({ value: String(i), label: h || `#${i + 1}`, hint: `#${i + 1}` }))];

  async function run() {
    if (chosen.length === 0) return setError(t("Pilih setidaknya satu baris", "Select at least one row"));
    setBusy(true);
    setError("");
    try {
      const r = await client.commitImport({
        accountId: effAccount, batchKey: batchKey.current,
        rows: chosen.map(({ day, time, description, category, type, amount }) => ({ day, time, description, category, type, amount })),
      });
      setDone({ batchKey: r.batchKey, imported: r.imported });
      await mutate(() => true);
    } catch (e) { setError(message(e, oops)); }
    setBusy(false);
  }

  async function undo() {
    if (!done) return;
    setBusy(true);
    setError("");
    try {
      const r = await client.undoImport(done.batchKey);
      setUndone(r.voided); setDone(null); setConfirmUndo(false);
      await mutate(() => true);
    } catch (e) { setError(message(e, oops)); }
    setBusy(false);
  }

  function reset() {
    setCsv(""); setFileName(""); setPreview(null); setMapping(null); setDone(null); setUndone(null); setError(""); setConfirmUndo(false);
    batchKey.current = newIdempotencyKey();
  }

  return (
    <Screen>
      <View style={{ flexDirection: "row" }}><Btn label={t("Transaksi", "Transactions")} icon="arrowLeft" kind="ghost" small onPress={goBack} /></View>
      <T v="title" accessibilityRole="header">{t("Impor CSV", "Import CSV")}</T>
      <T v="small" muted>{t("Masukkan mutasi dari bank atau e-wallet sekaligus. Anda bisa memeriksa dan memilih baris sebelum apa pun dicatat.", "Bring in statements from your bank or e-wallet in one go. You review and choose the rows before anything is recorded.")}</T>
      {error ? <Banner tone="err">{error}</Banner> : null}

      {done ? (
        <Card>
          <Empty title={t(`Selesai: ${done.imported} transaksi diimpor`, `Done: ${done.imported} transactions imported`)} text={t("Pemasukan dan pengeluaran ini sudah masuk ke saldo, arus kas, dan kekayaan bersih.", "These income and expenses now count in your balances, cash flow and net worth.")} />
          <View style={{ gap: 10 }}>
            <Btn label={t("Lihat transaksi", "View transactions")} onPress={() => router.replace("/transactions")} />
            <Btn label={t("Impor file lain", "Import another file")} kind="ghost" onPress={reset} />
            {confirmUndo ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}><Btn label={t("Ya, batalkan semuanya", "Yes, undo all of it")} kind="danger" busy={busy} onPress={undo} /></View>
                <Btn label={t("Tidak", "No")} kind="ghost" onPress={() => setConfirmUndo(false)} />
              </View>
            ) : <Btn label={t("Batalkan impor ini", "Undo this import")} kind="danger" onPress={() => setConfirmUndo(true)} />}
          </View>
        </Card>
      ) : undone !== null ? (
        <Card><Empty title={t(`Impor dibatalkan: ${undone} transaksi di-void`, `Import undone: ${undone} transactions voided`)} action={<Btn label={t("Impor file lain", "Import another file")} kind="ghost" small onPress={reset} />} /></Card>
      ) : (
        <>
          <Card>
            <T v="heading">{t("1. Pilih rekening dan file", "1. Choose account and file")}</T>
            {accs.data && accounts.length === 0 ? <Banner tone="warn">{t("Belum ada rekening. Tambahkan rekening dulu.", "No accounts yet. Add an account first.")}</Banner> : (
              <View style={{ gap: 12, marginTop: 8 }}>
                <SearchPicker label={t("Masuk ke rekening", "Import into account")} options={accountOptions} value={effAccount} onChange={setAccountId} searchPlaceholder={t("Cari rekening…", "Search accounts…")} />
                <Btn label={csv ? t("Ganti file", "Change file") : t("Pilih file CSV", "Choose CSV file")} icon="arrowDown" onPress={pick} />
                {fileName && preview ? <T v="small" muted>{fileName} · {t(`${preview.summary.records} baris data`, `${preview.summary.records} data rows`)}</T> : null}
                <T v="small" muted>{t("Semua baris dicatat dalam rupiah (IDR) sebagai pemasukan atau pengeluaran.", "Every row is recorded in rupiah (IDR) as income or expense.")}</T>
              </View>
            )}
          </Card>

          {loading && !preview ? <Card><Skeleton h={120} /></Card> : null}

          {preview ? (
            <>
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <T v="heading">{t("2. Periksa kolom", "2. Check the columns")}</T>
                  <Btn label={showMap ? t("Sembunyikan", "Hide") : t("Atur kolom", "Set columns")} kind="ghost" small onPress={() => setShowMap((v) => !v)} />
                </View>
                <T v="small" muted>{preview.needsMapping ? t("Kolom tanggal atau jumlah belum ketemu. Pilih kolomnya di bawah.", "The date or amount column was not found. Choose them below.") : t("Kolom dikenali otomatis dari judulnya. Ubah kalau ada yang keliru.", "Columns are recognised from their headings. Change any that are wrong.")}</T>
                {showMap ? (
                  <View style={{ gap: 12, marginTop: 12 }}>
                    {FIELD_KEYS.map((f) => (
                      <SearchPicker key={f} label={fieldLabel[f]} options={columnOptions} value={preview.mapping[f] === null ? NONE : String(preview.mapping[f])}
                        onChange={(v) => setMapping({ ...preview.mapping, [f]: v === NONE ? null : Number(v) })} searchPlaceholder={t("Cari kolom…", "Search columns…")} />
                    ))}
                    <Chips<"dmy" | "mdy"> label={t("Urutan tanggal", "Date order")} value={dateOrder} onChange={setDateOrder} options={[{ key: "dmy", label: t("15/11/2026 (H/B/T)", "15/11/2026 (D/M/Y)") }, { key: "mdy", label: t("11/15/2026 (B/H/T)", "11/15/2026 (M/D/Y)") }]} />
                  </View>
                ) : null}
              </Card>

              {!preview.needsMapping ? (
                <Card style={{ opacity: loading ? 0.6 : 1 }}>
                  <T v="heading">{t("3. Pilih baris", "3. Choose rows")}</T>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginVertical: 10 }}>
                    <Stat label={t("Terbaca", "Readable")} value={String(preview.summary.readable)} />
                    <Stat label={t("Sudah ada", "Already there")} value={String(preview.summary.duplicates)} />
                    <Stat label={t("Bermasalah", "Problems")} value={String(preview.summary.problems)} tone={preview.summary.problems ? c.neg : undefined} />
                    <Stat label={t("Dilewati", "Skipped")} value={String(preview.summary.skipped)} />
                  </View>
                  <View style={{ flexDirection: "row", gap: 16, marginBottom: 6 }}>
                    <View style={{ flex: 1 }}><T v="small" muted>{t("Pemasukan", "Income")}</T><T v="mono" color={c.pos} style={{ fontSize: 13 }}>{rp(String(total("income")))}</T></View>
                    <View style={{ flex: 1 }}><T v="small" muted>{t("Pengeluaran", "Expenses")}</T><T v="mono" color={c.neg} style={{ fontSize: 13 }}>{rp(String(total("expense")))}</T></View>
                  </View>
                  {preview.summary.duplicates > 0 ? <T v="small" muted>{t("“Sudah ada” = transaksi dengan tanggal, jumlah, dan keterangan yang sama sudah tercatat di rekening ini. Barisnya tidak dicentang, tapi bisa Anda centang kalau memang baru.", "“Already there” means a transaction with the same date, amount and description is already in this account. Those rows are unchecked, but you can check them if they really are new.")}</T> : null}

                  {rows.length === 0 ? <Empty title={t("Tidak ada baris yang bisa diimpor", "No rows can be imported")} /> : (
                    <>
                      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginVertical: 10 }}>
                        <Btn label={t("Pilih semua", "Select all")} kind="ghost" small onPress={() => setSelected(new Set(rows.map((r) => r.line)))} />
                        <Btn label={t("Hanya yang baru", "New only")} kind="ghost" small onPress={() => setSelected(new Set(rows.filter((r) => !r.duplicate).map((r) => r.line)))} />
                        <Btn label={t("Kosongkan", "Clear")} kind="ghost" small onPress={() => setSelected(new Set())} />
                      </View>
                      {rows.slice(0, shown).map((r) => {
                        const on = selected.has(r.line);
                        return (
                          <Pressable key={r.line} onPress={() => toggle(r.line)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                            accessibilityLabel={`${t("Baris", "Row")} ${r.line}: ${r.description || dateShort(`${r.day}T12:00:00+07:00`)}`}
                            style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.line, borderStyle: "dashed", opacity: on ? 1 : 0.55 }}>
                            <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: on ? c.gold : c.line, backgroundColor: on ? c.gold : "transparent", alignItems: "center", justifyContent: "center" }}>
                              {on ? <Icon name="check" size={14} color={c.walnut} /> : null}
                            </View>
                            <View style={{ flex: 1 }}>
                              <T numberOfLines={1}>{r.description || "—"}</T>
                              <T v="small" muted numberOfLines={1}>{dateShort(`${r.day}T12:00:00+07:00`)}{r.time ? ` ${r.time}` : ""}{r.category ? ` · ${r.category}` : ""}{r.duplicate ? t(" · Sudah ada", " · Already there") : ""}</T>
                            </View>
                            <T v="mono" style={{ fontSize: 13 }} color={r.type === "income" ? c.pos : c.neg}>{r.type === "income" ? "+" : "−"}{rp(r.amount)}</T>
                          </Pressable>
                        );
                      })}
                      {rows.length > shown ? <View style={{ marginTop: 10 }}><Btn label={t(`Tampilkan ${Math.min(PAGE, rows.length - shown)} baris lagi`, `Show ${Math.min(PAGE, rows.length - shown)} more rows`)} kind="ghost" onPress={() => setShown((n) => n + PAGE)} /></View> : null}
                    </>
                  )}

                  {preview.problems.length > 0 ? (
                    <View style={{ marginTop: 14, gap: 4 }}>
                      <T v="heading">{t("Baris yang tidak bisa dibaca", "Rows that could not be read")}</T>
                      <T v="small" muted>{t("Baris ini tidak ikut diimpor. Perbaiki di file lalu baca ulang, atau abaikan.", "These rows are not imported. Fix them in the file and read it again, or ignore them.")}</T>
                      {preview.problems.slice(0, 20).map((p) => <T key={p.line} v="small" color={c.neg}>{t("Baris", "Row")} {p.line}: {p.error}</T>)}
                    </View>
                  ) : null}

                  <View style={{ marginTop: 16 }}>
                    <Btn label={busy ? t("Mengimpor…", "Importing…") : t(`Impor ${chosen.length} transaksi`, `Import ${chosen.length} transactions`)} onPress={run} busy={busy} disabled={loading || chosen.length === 0} />
                  </View>
                </Card>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <View><T v="small" muted>{label}</T><T v="mono" color={tone} style={{ fontSize: 16 }}>{value}</T></View>;
}
