/* Appraisal360 — klien REST API untuk Google Apps Script (pengganti google.script.run) */
const API = (function () {
  const TIMEOUT_MS = 90000;
  function configured() { return typeof GAS_URL === 'string' && /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(GAS_URL); }

  /** POST { action, args } → objek respons { success, data, message }. Melempar Error bila jaringan/server bermasalah. */
  async function call(action, args) {
    if (!configured()) throw new Error('GAS_URL belum diisi. Buka js/config.js lalu isi dengan URL /exec dari Apps Script.');
    const tries = /^get/.test(action) ? 2 : 1; // bacaan aman diulang sekali bila gagal jaringan
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(GAS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // WAJIB text/plain: JSON memicu preflight CORS yang ditolak GAS
          body: JSON.stringify({ action: action, args: args || [] }),
          signal: ctl.signal, redirect: 'follow'
        });
        clearTimeout(timer);
        const text = await res.text();
        try { return JSON.parse(text); }
        catch (e) { throw new Error('Server tidak mengembalikan JSON. Pastikan deployment Web App: Execute as "Me", akses "Anyone", dan sudah di-deploy sebagai versi baru.'); }
      } catch (e) {
        clearTimeout(timer);
        lastErr = e.name === 'AbortError' ? new Error('Server terlalu lama merespons. Coba lagi.')
          : (e instanceof TypeError ? new Error('Tidak dapat terhubung ke server. Periksa koneksi internet dan nilai GAS_URL di js/config.js.') : e);
        if (i + 1 < tries) await new Promise(r => setTimeout(r, 600));
      }
    }
    throw lastErr;
  }
  return { call: call, configured: configured };
})();
