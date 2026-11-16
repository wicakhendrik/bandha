"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import type { Account, ImportMapping, ImportPreview, ImportRow } from "@bandha/api-client";
import { AccountLogo } from "@/components/logos";
import { Select, type Option } from "@/components/select";
import { Shell } from "@/components/shell";
import { api, errorText, fetcher } from "@/lib/api";
import { dateShort, rp } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

const MAX_BYTES = 1_000_000;
const PAGE = 100;
const NONE = "none";
const FIELDS = [
  ["date", "imp.colDate"], ["description", "imp.colDesc"], ["amount", "imp.colAmount"], ["debit", "imp.colDebit"], ["credit", "imp.colCredit"], ["category", "imp.colCategory"],
] as const;

export default function ImportPage() {
  const { t } = useI18n();
  const { data: acc } = useSWR<{ accounts: Account[] }>("/accounts", fetcher);
  const accounts = acc?.accounts ?? [];
  const [accountId, setAccountId] = useState("");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [dateOrder, setDateOrder] = useState<"dmy" | "mdy">("dmy");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ batchKey: string; imported: number } | null>(null);
  const [undone, setUndone] = useState<number | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // One key per prepared import: pressing the button twice (or a retry after a dropped connection) cannot import twice.
  const batchKey = useRef(crypto.randomUUID());

  const effAccount = accounts.some((a) => a.id === accountId) ? accountId : (accounts[0]?.id ?? "");

  // Read the file again whenever the account, the file, or the column choices change.
  useEffect(() => {
    if (!csv || !effAccount) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    api<ImportPreview>("/imports/preview", { method: "POST", body: { accountId: effAccount, csv, dateOrder, ...(mapping ? { mapping } : {}) } })
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        // New rows are checked; rows the account already has are left unchecked.
        setSelected(new Set(p.rows.filter((r) => !r.duplicate).map((r) => r.line)));
        setShown(PAGE);
      })
      .catch((e) => { if (!cancelled) { setPreview(null); setError(errorText(e)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [csv, effAccount, mapping, dateOrder]);

  function load(text: string, name: string) {
    setMapping(null);
    setPreview(null);
    setDone(null);
    setUndone(null);
    setConfirmUndo(false);
    batchKey.current = crypto.randomUUID();
    setFileName(name);
    setCsv(text);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_BYTES) return setError(t("imp.tooBig"));
    try { load(await f.text(), f.name); } catch { setError(t("imp.readFail")); }
  }

  const columnOptions: Option[] = useMemo(
    () => [{ value: NONE, label: t("imp.none") }, ...(preview?.headers ?? []).map((h, i) => ({ value: String(i), label: h || `#${i + 1}`, hint: `#${i + 1}` }))],
    [preview?.headers, t],
  );
  const accountOptions: Option[] = accounts.map((a) => ({ value: a.id, label: a.name, icon: <AccountLogo account={a} size={26} />, keywords: a.kind }));

  const rows = preview?.rows ?? [];
  const chosen = rows.filter((r) => selected.has(r.line));
  const total = (type: ImportRow["type"]) => chosen.filter((r) => r.type === type).reduce((a, r) => a + Number(r.amount), 0);
  const toggle = (line: number) => setSelected((s) => { const n = new Set(s); if (n.has(line)) n.delete(line); else n.add(line); return n; });

  async function run() {
    if (chosen.length === 0) return setError(t("imp.nothingSelected"));
    setBusy(true);
    setError("");
    try {
      const r = await api<{ batchKey: string; imported: number }>("/imports", {
        method: "POST",
        body: { accountId: effAccount, batchKey: batchKey.current, rows: chosen.map(({ day, time, description, category, type, amount }) => ({ day, time, description, category, type, amount })) },
      });
      setDone({ batchKey: r.batchKey, imported: r.imported });
      await mutate(() => true);
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }

  async function undo() {
    if (!done) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ voided: number }>(`/imports/${done.batchKey}/undo`, { method: "POST", body: {} });
      setUndone(r.voided);
      setDone(null);
      setConfirmUndo(false);
      await mutate(() => true);
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }

  function reset() {
    setCsv(""); setFileName(""); setPreview(null); setMapping(null); setDone(null); setUndone(null); setPasted(""); setPasting(false); setError("");
    batchKey.current = crypto.randomUUID();
  }

  return (
    <Shell title={t("imp.title")}>
      <p className="hint" style={{ marginBottom: 16, maxWidth: 640 }}>{t("imp.subtitle")}</p>
      {error && <div className="err" role="alert">{error}</div>}

      {done ? (
        <div className="card">
          <div className="empty">
            <b>{t("imp.done", { n: done.imported })}</b>{t("imp.doneHint")}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
              <Link className="btn pri" href="/transactions">{t("imp.viewTx")}</Link>
              <button className="btn" onClick={reset}>{t("imp.another")}</button>
              {confirmUndo ? (
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <button className="btn danger" disabled={busy} onClick={undo}>{t("imp.undoConfirm")}</button>
                  <button className="btn" onClick={() => setConfirmUndo(false)}>{t("common.no")}</button>
                </span>
              ) : <button className="btn danger" onClick={() => setConfirmUndo(true)}>{t("imp.undo")}</button>}
            </div>
          </div>
        </div>
      ) : undone !== null ? (
        <div className="card"><div className="empty"><b>{t("imp.undone", { n: undone })}</b>
          <button className="btn" style={{ marginTop: 14 }} onClick={reset}>{t("imp.another")}</button></div></div>
      ) : (
        <>
          <article className="card" style={{ marginBottom: 18 }}>
            <h3>{t("imp.step1")}</h3>
            {acc && accounts.length === 0 ? <div className="warn" style={{ marginTop: 12 }}>{t("imp.noAccounts")}</div> : (
              <>
                <div className="field" style={{ marginTop: 14, maxWidth: 420 }}><label htmlFor="ia">{t("imp.account")}</label>
                  <Select id="ia" value={effAccount} onChange={setAccountId} options={accountOptions} /></div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} style={{ display: "none" }} aria-label={t("imp.pick")} />
                  <button className="btn pri" onClick={() => fileRef.current?.click()}>{csv ? t("imp.change") : t("imp.pick")}</button>
                  {fileName && preview && <small className="muted">{t("imp.fileInfo", { name: fileName, n: preview.summary.records })}</small>}
                  <button className="linkbtn" onClick={() => setPasting((p) => !p)}>{t("imp.or")}</button>
                </div>
                {pasting && (
                  <div className="field" style={{ marginTop: 12 }}>
                    <textarea className="input" rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={t("imp.paste")} aria-label={t("imp.paste")} style={{ fontFamily: "var(--font-mono), monospace", fontSize: 12.5 }} />
                    <div><button className="btn" disabled={!pasted.trim() || pasted.length > MAX_BYTES} onClick={() => load(pasted, "")}>{t("imp.read")}</button></div>
                  </div>
                )}
                <p className="hint" style={{ marginTop: 12 }}>{t("imp.onlyIdr")}</p>
              </>
            )}
          </article>

          {loading && !preview && <div className="card"><div className="skeleton" style={{ height: 120 }} aria-label={t("imp.previewing")} /></div>}

          {preview && (
            <>
              <article className="card" style={{ marginBottom: 18 }}>
                <h3>{t("imp.step2")}</h3>
                <div className="sub" style={{ marginBottom: 12 }}>{preview.needsMapping ? t("imp.needMap") : t("imp.mapHint")}</div>
                <details open={preview.needsMapping}>
                  <summary className="link" style={{ cursor: "pointer", marginBottom: 12 }}>{t("imp.mapAria")}</summary>
                  <div className="mapgrid">
                    {FIELDS.map(([f, label]) => (
                      <div className="field" key={f}><label htmlFor={`m-${f}`}>{t(label)}</label>
                        <Select id={`m-${f}`} value={preview.mapping[f] === null ? NONE : String(preview.mapping[f])} options={columnOptions} searchable={false}
                          onChange={(v) => setMapping({ ...preview.mapping, [f]: v === NONE ? null : Number(v) })} /></div>
                    ))}
                    <div className="field"><label htmlFor="m-order">{t("imp.dateOrder")}</label>
                      <Select id="m-order" value={dateOrder} searchable={false} onChange={(v) => setDateOrder(v as "dmy" | "mdy")}
                        options={[{ value: "dmy", label: t("imp.dmy") }, { value: "mdy", label: t("imp.mdy") }]} /></div>
                  </div>
                </details>
                {preview.needsMapping && preview.sample.length > 0 && (
                  <div style={{ overflowX: "auto", marginTop: 12 }}>
                    <table><thead><tr>{preview.headers.map((h, i) => <th key={i}>{h || `#${i + 1}`}</th>)}</tr></thead>
                      <tbody>{preview.sample.map((r, k) => <tr key={k}>{preview.headers.map((_, i) => <td key={i}>{r[i] ?? ""}</td>)}</tr>)}</tbody></table>
                  </div>
                )}
              </article>

              {!preview.needsMapping && (
                <article className="card" style={{ marginBottom: 18, opacity: loading ? 0.6 : 1 }}>
                  <h3>{t("imp.step3")}</h3>
                  <div className="importsum">
                    <div><small className="muted">{t("imp.read2")}</small><b className="num">{preview.summary.readable}</b></div>
                    <div><small className="muted">{t("imp.dups")}</small><b className="num">{preview.summary.duplicates}</b></div>
                    <div><small className="muted">{t("imp.problems")}</small><b className={`num ${preview.summary.problems ? "neg" : ""}`}>{preview.summary.problems}</b></div>
                    <div><small className="muted">{t("imp.skipped")}</small><b className="num">{preview.summary.skipped}</b></div>
                    <div><small className="muted">{t("imp.income")}</small><b className="num pos">{rp(String(total("income")))}</b></div>
                    <div><small className="muted">{t("imp.expense")}</small><b className="num neg">{rp(String(total("expense")))}</b></div>
                  </div>
                  {preview.summary.duplicates > 0 && <p className="hint" style={{ margin: "10px 0" }}>{t("imp.dupHint")}</p>}

                  {rows.length === 0 ? <div className="empty">{t("imp.empty")}</div> : (
                    <>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
                        <button className="btn sm" onClick={() => setSelected(new Set(rows.map((r) => r.line)))}>{t("imp.selectAll")}</button>
                        <button className="btn sm" onClick={() => setSelected(new Set(rows.filter((r) => !r.duplicate).map((r) => r.line)))}>{t("imp.selectNew")}</button>
                        <button className="btn sm" onClick={() => setSelected(new Set())}>{t("imp.selectNone")}</button>
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table>
                          <thead><tr><th><span style={{ position: "absolute", left: -9999 }}>{t("imp.colSel")}</span></th><th>{t("txm.date")}</th><th>{t("tx.colDesc")}</th><th className="r">{t("imp.colAmt")}</th><th className="hide-m" style={{ paddingLeft: 14 }}>{t("imp.colStatus")}</th></tr></thead>
                          <tbody>
                            {rows.slice(0, shown).map((r) => (
                              <tr key={r.line} style={{ opacity: selected.has(r.line) ? 1 : 0.55 }}>
                                <td><input type="checkbox" checked={selected.has(r.line)} onChange={() => toggle(r.line)} aria-label={`${t("imp.line", { n: r.line })}: ${r.description || dateShort(r.day)}`} style={{ width: 18, height: 18, accentColor: "var(--gold)" }} /></td>
                                <td style={{ whiteSpace: "nowrap" }}>{dateShort(r.day)}{r.time ? ` ${r.time}` : ""}</td>
                                <td><b>{r.description || "—"}</b>{r.category && <><br /><small className="muted">{r.category}</small></>}</td>
                                <td className="r"><span className={`num ${r.type === "income" ? "pos" : "neg"}`}>{r.type === "income" ? "+" : "−"}{rp(r.amount)}</span></td>
                                <td className="hide-m" style={{ paddingLeft: 14 }}><span className={`tag ${r.duplicate ? "" : "ok"}`}>{r.duplicate ? t("imp.dup") : t("imp.new")}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {rows.length > shown && <div style={{ textAlign: "center", marginTop: 12 }}><button className="btn" onClick={() => setShown((n) => n + PAGE)}>{t("imp.showMore", { n: Math.min(PAGE, rows.length - shown) })}</button></div>}
                    </>
                  )}

                  {preview.problems.length > 0 && (
                    <details style={{ marginTop: 16 }}>
                      <summary className="link" style={{ cursor: "pointer" }}>{t("imp.problemsTitle")} ({preview.problems.length})</summary>
                      <p className="hint" style={{ margin: "8px 0" }}>{t("imp.problemsHint")}</p>
                      {preview.problems.slice(0, 50).map((p) => (
                        <div className="row" key={p.line}><div className="t"><b>{t("imp.line", { n: p.line })}: {p.error}</b><small>{p.raw}</small></div></div>
                      ))}
                    </details>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
                    <button className="btn pri" disabled={busy || loading || chosen.length === 0} onClick={run}>{busy ? t("imp.running") : t("imp.run", { n: chosen.length })}</button>
                  </div>
                </article>
              )}
            </>
          )}
        </>
      )}
    </Shell>
  );
}
