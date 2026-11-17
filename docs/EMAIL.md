# Email: kode verifikasi, atur ulang kata sandi, dan SMTP Microsoft 365

Bandha mengirim dua jenis email:

| Email | Kapan | Isi |
| --- | --- | --- |
| **Kode verifikasi** | saat mendaftar | kode 6 angka, berlaku 10 menit |
| **Atur ulang kata sandi** | "Lupa kata sandi" | tautan sekali pakai, berlaku 30 menit |

Keduanya dwibahasa (Indonesia di atas, English di bawah) dan dikirim lewat SMTP.

## Cara kerja pendaftaran dengan kode

1. Pengguna mengisi nama, email, dan kata sandi. Akun dibuat **belum terverifikasi** dan belum masuk (tanpa sesi).
2. Kode 6 angka dikirim ke email itu. Di aplikasi pengguna memasukkan kode; bila benar, akun terverifikasi dan langsung masuk.
3. Aturan keamanan:
   - kode berlaku **10 menit** dan disimpan hanya sebagai hash;
   - **5 tebakan salah** menghanguskan kode (minta kode baru);
   - kirim ulang: maksimal **1 email per menit** dan **5 per jam** per alamat; kode baru menggantikan yang lama;
   - mendaftar lagi dengan email yang belum terverifikasi hanya mengganti nama dan kata sandi yang tertunda, jadi orang tidak bisa "mengunci" email orang lain;
   - login dengan akun yang belum terverifikasi ditolak (403) dan otomatis mengirim kode baru;
   - tautan "Lupa kata sandi" yang dipakai juga membuktikan email, sehingga akun jadi terverifikasi;
   - akun yang sudah ada sebelum fitur ini ditandai terverifikasi oleh migrasi (tidak ada yang terkunci).
4. Saklar darurat: `REQUIRE_EMAIL_OTP=false` mengembalikan pendaftaran satu langkah (langsung masuk, akun langsung terverifikasi). Pakai hanya bila email sedang tidak bisa terkirim, lalu nyalakan lagi.

## Menyiapkan SMTP Microsoft 365

1. **Kotak surat pengirim.** Buat (atau pakai) satu kotak surat berlisensi di Exchange Online, mis. `no-reply@domainkamu.com`. Kotak surat bersama (shared mailbox) tidak bisa dipakai untuk masuk ke SMTP; pakai pengguna berlisensi, atau beri pengguna itu izin *Send As* untuk alamat lain.
2. **Aktifkan Authenticated SMTP** untuk kotak surat itu: Microsoft 365 admin center > Users > Active users > pilih pengguna > **Mail** > *Manage email apps* > centang **Authenticated SMTP** > Save. Bila perlu, di tingkat organisasi: `Set-TransportConfig -SmtpClientAuthenticationDisabled $false` (Exchange Online PowerShell).
3. **Kata sandi.** SMTP AUTH dasar memakai kata sandi akun itu. Bila akun memakai MFA, buat *app password* (hanya tersedia bila MFA lama diizinkan); *Security defaults* atau Conditional Access dapat memblokir masuk dengan kata sandi.
4. **Isi `deploy/.env`** di server (satu per lingkungan):

   ```bash
   MAIL_TRANSPORT=smtp
   SMTP_URL=smtp://no-reply%40domainkamu.com:KATA_SANDI@smtp.office365.com:587/?requireTLS=true
   MAIL_FROM="Bandha <no-reply@domainkamu.com>"
   ```

   - `@` di nama pengguna ditulis `%40`. Karakter khusus di kata sandi harus di-URL-encode: `!` `%21`, `#` `%23`, `$` `%24`, `&` `%26`, `:` `%3A`, `/` `%2F`, `?` `%3F`, `@` `%40`.
   - `MAIL_FROM` harus alamat kotak surat itu (atau alias yang boleh *Send As*), kalau tidak Microsoft menolak dengan `553 5.7.1`.
5. **Uji tanpa mendaftar siapa pun:**

   ```bash
   # lokal (membaca .env di root repo)
   pnpm --filter @bandha/api mail:test emailkamu@gmail.com

   # di server, dari folder repo
   docker compose --env-file deploy/.env -f deploy/compose.yml exec api pnpm --filter @bandha/api exec tsx src/mail-test.ts emailkamu@gmail.com
   ```

   Skrip memeriksa login SMTP, lalu mengirim email uji. Kalau gagal, ia hanya mencetak kode galat dan balasan server (tidak pernah URL-nya, karena berisi kata sandi).
6. **Deploy ulang** (`./deploy/deploy.sh` atau push), lalu coba daftar dengan email asli.

### Kalau Microsoft menolak (`535 5.7.139` atau `5.7.3`)

Microsoft sedang menutup *basic authentication* untuk SMTP AUTH di Exchange Online, dan banyak tenant sudah menolaknya. Periksa Message center tenant kamu. Bila ditolak, pilihannya:

- tetap di Microsoft 365 tetapi lewat **OAuth2 / Microsoft Graph** (butuh pendaftaran aplikasi di Entra ID; kode pengirim Bandha perlu ditambah, bilang saja), atau
- pakai layanan email transaksional dengan SMTP biasa (Resend, Brevo, SendGrid, Mailgun) dengan `SMTP_URL` yang berbeda; tidak ada kode yang berubah.

## Agar email tidak masuk spam

Atur DNS domain pengirim: **SPF** (`v=spf1 include:spf.protection.outlook.com -all`), **DKIM** (aktifkan di Microsoft Defender > Email authentication; dua rekaman CNAME `selector1/selector2._domainkey`), dan **DMARC** (`_dmarc` TXT, mulai dengan `p=none`). Batas Exchange Online: ±30 email per menit dan 10.000 penerima per hari per kotak surat, jauh di atas kebutuhan kode verifikasi.
