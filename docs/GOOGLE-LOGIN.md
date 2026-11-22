# Masuk dan daftar dengan Google

Tombol **Lanjutkan dengan Google** ada di halaman Masuk dan Daftar (web) dan di layar Masuk/Daftar (mobile). Satu tombol untuk keduanya: orang baru otomatis dibuatkan akun, orang lama langsung masuk. Fitur ini **mati sampai `GOOGLE_CLIENT_ID` diisi**; tanpa itu tombolnya tidak muncul dan `/api/auth/google` menjawab 404.

## Cara kerjanya

1. Aplikasi meminta Google sebuah **ID token** (web: tombol Google Identity Services; mobile: layar akun Google).
2. Aplikasi mengirim token itu ke `POST /api/auth/google`.
3. API **memverifikasi sendiri** token itu: tanda tangan (kunci publik Google), penerbit, masa berlaku, dan bahwa token diterbitkan untuk **Client ID kita** (`aud`). Token untuk aplikasi lain ditolak. Email Google juga harus berstatus terverifikasi.
4. Lalu salah satu dari tiga hal terjadi:

| Keadaan | Hasil |
| --- | --- |
| ID Google ini sudah pernah masuk | Masuk ke akun itu. |
| Emailnya sudah punya akun (kata sandi) | Google **ditautkan** ke akun itu lalu masuk. Kata sandi lamanya tetap berlaku. |
| Belum ada akun | Dibuat akun baru yang langsung terverifikasi (tanpa kode email), lengkap dengan buku besarnya. Web membuka halaman *Selamat datang*. |

Aturan keamanan:

- Orang dikenali lewat **ID Google (`sub`)**, bukan email, setelah tertaut. Mengubah email di akun Google tidak membuat akunnya hilang.
- Akun yang **belum pernah konfirmasi email** (daftar kata sandi, kode belum dimasukkan) lalu diambil alih lewat Google: kata sandi yang tadi didaftarkan **dibuang** dan kode lamanya hangus, karena yang mengetiknya belum terbukti pemilik email, sedangkan Google membuktikannya. Jadi orang tidak bisa "menitip" kata sandi di email orang lain.
- Email yang sudah tertaut ke satu akun Google tidak akan digabung dengan akun Google lain (409 `google_conflict`).
- Akun yang dinonaktifkan admin tetap ditolak (403).
- Akun yang hanya pernah masuk lewat Google **tidak punya kata sandi**. Kalau nanti ingin masuk dengan email + kata sandi, pakai **Lupa kata sandi** untuk membuatnya.
- Endpoint dibatasi laju seperti login (20 permintaan per menit per IP).

## 1. Membuat Client ID di Google Cloud (sekali saja)

Ini harus dikerjakan di akun Google Anda; tidak bisa diotomatisasi.

1. Buka <https://console.cloud.google.com/>, buat project (mis. "Bandha").
2. **APIs & Services → OAuth consent screen**: isi nama aplikasi, email dukungan, dan domain. Biarkan **Testing** selagi mencoba (tambahkan email Anda di *Test users*), pilih **In production** saat siap dipakai umum. Scope yang dipakai hanya `openid`, `email`, `profile` (tidak perlu verifikasi khusus Google).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:

   **a. Web application** (wajib; ini yang dipakai API dan web)
   - *Authorized JavaScript origins*: `https://bandha.grezly.app`, `https://bandha-dev.grezly.app`, dan untuk uji lokal `http://localhost:3000`. Tanpa garis miring di akhir.
   - *Authorized redirect URIs*: dikosongkan (tombol memakai mode popup).
   - Catat **Client ID**-nya (`1234-abc.apps.googleusercontent.com`).

   **b. Android** (hanya bila memakai aplikasi mobile)
   - *Package name*: `app.grezly.bandha`
   - *SHA-1*: sidik jari kunci penanda APK. APK dari workflow GitHub ditandatangani dengan kunci debug bawaan template Expo. Sidik jarinya pada template yang terkunci di repo ini:

     ```
     FE:6F:C7:06:7A:C9:6C:47:E8:28:A1:49:A4:DC:38:ED:58:34:39:5B
     ```

     Nilai itu dihitung dari `debug.keystore` yang dihasilkan `expo prebuild`; **cek ulang** bila Expo SDK dinaikkan (template bisa berganti): jalankan prebuild lalu
     `keytool -list -v -keystore apps/mobile/android/app/debug.keystore -alias androiddebugkey -storepass android`.
     Untuk rilis Play Store, pakai SHA-1 kunci rilis Anda (dan SHA-1 *App signing* dari Play Console).
   - Client Android **tidak** disalin ke mana pun di kode; ia hanya perlu ada di project yang sama agar Google mengizinkan aplikasi dengan paket + kunci itu.

   **c. iOS** (hanya bila nanti merilis iOS): buat client iOS dengan bundle ID `app.grezly.bandha`, lalu tambahkan plugin `["@react-native-google-signin/google-signin", { "iosUrlScheme": "com.googleusercontent.apps.<ID client iOS>" }]` ke `apps/mobile/app.json`. Android tidak memerlukan plugin itu.

## 2. Mengisi pengaturan

Satu nilai dipakai di mana-mana: **Client ID dari langkah 3a (Web application)**.

| Di mana | Variabel | Catatan |
| --- | --- | --- |
| API dan web (dev lokal) | `GOOGLE_CLIENT_ID` di `.env` | API memeriksa token terhadapnya, web memakainya untuk menggambar tombol. Boleh beberapa, dipisah koma; **yang pertama dipakai tombol web**. |
| API dan web (server) | `GOOGLE_CLIENT_ID` di `deploy/.env` | Sudah diteruskan `deploy/compose.yml` ke API dan web. Dibaca saat dijalankan, jadi cukup restart (`up -d`), tidak perlu build ulang. |
| Mobile | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Nilai yang sama. **Tertanam saat build.** Untuk APK GitHub: *Settings → Secrets and variables → Actions → Variables → `GOOGLE_WEB_CLIENT_ID`*. Kosong = tombol tidak muncul di aplikasi. |

Setelah mengisi `deploy/.env` di server:

```bash
docker compose --env-file deploy/.env -f deploy/compose.yml up -d
```

Migrasi database (`0011_google_login`: kolom `users.google_sub`) berjalan otomatis lewat layanan `migrate` pada deploy berikutnya.

## 3. Mencoba

- **Web**: buka `/login`, tombol Google muncul di atas formulir. Pilih akun; Anda masuk ke dashboard (akun baru: halaman *Selamat datang*). Bahasa tulisan tombol mengikuti bahasa browser, bukan pilihan ID/EN di halaman (diatur Google).
- **Mobile**: hanya ada di build asli (APK atau dev build). **Expo Go dan pratinjau browser tidak mendukung** (butuh modul native), di sana tombolnya otomatis tersembunyi.

## Masalah umum

| Gejala | Penyebab / solusi |
| --- | --- |
| Tombol tidak muncul di web | `GOOGLE_CLIENT_ID` belum diisi di web, atau server belum direstart. Atau browser memblokir `accounts.google.com`. |
| Popup Google: *Error 400: origin_mismatch* | Alamat web belum ada di **Authorized JavaScript origins** (cek `http` vs `https`, port, dan tanpa `/` di akhir). Perubahan butuh beberapa menit. |
| *Access blocked: app has not completed verification* | Consent screen masih **Testing** dan email Anda belum ada di *Test users*. |
| Mobile: `DEVELOPER_ERROR` / kode 10 | Client **Android** belum dibuat, package atau **SHA-1** tidak cocok dengan kunci penanda APK. |
| Mobile: tombol tidak muncul | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` kosong saat build, atau dijalankan di Expo Go/browser. |
| API menjawab 401 `google_invalid` | Token bukan untuk Client ID ini (mis. `GOOGLE_CLIENT_ID` di API berbeda dari yang dipakai web/mobile), atau jam server melenceng jauh. |
| API menjawab 404 `google_disabled` | `GOOGLE_CLIENT_ID` kosong di API. |
