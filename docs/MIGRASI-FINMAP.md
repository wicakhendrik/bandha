# Migrasi data dari FinMap

Catatan cara kerja skrip migrasi FinMap ke Bandha. Kembali ke [README](../README.md).

Migrasi dari FinMap: `pnpm --filter @bandha/api migrate:finmap` memindahkan **satu orang per jalan** dari database Postgres FinMap ke Bandha. Database FinMap hanya dibaca (transaksi `READ ONLY`). Prosedur: (1) isi `FINMAP_DATABASE_URL` (lebih aman daripada `--source`, karena pnpm mencetak seluruh baris perintah); (2) `--list` untuk melihat pemilik workspace; (3) jalankan **dry-run** `--email orang@contoh.com`: skrip benar-benar melakukan seluruh migrasi di dalam satu transaksi database lalu membatalkannya, jadi laporannya persis hasil jalan sungguhan; (4) bila laporan benar, ulangi dengan `--apply`. `--apply` hanya menulis bila **tidak ada transaksi yang gagal** dan **semua saldo per rekening dan aset sama dengan saldo yang ditampilkan FinMap** (proyeksi saldonya); pengecualian harus disetujui eksplisit dengan `--skip-failed` / `--allow-mismatch`. Skrip tidak pernah menimpa atau menggabungkan akun yang sudah ada di Bandha (email sama = ditolak), jadi aman dijalankan ulang.

- **Pendekatan:** bukan menyalin jurnal FinMap. Buku besar dan proyeksi saldo FinMap tidak selalu sejalan (mis. biaya konversi tercatat di ledger tanpa mengurangi rekening), padahal yang dilihat dan dipercaya pengguna adalah saldo rekening. Maka **perintah transaksi** (snapshot revisi terkini) diputar ulang lewat service Bandha sendiri (modal rata-rata, jurnal seimbang, tidak ada aset negatif), berurutan menurut tanggal, lalu hasilnya direkonsiliasi dengan saldo FinMap. Edit di FinMap yang tersimpan sebagai jurnal mentah dibaca dari jurnal yang berlaku. Hanya keadaan akhir yang dibawa, bukan riwayat jurnal pembalik.

- **Yang dimigrasi:** pengguna (email, **kata sandi tetap sama**: hash argon2 FinMap dipertahankan, diterima saat login, dan diganti hash Bandha pada login pertama; akun tanpa kata sandi memakai "Lupa kata sandi"), rekening (nama sumber + rekening, jenis, logo, ikut kekayaan bersih, diarsipkan bila sumber/rekening diarsipkan), saldo awal (selalu lebih dulu), pemasukan, pengeluaran, transfer (+ biaya sebagai pengeluaran terpisah), konversi (rupiah ke aset = **beli**, aset ke rupiah = **jual**, aset ke aset = jual lalu beli pada nilai rupiah yang sama sehingga tidak ada sisa rupiah, aset sama = transfer), serta utang/piutang aktif sebagai kontrak yang sudah ada sebesar **sisa**. Aset yang belum ada di katalog Bandha ditambahkan (berharga bila FinMap punya id CoinGecko). Transaksi diberi tag `dari-finmap`.

- **Tidak dimigrasi (dilaporkan satu per satu):** transaksi draft/terjadwal/void, jenis yang belum didukung (dividen, split, refund, penyesuaian), utang lunas/dihapus, anggota lain di workspace bersama (Bandha satu orang per buku besar), riwayat kekayaan bersih (Bandha membangun miliknya sendiri), rekonsiliasi, dan impor CSV lama.

- **Keputusan yang harus dibuat pengguna:** bila ada **emas (XAU)**, tentukan `--gold-unit=gram|ounce` karena FinMap tidak mencatat satuannya (ounce dikonversi ke gram, 31,1034768). Hanya workspace **IDR**.

- **Perbedaan yang perlu dipahami:** modal saldo awal valas dan aset tanpa modal diperkirakan dari harga hari ini (FinMap mencatat valas bernilai nominal dalam rupiah, 100 USD = Rp 100, sehingga bukan modal sebenarnya); daftar perkiraan tampil di laporan dan bisa diubah lewat Edit. Rekening bertipe kartu kredit/pinjaman menjadi rekening biasa ("Lainnya"). Biaya konversi tanpa aset pembayar tidak dimigrasi karena di FinMap tidak mengubah saldo. Utang kini masuk kekayaan bersih.

- **Diuji** terhadap struktur tabel FinMap yang asli (migrasi Prisma-nya dijalankan di skema sementara) dan terhadap data tiruan gaya FinMap lengkap dengan keanehannya. Belum dicoba pada data FinMap sungguhan karena tidak ada di mesin ini: jalankan dry-run dulu dan baca laporannya.

## Cara menjalankan

Lokal (database FinMap bisa dijangkau dari mesin ini):

```bash
export FINMAP_DATABASE_URL=postgres://user:sandi@host:5432/finmap
pnpm --filter @bandha/api migrate:finmap -- --list
pnpm --filter @bandha/api migrate:finmap -- --email orang@contoh.com            # dry-run
pnpm --filter @bandha/api migrate:finmap -- --email orang@contoh.com --apply    # menulis
```

Di server (Docker): lihat bagian "Memindahkan data dari FinMap" di [DEPLOY.md](DEPLOY.md).
