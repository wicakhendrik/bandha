# Deploy Bandha ke VPS

Dua lingkungan, dua branch, dua alamat. Satu perintah (`deploy/deploy.sh`) yang sama dipakai di keduanya.

| Branch        | Folder di server   | Alamat                    | `COMPOSE_PROJECT_NAME` | Port lokal (web / api) |
|---------------|--------------------|---------------------------|------------------------|------------------------|
| `development` | `/srv/bandha-dev`  | https://bandha-dev.grezly.app | `bandha-dev`       | 3100 / 4100            |
| `main`        | `/srv/bandha`      | https://bandha.grezly.app     | `bandha-prod`      | 3000 / 4000            |

Folder dan port boleh diganti; yang penting `deploy/.env` masing-masing konsisten dengan nginx.

## Cara kerjanya

```
git push ──► GitHub Actions ──► CI (typecheck, tes, tes + Postgres asli, build web, build Docker)
                                   │ lolos
                                   ▼
                          SSH ke VPS: cd /srv/bandha-dev && ./deploy/deploy.sh
                                   │
   nginx :443 ──► 127.0.0.1:WEB_PORT ──► [web] ──(jaringan Docker)──► [api] ──► [db]
                                                                          ▲
                                                           [migrate] jalan dulu setiap deploy
```

- **Hanya web yang terbuka ke internet.** API dan database ada di jaringan Docker; API juga hanya ditempel ke `127.0.0.1`.
  Browser tidak pernah bicara ke API langsung (web punya lapisan BFF yang menyimpan token di cookie `HttpOnly`).
- `deploy.sh`: tarik kode (fast-forward saja) → bangun image → jalankan stack (**migrasi database otomatis lebih dulu**) →
  tunggu semua layanan sehat → kalau versi baru gagal sehat, **otomatis kembali ke versi sebelumnya** dan keluar dengan kode 1
  (jadi CI menandai deploy itu gagal). Teruji: lihat bagian "Yang sudah diuji".
- Tag image = 12 karakter pertama commit, jadi setiap versi punya image sendiri dan rollback tidak perlu build ulang.

---

## A. Yang Anda kerjakan (GitHub)

1. Buat repo `bandha` dengan branch `main` dan `development`. Dari folder proyek ini:
   ```bash
   git remote add origin git@github.com:<akun>/bandha.git
   git push -u origin main
   git push -u origin development
   ```
   (repo lokal sudah punya commit dan kedua branch.)
2. **Settings → Environments**: buat dua environment, `development` dan `production`. Di masing-masing isi **secrets**:

   | Secret            | Isi                                                                                 |
   |-------------------|-------------------------------------------------------------------------------------|
   | `VPS_HOST`        | alamat/IP VPS                                                                       |
   | `VPS_USER`        | user SSH khusus deploy (lihat B.1)                                                  |
   | `VPS_PORT`        | (opsional) port SSH, default 22                                                     |
   | `VPS_SSH_KEY`     | **private key** khusus deploy (satu per environment atau dipakai bersama)            |
   | `VPS_KNOWN_HOSTS` | keluaran `ssh-keyscan -H <host>` (agar koneksi SSH terverifikasi, bukan asal percaya) |
   | `VPS_PATH`        | folder clone di server: `/srv/bandha-dev` (development) / `/srv/bandha` (production) |

   Disarankan: pada environment `production`, aktifkan **Required reviewers** supaya deploy ke produksi menunggu persetujuan Anda.
3. **Settings → Branches**: lindungi `main` (wajib lewat pull request + CI lolos). Alur kerja: kerja di `development` →
   otomatis naik ke bandha-dev → kalau sudah oke, PR `development` → `main` → naik ke produksi.

## B. Tugas untuk agent VPS

Kirim bagian ini (atau seluruh file) ke agent VPS Anda.

> **Prompt untuk agent VPS**
>
> Repo `git@github.com:<akun>/bandha.git`. Baca `docs/DEPLOY.md` di repo itu dan kerjakan bagian B persis seperti tertulis.
> Jangan mengubah isi `deploy/*`; kalau ada yang tidak cocok dengan server ini, katakan apa yang tidak cocok. Jangan
> menaruh rahasia apa pun di repo. Laporkan di akhir: hasil `docker compose ps`, hasil `curl -I` kedua alamat, dan nilai
> yang harus saya isi sebagai GitHub secrets (kecuali private key, cukup bilang sudah dibuat dan di mana).

**B.0 Prasyarat** (cek, pasang bila belum): Docker Engine + plugin `docker compose` v2, `git`, `nginx`, `certbot` (plugin nginx),
`openssl`. DNS: record A untuk `bandha.grezly.app` dan `bandha-dev.grezly.app` sudah mengarah ke VPS.

**B.1 User deploy dan kunci SSH untuk GitHub Actions**
```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy                       # boleh menjalankan docker
sudo install -d -o deploy -g deploy -m 755 /srv/bandha /srv/bandha-dev
sudo -u deploy ssh-keygen -t ed25519 -N "" -C "github-actions-bandha" -f /home/deploy/.ssh/gha_deploy
sudo -u deploy sh -c 'cat /home/deploy/.ssh/gha_deploy.pub >> /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys'
ssh-keyscan -H <alamat-vps>                          # -> nilai VPS_KNOWN_HOSTS
sudo cat /home/deploy/.ssh/gha_deploy                # -> nilai VPS_SSH_KEY (private key; berikan ke pemilik, jangan ditempel di log/chat)
```
Server juga perlu bisa `git fetch` dari GitHub: tambahkan **deploy key read-only** milik repo (Settings → Deploy keys) atau
pakai HTTPS dengan token read-only, dan pastikan `sudo -u deploy git ls-remote git@github.com:<akun>/bandha.git` berhasil.

**B.2 Clone kedua branch**
```bash
sudo -u deploy git clone --branch development git@github.com:<akun>/bandha.git /srv/bandha-dev
sudo -u deploy git clone --branch main        git@github.com:<akun>/bandha.git /srv/bandha
```

**B.3 Isi `deploy/.env` masing-masing** (jangan pernah di-commit; sudah di `.gitignore`)
```bash
cd /srv/bandha-dev && cp deploy/env.example deploy/.env && chmod 600 deploy/.env
```
Isi sesuai tabel di atas, dan buat rahasia **berbeda** untuk tiap lingkungan:
```bash
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 32   # JWT_SECRET
```
- **development**: `COMPOSE_PROJECT_NAME=bandha-dev`, `WEB_PORT=3100`, `API_PORT=4100`, `APP_ENV=development`,
  `WEB_ORIGIN`/`APP_URL=https://bandha-dev.grezly.app`, `MAIL_TRANSPORT=console` (kode verifikasi pendaftaran dan tautan "lupa kata sandi" muncul di
  `docker compose logs api`; atau isi SMTP, panduan Microsoft 365 di [EMAIL.md](EMAIL.md)).
- **production**: `COMPOSE_PROJECT_NAME=bandha-prod`, `WEB_PORT=3000`, `API_PORT=4000`, `APP_ENV=production`,
  `WEB_ORIGIN`/`APP_URL=https://bandha.grezly.app`, **`MAIL_TRANSPORT=smtp` + `SMTP_URL`** (wajib; API menolak jalan di
  produksi dengan `console`), `BACKUP_BEFORE_DEPLOY=1`.
- Perhatikan: kutip nilai yang berisi spasi atau `<>` (sudah dicontohkan di `MAIL_FROM`); karakter khusus di sandi SMTP di-URL-encode.

**B.4 nginx + HTTPS** — pakai `deploy/nginx/bandha.conf` sebagai dasar (sesuaikan port dengan `.env`):
```bash
sudo cp /srv/bandha/deploy/nginx/bandha.conf /etc/nginx/sites-available/bandha.conf
sudo ln -s /etc/nginx/sites-available/bandha.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d bandha.grezly.app -d bandha-dev.grezly.app
```
Header `X-Forwarded-For $remote_addr` di file itu **wajib** tetap menimpa (bukan menambah): batas percobaan login dan reset
kata sandi dihitung per alamat klien.

**B.5 Deploy pertama (manual, untuk memastikan semuanya hidup)**
```bash
sudo -u deploy /srv/bandha-dev/deploy/deploy.sh
sudo -u deploy /srv/bandha/deploy/deploy.sh
```
Build pertama sekitar 2–4 menit. Berhasil bila ada baris `healthy: <tag> is live`.

**B.6 Verifikasi**
```bash
docker compose --env-file /srv/bandha/deploy/.env -f /srv/bandha/deploy/compose.yml ps     # semua (healthy)
curl -sI https://bandha.grezly.app/login | head -3        # 200 + header X-Frame-Options, nosniff
curl -sI https://bandha-dev.grezly.app/login | head -3
ss -ltnp | grep -E ':(3000|3100|4000|4100|5432)\b'        # hanya 127.0.0.1; 5432 tidak muncul sama sekali
```
Lalu buka kedua alamat, daftar akun uji, tambah rekening dan satu transaksi.

**B.7 Backup terjadwal** (produksi dan, bila mau, development)
```bash
( sudo -u deploy crontab -l 2>/dev/null; echo '30 2 * * * cd /srv/bandha && ./deploy/backup.sh >> deploy/backups/backup.log 2>&1' ) | sudo -u deploy crontab -
```
Backup dan pemulihannya dijelaskan di bagian C.

**B.8 Uji CI/CD**: push perubahan kecil ke `development`, lihat tab Actions (CI → Deploy), lalu cek bandha-dev. Setelah itu
PR ke `main` untuk produksi.

---

## C. Database: cara mengaturnya

**Singkatnya: hampir tidak ada yang perlu Anda atur.** Setiap lingkungan punya database PostgreSQL sendiri di dalam
stack Docker-nya.

- **Dibuat otomatis** saat deploy pertama, dengan nama/user/sandi dari `deploy/.env`. Tidak ada langkah `CREATE DATABASE`
  atau instal Postgres manual.
- **Skema diatur otomatis.** Setiap deploy, layanan `migrate` menjalankan migrasi yang belum pernah dijalankan (urutan di
  `packages/db/migrations`), lalu menambah aset katalog yang belum ada (`seed`). Keduanya aman dijalankan berulang. Kalau
  migrasi gagal, API tidak dijalankan dan deploy berhenti dengan log yang jelas (versi lama tetap hidup).
- **Terpisah total.** `bandha-dev` dan `bandha-prod` punya volume, jaringan, dan sandi sendiri. Data uji di development
  tidak pernah menyentuh produksi.
- **Tidak terbuka ke luar.** Port 5432 tidak dipublikasikan. Untuk melihat isinya:
  ```bash
  cd /srv/bandha
  docker compose --env-file deploy/.env -f deploy/compose.yml exec db psql -U bandha -d bandha
  ```
- **Data tersimpan di volume Docker** (`<project>_pgdata`), jadi tetap ada saat container dibuat ulang/di-deploy. Jangan
  pernah memakai `docker compose down -v` di produksi (`-v` menghapus volume).

### Backup (wajib untuk produksi)
- `./deploy/backup.sh` membuat `deploy/backups/<project>-<waktu>.sql.gz` (izin 600), menyimpan 14 terbaru (`BACKUP_KEEP`).
- Berjalan otomatis sebelum setiap deploy bila `BACKUP_BEFORE_DEPLOY=1` (disarankan produksi) dan lewat cron tiap malam (B.7).
- **Salin backup ke luar VPS** (mis. `rclone`/`scp` ke penyimpanan lain atau snapshot VPS). Backup di mesin yang sama tidak
  menolong bila diskinya rusak.
- Uji pemulihan sesekali di development.

### Pulihkan
```bash
cd /srv/bandha && ./deploy/restore.sh deploy/backups/bandha-prod-20261116-023000.sql.gz
```
Meminta Anda mengetik nama project, **mengganti seluruh isi database**, membuat backup pengaman dulu, menghentikan API/web
selama pemulihan, lalu menyalakannya lagi dengan versi yang sama.

### Memindahkan data dari FinMap
Skrip migrasi ikut di image API. Jalankan dari server, dengan database FinMap yang bisa dijangkau dari container
(FinMap hanya dibaca). Selalu **dry-run dulu**:
```bash
cd /srv/bandha-dev          # coba di development dulu
C="docker compose --env-file deploy/.env -f deploy/compose.yml exec -e FINMAP_DATABASE_URL=postgres://user:sandi@host:5432/finmap api"
$C pnpm exec tsx src/migrate/finmap-cli.ts --list
$C pnpm exec tsx src/migrate/finmap-cli.ts --email orang@contoh.com            # dry-run: laporan saja
$C pnpm exec tsx src/migrate/finmap-cli.ts --email orang@contoh.com --apply    # menulis, hanya bila semua saldo cocok
```
Bila database FinMap ada di container lain di VPS yang sama, sambungkan dulu jaringannya:
`docker network connect <jaringan-finmap> bandha-dev-api-1` dan pakai nama container FinMap sebagai host.
Detail pilihan (`--gold-unit`, `--skip-failed`, `--allow-mismatch`) ada di [MIGRASI-FINMAP.md](MIGRASI-FINMAP.md).

### Bila nanti ingin memakai server PostgreSQL yang sudah ada di VPS
Bisa, tapi itu perubahan di `deploy/compose.yml` (hapus layanan `db`, isi `DATABASE_URL` langsung). Setiap lingkungan harus
tetap database dan user **berbeda** (`bandha_dev`, `bandha_prod`), mis.
`CREATE ROLE bandha_prod LOGIN PASSWORD '…'; CREATE DATABASE bandha_prod OWNER bandha_prod;`. Pendekatan bawaan (Postgres
per lingkungan di Docker) lebih sederhana dan lebih terisolasi, jadi itu yang disarankan.

---

## D. Operasional harian

| Perlu                       | Perintah (di folder lingkungan, sebagai user `deploy`)                                   |
|-----------------------------|------------------------------------------------------------------------------------------|
| Deploy manual               | `./deploy/deploy.sh`                                                                     |
| Lihat status                | `docker compose --env-file deploy/.env -f deploy/compose.yml ps`                         |
| Lihat log                   | `docker compose --env-file deploy/.env -f deploy/compose.yml logs -f --tail 100 api web` |
| Kembali ke versi sebelumnya | `git log --oneline` lalu `TAG=<12 karakter> docker compose --env-file deploy/.env -f deploy/compose.yml up -d --no-build --wait` (image lama masih ada) |
| Ganti rahasia / pengaturan  | edit `deploy/.env` lalu `./deploy/deploy.sh` (mengganti `JWT_SECRET` membuat semua orang keluar) |
| Bersihkan image lama        | `docker image prune -f` (deploy sudah membersihkan yang lebih tua dari 7 hari)           |

## E. Checklist keamanan
- [ ] `deploy/.env` izin 600, tidak ada di git, rahasia berbeda di development dan produksi.
- [ ] `ss -ltnp` menunjukkan 3000/3100/4000/4100 hanya di `127.0.0.1`, dan 5432 tidak ada.
- [ ] HTTPS aktif di kedua alamat (HSTS di produksi); development diberi `X-Robots-Tag: noindex`.
- [ ] Produksi memakai `MAIL_TRANSPORT=smtp`; backup tersalin keluar VPS.
- [ ] Firewall hanya membuka 22 (sebaiknya dibatasi), 80, 443.
- [ ] Production environment di GitHub memakai Required reviewers.

## F. Aplikasi mobile (nanti)
Web tidak butuh API terbuka, tapi aplikasi Android/iOS bicara langsung ke API, jadi tiap lingkungan perlu alamat API yang bisa dijangkau HP:
`api-bandha-dev.grezly.app` (development, port 4100) dan `api-bandha.grezly.app` (produksi, port 4000). Langkahnya ada di komentar
`deploy/nginx/bandha-api.conf` (record DNS A, salin file, `nginx -t`, `certbot --nginx -d ...`, cek `/api/health`). Build rilis wajib HTTPS.

**APK Android** dibuat oleh workflow GitHub Actions **Build Android APK** (`.github/workflows/build-apk.yml`): jalankan dari tab Actions
(Run workflow) atau jalankan ulang run sebelumnya, lalu unduh artifact `bandha-apk`. Alamat API dimasukkan saat build, jadi isi variabel
repository `APK_API_URL` (Settings > Secrets and variables > Actions > Variables), misalnya `https://api-bandha-dev.grezly.app` untuk
development. Tanpa variabel itu build memakai `https://api-bandha.grezly.app`. APK ditandatangani dengan kunci debug (cukup untuk uji
coba; Play Store butuh keystore rilis). Ikon dan splash ada di `apps/mobile/assets/` (diatur di `app.json`).

## G. API untuk aplikasi mobile, dan membuat admin (langkah di VPS)
Sekali per lingkungan (contoh development; produksi sama dengan `api-bandha` dan `/srv/bandha`):
1. **DNS** (di penyedia domain): record A `api-bandha-dev.grezly.app` ke IP VPS yang sama dengan `bandha-dev.grezly.app`. Tunggu sampai
   `nslookup api-bandha-dev.grezly.app` menjawab IP itu.
2. **nginx** (port 80 saja; certbot menambah HTTPS sendiri). Pakai **hanya blok development** dari `deploy/nginx/bandha-api.conf`
   selama produksi belum disiapkan:
   ```bash
   sudo cp /srv/bandha-dev/deploy/nginx/bandha-api.conf /etc/nginx/sites-available/bandha-api.conf
   # hapus blok "api-bandha.grezly.app" (produksi) dari salinan itu bila DNS-nya belum dibuat
   sudo ln -s /etc/nginx/sites-available/bandha-api.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d api-bandha-dev.grezly.app
   ```
3. **Cek**: `curl -s https://api-bandha-dev.grezly.app/api/health` harus `{"status":"ok"}`; `ss -ltnp | grep -E ':(4100|5432)\b'` tetap hanya
   127.0.0.1 untuk 4100 dan 5432 tidak muncul. Port 80 dan 443 terbuka di firewall.
4. **GitHub**: variabel repository `APK_API_URL` = `https://api-bandha-dev.grezly.app`, lalu jalankan ulang workflow Build Android APK.
5. **Admin pertama**: daftar dulu lewat web (kode verifikasi ada di `docker compose ... logs api` bila `MAIL_TRANSPORT=console`), lalu:
   ```bash
   cd /srv/bandha-dev
   sudo -u deploy docker compose --env-file deploy/.env -f deploy/compose.yml run --rm migrate \n     pnpm --filter @bandha/db make-admin email@contoh.com        # tambah --revoke untuk mencabut
   ```
   Keluar lalu masuk lagi; menu Admin muncul. Migrasi `0010` sudah dijalankan otomatis oleh `deploy.sh`.

## H. Masalah umum
- **Deploy "did not become healthy"**: log 60 baris terakhir tercetak otomatis; versi lama dipulihkan. Penyebab paling sering:
  `deploy/.env` salah/kurang (compose berhenti dengan pesan variabel mana), atau migrasi gagal (lihat `logs migrate`).
- **`APP_ENV=production needs MAIL_TRANSPORT=smtp`**: sengaja; isi `SMTP_URL` atau, hanya untuk development, set `APP_ENV=development`.
- **Tidak bisa masuk setelah deploy (cookie)**: pastikan situs dibuka lewat **https** (cookie sesi bertanda Secure) dan nginx
  meneruskan `X-Forwarded-Proto`.
- **Terlalu banyak percobaan (429) untuk semua orang**: header `X-Forwarded-For` tidak ditimpa nginx (lihat B.4).
- **Disk penuh**: `docker system df`, `docker image prune -a` (hati-hati), dan hapus backup lama.

## Yang sudah diuji (di mesin pengembangan, dengan Docker sungguhan)
Build kedua image dari repo bersih; `deploy.sh` dari nol sampai semua layanan sehat; daftar dan masuk lewat web; cookie
`HttpOnly` + `Secure`; 55 aset katalog ter-seed oleh migrasi; alat migrasi FinMap berjalan di dalam container; backup, lalu
pemulihan (data setelah backup hilang, data sebelumnya utuh, login tetap jalan); dan **rollback otomatis** (rilis yang sengaja
dirusak gagal sehat, versi sebelumnya dipulihkan, situs tetap menjawab, `deploy.sh` keluar kode 1). Yang **belum** bisa diuji
dari sini: SSH GitHub Actions ke VPS Anda, nginx/certbot, SMTP sungguhan, dan DNS. Itu bagian B.
