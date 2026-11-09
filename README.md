# Appraisal360 — Frontend (GitHub Pages)

Aplikasi penilaian kinerja 360° (frontend statis). Backend: Google Apps Script sebagai REST API.

```
index.html        ← landing page (halaman depan)
app.html          ← aplikasi (login, dashboard, dsb.)
css/              ← app.css, landing.css
js/
  config.js       ← ⚠️ isi GAS_URL di sini sebelum di-push
  api.js          ← klien REST API (fetch ke Apps Script)
  app.js          ← logika aplikasi
  landing.js      ← logika landing + globe 3D
  boot.js         ← pengaman awal (tema, storage, fallback)
PANDUAN-INSTALASI.md
```

Cara pasang lengkap: lihat **PANDUAN-INSTALASI.md**.
