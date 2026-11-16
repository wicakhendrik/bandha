import { parseArgs } from "node:util";
import pg from "pg";
import { createDb } from "@bandha/db";
import type { RunReport } from "./finmap-run";
import { migrateOne } from "./finmap-run";
import { listOwners } from "./finmap-source";

const HELP = `Migrasi FinMap -> Bandha

Pemakaian (dari folder apps/api; DATABASE_URL di .env = database Bandha):
  FINMAP_DATABASE_URL=postgres://... pnpm migrate:finmap --list
  FINMAP_DATABASE_URL=postgres://... pnpm migrate:finmap --email orang@contoh.com            (dry-run, tidak menulis apa pun)
  FINMAP_DATABASE_URL=postgres://... pnpm migrate:finmap --email orang@contoh.com --apply    (menulis, hanya jika semuanya cocok)

Lebih baik isi alamat database lewat env FINMAP_DATABASE_URL: pnpm mencetak seluruh baris perintah, jadi
sandi di dalam --source akan tampil di terminal.

Pilihan:
  --source <url>        Postgres FinMap (default: env FINMAP_DATABASE_URL). Hanya dibaca, dalam transaksi READ ONLY.
  --list                Tampilkan pemilik workspace di FinMap
  --email <email>       Orang yang dimigrasi (satu orang per jalan)
  --apply               Benar-benar menulis. Tanpa ini semuanya dibatalkan di akhir (dry-run)
  --gold-unit <satuan>  gram | ounce. Wajib kalau ada emas (XAU), karena FinMap tidak mencatat satuannya
  --skip-failed         Tetap tulis walau ada transaksi yang gagal dimigrasi
  --allow-mismatch      Tetap tulis walau ada saldo yang berbeda dari FinMap
`;

const fmt = (n: number) => n.toLocaleString("id-ID");

function print(r: RunReport, apply: boolean) {
  const { plan, result } = r;
  const line = (s = "") => console.log(s);
  line(`\nFinMap -> Bandha  ${apply ? "[APPLY]" : "[DRY-RUN]"}`);
  line(`Akun      : ${plan.user.email} (workspace "${plan.workspace.name}", ${plan.workspace.currency})`);
  line(`Rencana   : ${plan.accounts.length} rekening, ${plan.steps.length} langkah, ${plan.debts.length} utang/piutang, ${plan.assets.length} aset dipakai`);
  const kinds = plan.steps.reduce<Record<string, number>>((a, s) => ({ ...a, [s.k]: (a[s.k] ?? 0) + 1 }), {});
  line(`            ${Object.entries(kinds).map(([k, n]) => `${k}: ${n}`).join(", ") || "-"}`);

  if (plan.blockers.length) { line("\nPENGHALANG (harus diputuskan dulu):"); plan.blockers.forEach((b) => line(`  x ${b}`)); }
  if (plan.warnings.length) { line("\nPeringatan:"); plan.warnings.forEach((w) => line(`  ! ${w}`)); }
  if (plan.skipped.length) { line(`\nTidak dimigrasi (${plan.skipped.length}):`); plan.skipped.slice(0, 40).forEach((s) => line(`  - ${s.what}: ${s.reason}  [${s.ref}]`)); if (plan.skipped.length > 40) line(`  ... dan ${plan.skipped.length - 40} lagi`); }

  if (result) {
    line(`\nHasil     : ${Object.entries(result.counts.steps).map(([k, n]) => `${k}: ${n}`).join(", ") || "-"}; utang/piutang: ${result.counts.debts}; rekening diarsipkan: ${result.counts.archived}`);
    if (result.assetsCreated.length) { line("\nAset baru di katalog Bandha:"); result.assetsCreated.forEach((a) => line(`  + ${a}`)); }
    if (result.estimated.length) { line("\nModal/nilai diperkirakan dari harga hari ini (FinMap tidak mencatatnya; bisa diubah lewat Edit):"); result.estimated.slice(0, 40).forEach((e) => line(`  ~ ${e}`)); }
    if (result.failures.length) { line(`\nGAGAL (${result.failures.length}):`); result.failures.slice(0, 40).forEach((f) => line(`  x ${f.what}: ${f.error}  [${f.ref}]`)); }
    line(`\nRekonsiliasi saldo vs FinMap: ${result.mismatches.length === 0 ? "SEMUA COCOK" : `${result.mismatches.length} BERBEDA`}`);
    for (const m of result.mismatches.slice(0, 40)) line(`  ${m.account} / ${m.asset}: FinMap ${m.expected}, Bandha ${m.actual}`);
  }
  line(`\n${r.committed ? `SELESAI: data ditulis. ${fmt(plan.steps.length)} langkah dimigrasi. Pengguna bisa masuk dengan kata sandi FinMap-nya (hash argon2 dipertahankan dan diganti saat login pertama).` : `TIDAK DITULIS. ${r.notCommittedBecause ?? ""}`}`);
  if (!apply && !r.notCommittedBecause?.startsWith("Ada hal")) line("Jalankan ulang dengan --apply jika laporan di atas sudah benar.");
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: "string" }, list: { type: "boolean" }, email: { type: "string" }, apply: { type: "boolean" },
      "gold-unit": { type: "string" }, "skip-failed": { type: "boolean" }, "allow-mismatch": { type: "boolean" }, help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return console.log(HELP);
  const sourceUrl = values.source ?? process.env["FINMAP_DATABASE_URL"];
  if (!sourceUrl) { console.error("Isi --source atau FINMAP_DATABASE_URL.\n"); console.error(HELP); process.exit(2); }
  const source = new pg.Pool({ connectionString: sourceUrl, max: 2 });

  try {
    if (values.list) {
      const owners = await listOwners(source);
      console.log(owners.length === 0 ? "Tidak ada pemilik workspace." : owners.map((o) => `${o.email}  "${o.workspaceName}"  ${o.accounts} rekening, ${o.transactions} transaksi`).join("\n"));
      return;
    }
    if (!values.email) { console.error("Isi --email (lihat daftar dengan --list).\n"); process.exit(2); }
    const gold = values["gold-unit"];
    if (gold !== undefined && gold !== "gram" && gold !== "ounce") { console.error('--gold-unit harus "gram" atau "ounce".'); process.exit(2); }
    const dbUrl = process.env["DATABASE_URL"];
    if (!dbUrl) { console.error("DATABASE_URL (database Bandha) belum diisi."); process.exit(2); }
    const { db, pool } = createDb(dbUrl);
    try {
      const report = await migrateOne(source, db, {
        email: values.email, apply: !!values.apply, ...(gold ? { goldUnit: gold } : {}),
        skipFailed: !!values["skip-failed"], allowMismatch: !!values["allow-mismatch"],
      });
      print(report, !!values.apply);
      if (report.plan.blockers.length > 0 || (values.apply && !report.committed)) process.exitCode = 1;
    } finally {
      await pool.end();
    }
  } finally {
    await source.end();
  }
}

main().catch((e: unknown) => {
  // Connection errors can echo the connection string; print the message only.
  console.error(`Gagal: ${e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/g, "postgres://***") : "kesalahan tidak dikenal"}`);
  process.exit(1);
});
