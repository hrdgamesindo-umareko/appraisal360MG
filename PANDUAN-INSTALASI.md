# 📋 PANDUAN INSTALASI — Appraisal360
**Backend:** Google Apps Script (REST API) · **Frontend:** GitHub Pages

Data Anda (Google Sheets) **tidak berpindah**. Yang pindah hanya tampilannya: dari dalam Apps Script ke GitHub Pages.

Urutannya: **A. Backend → B. Isi alamat backend di frontend → C. Upload ke GitHub → D. Uji.**

---

## A. BACKEND (Google Apps Script) — sekitar 10 menit

> ⚠️ Pakai proyek Apps Script yang **sama** dengan yang sekarang. Jangan buat proyek baru, karena data dan pengaturan Anda melekat pada proyek ini.

1. Buka https://script.google.com → buka proyek Appraisal360 Anda.
2. **Backup dulu:** menu **Overview** (ikon ℹ️ di kiri) → **Make a copy**.
3. Buka file **Kode.gs** → **Ctrl+A** (pilih semua) → hapus → tempel seluruh isi `Kode.gs` yang baru → **Ctrl+S**.
4. Hapus file HTML lama yang sudah tidak dipakai: **Index, Landing, Stylesheet, JavaScript** (klik ⋮ di samping nama file → **Delete**).
5. **Deploy → Manage deployments** → klik ✏️ (Edit) pada deployment yang ada:
   - **Version:** pilih **New version**
   - **Execute as:** **Me**
   - **Who has access:** **Anyone**  ← wajib *Anyone*, bukan "Anyone with Google account"
   - Klik **Deploy**. Salin **Web app URL** (berakhiran `/exec`). Alamatnya sama seperti sebelumnya.
6. **Tes backend:** tempel URL tadi di browser, tambahkan `?action=ping` di belakangnya:
   `https://script.google.com/macros/s/XXXX/exec?action=ping`
   Hasil benar: tulisan JSON yang memuat `"success":true`.

> 🚫 **JANGAN jalankan `setupAppEnvironment()`** lagi. Fungsi itu hanya untuk instalasi pertama, data Anda sudah ada.

---

## B. FRONTEND — isi alamat backend

1. Ekstrak **appraisal360-frontend.zip**. Hasilnya folder **`appraisal360-frontend`**.
2. Buka folder itu. **Anda harus langsung melihat `index.html`, `app.html`, folder `css` dan `js`.** Jika yang terlihat hanya satu folder lagi di dalamnya, masuk satu level ke dalam sampai `index.html` terlihat.
3. Buka **`js/config.js`** dengan Notepad. Ganti `GANTI_DENGAN_URL_EXEC_ANDA` dengan URL `/exec` dari langkah A5:
   ```js
   const GAS_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
   ```
   Simpan.
4. **Tes lokal (opsional):** klik dua kali `index.html`. Nama aplikasi di landing akan terambil dari server, lalu coba tombol **Masuk**.

---

## C. UPLOAD KE GITHUB PAGES

> 📁 **Folder kerja Anda = folder `appraisal360-frontend` hasil ekstrak (yang berisi `index.html` langsung).** Semua perintah Git di bawah dijalankan **di dalam folder itu**, bukan di folder induknya.

**C1. Install Git** (sekali saja). Windows: https://git-scm.com/download/win (pengaturan default). Cek: `git --version`

**C2. Akun GitHub:** daftar di https://github.com. Username Anda menjadi bagian alamat situs (`username.github.io`).

**C3. Identitas Git** (sekali saja):
```bash
git config --global user.name "Nama Anda"
git config --global user.email "email-akun-github@contoh.com"
```

**C4. Buat repository:** di github.com klik **+ → New repository** → nama misalnya `appraisal360` → pilih **Public** → **jangan** centang README/.gitignore/license → **Create repository**.

**C5. Buka terminal di folder kerja.** Windows: buka folder `appraisal360-frontend` di File Explorer → klik address bar → ketik `powershell` → Enter. Lalu cek isinya:
```powershell
dir
```
Harus tampak `index.html`, `app.html`, `css`, `js`. Jika tidak, Anda di folder yang salah.

**C6. Push pertama** (satu per satu):
```bash
git init
git add .
git commit -m "Upload pertama"
git branch -M main
git remote add origin https://github.com/USERNAME/appraisal360.git
git push -u origin main
```
(`git add .` memakai **titik** di akhir.) Saat diminta **Password**, tempel **Personal Access Token**, bukan password akun. Layar terlihat kosong saat paste: itu normal.

**Membuat token:** https://github.com/settings/tokens → **Generate new token (classic)** → centang **repo** → Generate → salin `ghp_...` (hanya tampil sekali).

**C7. Aktifkan Pages:** repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch **main** · **/ (root)** → **Save**. Tunggu 1–2 menit, lalu muncul alamat `https://USERNAME.github.io/appraisal360/`.

---

## D. SETELAH SITUS ONLINE

1. **Atur tautan di email pengingat:** buka Kode.gs di Apps Script → cari fungsi `aturUrlFrontend` → ganti `URL_FRONTEND` dengan alamat situs Anda → **Save** → pilih fungsi `aturUrlFrontend` → **▶ Run**. (Tanpa ini, email pengingat memuat alamat lama.)
2. **Uji:**
   - [ ] Landing tampil, nama aplikasi terambil dari server
   - [ ] Tombol **Masuk** → login admin berhasil
   - [ ] Semua menu admin terbuka (Dashboard, Master Karyawan, Periode, Formulir, Assign, Laporan, Audit, Pengaturan)
   - [ ] Login staf → Portal Penilaian terbuka
   - [ ] Tombol **Keluar** langsung kembali ke layar login (tanpa reload manual)
   - [ ] Buka F12 → tab **Console**: tidak ada error merah

## E. UPDATE DI KEMUDIAN HARI

- **Ubah frontend:** di folder kerja jalankan `git add .` → `git commit -m "deskripsi"` → `git push`. Tunggu 1–2 menit, lalu **Ctrl+Shift+R**.
- **Ubah backend (Kode.gs):** tempel → Save → **Deploy → Manage deployments → ✏️ → New version → Deploy**. Tanpa *New version*, perubahan tidak berlaku.

---

## 🛠️ Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| Pesan "GAS_URL belum diisi" | `js/config.js` belum diisi → isi, lalu `git add . && git commit && git push` |
| "Server tidak mengembalikan JSON" | Akses deployment belum **Anyone**, atau belum **New version**. Ulangi A5 |
| "Tidak dapat terhubung ke server" / error CORS di Console | URL salah (harus berakhiran `/exec`) atau akses belum **Anyone**. Tes `?action=ping` di browser |
| Situs 404 di github.io | `index.html` tidak ada di root repo. Cek halaman repo di github.com |
| Tampilan polos / tanpa gaya | Folder `css/` & `js/` terupload rata di root. Pastikan strukturnya utuh |
| Perubahan tidak tampil | **Ctrl+Shift+R** atau jendela Incognito |
| "Terlalu banyak percobaan gagal" | Kunci keamanan login (5 salah). Tunggu 15 menit |
| Login pertama terasa lambat | Normal: Apps Script "bangun" 3–6 detik jika lama tidak dipakai |
| `Password authentication is not supported` | Gunakan Personal Access Token (lihat C6) |

## 🔒 Catatan keamanan

- Repo **publik** itu aman: berisi kode tampilan saja, **tanpa rahasia**. Alamat `GAS_URL` memang bersifat publik. Perlindungan data ada di backend (token sesi + peran).
- Backend hanya menerima **38 aksi** yang terdaftar (whitelist). Fungsi lain (setup, pembersihan data) tidak bisa dipanggil dari luar.
- Disarankan: gunakan PIN lebih panjang (6+ digit) dan jangan bagikan URL `/exec` + PIN sembarangan.
