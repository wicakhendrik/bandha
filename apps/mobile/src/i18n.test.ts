import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every visible string in the app is written as an Indonesian/English pair, t("Simpan", "Save"). This guard reads the
 * source and fails when Indonesian text is left outside such a pair, so a screen cannot ship half translated.
 */

const ROOT = join(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules" || f === "dist") return [];
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });

// Words that are Indonesian and not English. Shared words (Transfer, Email, Edit, Void, Bandha) are deliberately absent.
const WORDS = [
  "Tambah", "Rekening", "rekening", "Simpan", "Batal", "Batalkan", "Tutup", "Kembali", "Pilih", "Cari", "Belum", "Gagal", "Utang", "Piutang",
  "Keluar", "Masuk", "Jual", "Beli", "Saldo", "Catatan", "Tanggal", "Jumlah", "Kategori", "Hitung", "Bunga", "Lunas", "Ketuk", "Berdasarkan",
  "Terjadi kesalahan", "Coba lagi", "Kata sandi", "Muat lebih", "Impor", "transaksi", "Transaksi", "Pemasukan", "Pengeluaran", "Beranda",
  "Lihat", "Tidak", "Sudah", "Hapus", "Arsip", "Mulai", "Selesai", "Lewati", "Nanti", "Pengaturan", "Bahasa", "Akun", "Kirim", "Buat", "Daftar",
  "Sisa", "Pokok", "Riwayat", "Jatuh tempo", "Bayar", "Terima", "Pinjam", "Dipinjam", "Nilai", "Harga", "Modal", "Posisi", "Aset", "Koin", "Emas",
  "Biaya", "Ubah", "Selamat", "Lupa", "Ulangi", "Tempel", "Salin", "Terbaru", "Lainnya", "Semua", "Dilewati", "Bermasalah", "Terbaca", "Ganti",
];

const PAIR = /\bt\(\s*(?:`(?:[^`\\]|\\.|\$\{[^}]*\})*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*(?:`(?:[^`\\]|\\.|\$\{[^}]*\})*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\)/g;

function leftovers(src: string): string[] {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/ .*$/gm, "")
    .replace(/^import .*$/gm, "")
    .replace(PAIR, "T()");
  const found: string[] = [];
  // string literals and JSX text
  for (const m of code.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`|>([^<>{}\n]+)</g)) {
    // A language is always named in itself ("Bahasa Indonesia", "English"), whatever the app language is.
    const text = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").replace(/Bahasa Indonesia/g, "");
    if (WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(text))) found.push(text.trim().slice(0, 70));
  }
  return found;
}

describe("mobile translations", () => {
  it("leaves no Indonesian text outside an id/en pair", () => {
    const all = files(join(ROOT, "app")).concat(files(join(ROOT, "src")));
    expect(all.length).toBeGreaterThan(25); // the scan really sees the app
    const bad = all.flatMap((f) => leftovers(readFileSync(f, "utf8")).map((s) => `${relative(ROOT, f)}: ${s}`));
    expect(bad).toEqual([]);
  });

  it("the guard itself catches an untranslated string and accepts a pair", () => {
    expect(leftovers('<T>Simpan perubahan</T>')).toHaveLength(1);
    expect(leftovers('<Btn label="Tambah rekening" />')).toHaveLength(1);
    expect(leftovers('<T>{t("Simpan", "Save")}</T>')).toEqual([]);
    expect(leftovers('x = t(`Sisa ${rp(a)}`, `${rp(a)} left`)')).toEqual([]);
    expect(leftovers("// Tambah komentar\nconst a = 1;")).toEqual([]);
  });
});
