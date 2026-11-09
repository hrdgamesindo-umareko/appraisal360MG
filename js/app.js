/* Appraisal360 — logika aplikasi (SPA). Backend: GAS REST API via js/api.js */
/**
 * ============================================================
 * APPRAISAL360 — Frontend JavaScript (SPA)
 * Prinsip gas-instant-ux diterapkan: client-side SPA, cache lokal,
 * optimistic UI untuk autosave draft, batch server call.
 * ============================================================
 */

// ════════════════════════════════════════════════════════════
// STATE GLOBAL
// ════════════════════════════════════════════════════════════
const appState = {
  token: null,
  user: null,
  config: {},
  periodeList: [],
  periodeAktifId: null,
  karyawanCache: null,
  currentMappingId: null,
  currentFormData: null,
  pendingResponses: {}, // ID_Parameter -> {Skor, Catatan}
  pendingNarasi: {},    // k1..k3 (kelebihan), p1..p3 (perbaikan)
  cache: {},            // key -> {res, t} : data terakhir per layar (tampil instan, divalidasi ulang di latar)
  swrLast: {},
  bootReady: false,
  watchdog: null
};
let chartInstances = {};
let draftSaveTimer = null;

document.addEventListener('DOMContentLoaded', initApp);

// ════════════════════════════════════════════════════════════
// INFRASTRUKTUR KECEPATAN: pembungkus panggilan server, indikator, cache SWR
// ════════════════════════════════════════════════════════════
const MUTATING_RE = /^(upsert|delete|assign|bulk|setPeriode|runAuto|runGenerate|saveSettings|saveParameter|submitForm|reset|sinkron|bersih|perbaiki|aktifkan|migrasi)/;
const SILENT_RE = /^(saveDraft|autoSinkron|getStatus)/;
let _pending = 0;
function progressStart() { _pending++; const el = document.getElementById('topProgress'); if (el) el.classList.add('on'); }
function progressEnd() { _pending = Math.max(0, _pending - 1); if (!_pending) { const el = document.getElementById('topProgress'); if (el) el.classList.remove('on'); } }
function clearClientCache() { appState.cache = {}; }
function putCache(key, data) { appState.cache[key] = { res: { success: true, data: data }, t: Date.now() }; }

/** Pembungkus panggilan server (fetch ke GAS REST API): indikator loading + membuang cache setelah operasi yang mengubah data */
function GSR(quiet) {
  let ok = null, fail = null;
  const p = new Proxy({}, { get(_, name) {
    if (name === 'withSuccessHandler') return f => { ok = f; return p; };
    if (name === 'withFailureHandler') return f => { fail = f; return p; };
    return function () {
      const args = Array.prototype.slice.call(arguments);
      const show = !quiet && !SILENT_RE.test(String(name));
      if (show) progressStart();
      // fetch ke GAS REST API (js/api.js). then(a, b): error di dalam handler sukses tidak salah masuk handler gagal
      API.call(String(name), args).then(
        res => { if (show) progressEnd(); if (MUTATING_RE.test(String(name)) && res && res.success) clearClientCache(); if (ok) ok(res); },
        err => { if (show) progressEnd(); if (fail) fail(err); });
    };
  } });
  return p;
}

/**
 * Stale-while-revalidate: bila ada data lama untuk `key`, tampilkan SEKETIKA lalu ambil data terbaru di latar
 * dan render ulang hanya bila berbeda. Pindah menu terasa instan setelah kunjungan/prefetch pertama.
 */
function fetchSWR(key, fnName, args, onData, onError) {
  const c = appState.cache[key];
  appState.swrLast[fnName] = key;
  if (c) { onData(c.res, true); if (Date.now() - c.t < 4000) return; } // baru saja diambil: tidak perlu ulang
  const fail = msg => { if (!c) (onError || (m => showToast('Error', m, 'danger')))(msg); };
  const g = GSR().withSuccessHandler(res => {
    if (appState.swrLast[fnName] !== key) return;               // pengguna sudah pindah layar/periode
    if (!res || !res.success) { fail(res ? res.message : 'Server tidak mengirim respons.'); return; }
    const same = c && JSON.stringify(c.res.data) === JSON.stringify(res.data);
    appState.cache[key] = { res: res, t: Date.now() };
    if (!same) onData(res, false);
  }).withFailureHandler(err => fail(err && err.message ? err.message : 'Gagal menghubungi server.'));
  g[fnName].apply(g, args);
}
/** Isi cache di latar tanpa merender (dipakai setelah login agar klik pertama pun instan) */
function prefetchSWR(key, fnName, args) {
  if (!appState.token || appState.cache[key]) return;
  const g = GSR(true).withSuccessHandler(res => { if (res && res.success && !appState.cache[key]) appState.cache[key] = { res: res, t: Date.now() }; }).withFailureHandler(() => {});
  g[fnName].apply(g, args);
}
function prefetchAll() {
  const t = appState.token, pid = appState.periodeAktifId, steps = [];
  if (!appState.user) return;
  if (appState.user.role === 'ADMIN') {
    steps.push(() => prefetchSWR('karyawan', 'getAllKaryawan', [t]));
    steps.push(() => prefetchSWR('periode', 'getAllPeriode', [t]));
    if (pid) {
      steps.push(() => prefetchSWR('mapping|' + pid, 'getMappingMatrix', [t, pid]));
      steps.push(() => prefetchSWR('laporan|' + pid, 'getLaporan', [t, pid, {}]));
    }
    steps.push(() => prefetchSWR('formulir', 'getFormTemplatePreview', [t]));
  }
  steps.forEach((f, n) => setTimeout(f, 500 + n * 350));
}
/** Sinkronisasi akun otomatis tiap admin membuka aplikasi (aman: akun yatim hanya dinonaktifkan) */
function runAutoSinkron() {
  if (!appState.token) return;
  GSR(true).withSuccessHandler(res => {
    if (!res || !res.success || !res.data || !res.data.berubah) return;
    clearClientCache();
    showToast('Akun disinkronkan otomatis', res.message, 'info');
    if (res.data.pins && res.data.pins.length) showCredentialsModal(res.data.pins);
  }).withFailureHandler(() => {}).autoSinkronAkun(appState.token);
}

function initApp() {
  const savedTheme = localStorage.getItem('theme') || document.documentElement.getAttribute('data-theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  const dmToggle = document.getElementById('darkModeToggle');
  if (dmToggle) dmToggle.checked = savedTheme === 'dark';

  // jaring pengaman: bila tak ada respons dalam 9 detik, tawarkan "Muat Ulang" (bukan layar putih selamanya)
  appState.watchdog = setTimeout(() => {
    const st = document.getElementById('loadingStuck'), ov = document.getElementById('loadingOverlay');
    if (st && ov && ov.style.display !== 'none') st.style.display = 'block';
  }, 9000);

  const savedToken = localStorage.getItem('app360_token');
  if (savedToken) {
    GSR(true)
      .withSuccessHandler(res => {
        if (res && res.success && res.data && res.data.valid) {
          appState.token = savedToken;
          appState.user = res.data.user;
          appState.bootReady = applyBoot(res.data.boot);
          afterLoginSuccess();
        } else {
          localStorage.removeItem('app360_token');
          loadPublicConfig();
          showLoginScreen();
        }
      })
      .withFailureHandler(() => { loadPublicConfig(); showLoginScreen(); })
      .bootstrapApp(savedToken);
  } else {
    showLoginScreen();   // tampilkan form login seketika; branding menyusul
    loadPublicConfig();
  }
}

/** Terapkan data awal dari server (config, periode, dashboard/tugas) ke state & cache */
function applyBoot(boot) {
  if (!boot) return false;
  appState.config = boot.config || {};
  applyBranding(appState.config);
  appState.periodeList = boot.periodeList || [];
  appState.periodeAktifId = boot.periodeAktifId || null;
  const aktif = appState.periodeList.find(p => p.ID_Periode === appState.periodeAktifId);
  const badge = document.getElementById('periodeActiveBadge');
  if (badge) badge.textContent = aktif ? aktif.Nama_Periode : 'Belum ada periode';
  putCache('periode', appState.periodeList);
  if (appState.periodeAktifId && boot.dashboard) putCache('dashboard|' + appState.periodeAktifId, boot.dashboard);
  if (appState.periodeAktifId && boot.assignments) putCache('portal|' + appState.periodeAktifId, boot.assignments);
  return true;
}

function loadPublicConfig() {
  GSR(true)
    .withSuccessHandler(res => {
      if (res && res.success) {
        appState.config = Object.assign(appState.config || {}, res.data);
        applyBranding(res.data);
      }
    })
    .withFailureHandler(() => {})
    .getAllConfig(null);
}

function applyBranding(cfg) {
  if (cfg.companyName) document.getElementById('loginCompanyName').textContent = cfg.companyName;
  if (cfg.appName) { document.getElementById('appTitle').textContent = cfg.appName; document.title = cfg.appName; }
  const logo = cfg.logoUrl && /^data:image\/(png|jpeg|webp|gif);base64,/.test(cfg.logoUrl) ? cfg.logoUrl : '';
  [['loginLogo', 'loginLogoFallback'], ['appLogo', 'appLogoFallback']].forEach(pair => {
    const img = document.getElementById(pair[0]), fb = document.getElementById(pair[1]);
    if (!img || !fb) return;
    if (logo) {
      img.onerror = () => { img.style.display = 'none'; fb.style.display = ''; };
      img.src = logo; img.style.display = 'block'; fb.style.display = 'none';
    } else { img.style.display = 'none'; fb.style.display = ''; }
  });
  if (cfg.primaryColor && /^#[0-9a-fA-F]{6}$/.test(cfg.primaryColor)) document.documentElement.style.setProperty('--wf-primary', cfg.primaryColor);
}
/** Perkecil logo di browser menjadi data-URI kecil (<45 KB) agar tersimpan di sheet, tanpa Google Drive */
function resizeLogo(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { reject(new Error('Gunakan gambar PNG, JPG, WEBP, atau GIF.')); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const sizes = [256, 192, 144, 112, 80];
      for (let k = 0; k < sizes.length; k++) {
        const sc = Math.min(1, sizes[k] / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * sc)), h = Math.max(1, Math.round(img.height * sc));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        let out = cv.toDataURL('image/webp', 0.9);
        if (out.indexOf('data:image/webp') !== 0) out = cv.toDataURL('image/png');
        if (out.length <= 45000) { resolve(out); return; }
      }
      reject(new Error('Logo terlalu kompleks. Gunakan gambar yang lebih sederhana.'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gambar tidak dapat dibaca.')); };
    img.src = url;
  });
}

function showLoginScreen() {
  hideLoadingOverlay();
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
}

function hideLoadingOverlay() {
  clearTimeout(appState.watchdog);
  const ov = document.getElementById('loadingOverlay');
  if (ov) { ov.style.opacity = '0'; setTimeout(() => ov.style.display = 'none', 250); }
}

// ════════════════════════════════════════════════════════════
// LOGIN / LOGOUT
// ════════════════════════════════════════════════════════════
function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const pin = document.getElementById('loginPin').value.trim();
  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  document.getElementById('loginBtnText').textContent = 'Memverifikasi...';

  GSR()
    .withSuccessHandler(res => {
      btn.disabled = false;
      document.getElementById('loginBtnText').textContent = 'Masuk ke Sistem';
      if (res.success) {
        appState.token = res.data.token;
        const boot = res.data.boot;
        delete res.data.boot;
        appState.user = res.data;
        localStorage.setItem('app360_token', res.data.token);
        appState.bootReady = applyBoot(boot);
        afterLoginSuccess();
      } else {
        showToast('Login Gagal', res.message, 'danger');
      }
    })
    .withFailureHandler(err => {
      btn.disabled = false;
      document.getElementById('loginBtnText').textContent = 'Masuk ke Sistem';
      showToast('Error', err.message, 'danger');
    })
    .doLogin(email, pin);
}

function handleLogout() {
  const token = appState.token;
  // beritahu server (tanpa menunggu); sesi di sisi klien langsung dibersihkan
  if (token) { try { GSR(true).withSuccessHandler(() => {}).withFailureHandler(() => {}).doLogout(token); } catch (e) {} }
  resetSessionUi();
}

/** Muat ulang data aplikasi di tempat (pengganti location.reload yang bisa menghasilkan layar putih di iframe GAS). */
function refreshAppInPlace() {
  clearClientCache();
  GSR()
    .withSuccessHandler(res => {
      if (res && res.success && res.data && res.data.valid) {
        appState.user = res.data.user;
        appState.bootReady = applyBoot(res.data.boot);
      }
      const active = document.querySelector('.sidebar-nav .nav-link.active');
      navigateTo(active ? active.dataset.section : (appState.user && appState.user.role === 'ADMIN' ? 'dashboard' : 'portal'));
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .bootstrapApp(appState.token);
}

/**
 * Keluar TANPA location.reload(): di iframe sandbox Apps Script, memuat ulang halaman
 * sering menghasilkan layar putih. Semua state dibersihkan di tempat lalu layar login ditampilkan.
 */
function resetSessionUi() {
  try { localStorage.removeItem('app360_token'); localStorage.removeItem('draft_cache'); } catch (e) {}
  clearTimeout(draftSaveTimer);
  Object.keys(chartInstances).forEach(k => { try { chartInstances[k].destroy(); } catch (e) {} });
  chartInstances = {};

  appState.token = null; appState.user = null;
  appState.periodeList = []; appState.periodeAktifId = null;
  appState.karyawanCache = null; appState.mappingCache = null;
  appState.kFilter = null; appState.mFilter = null;
  appState.currentMappingId = null; appState.currentFormData = null;
  appState.pendingResponses = {}; appState.pendingNarasi = {};
  appState.cache = {}; appState.swrLast = {};
  appState.bootReady = false;
  try { EDIT = null; } catch (e) {}

  document.querySelectorAll('.content-section').forEach(s => { s.classList.remove('active'); s.innerHTML = ''; });
  document.querySelectorAll('.sidebar-nav .nav-link').forEach(l => l.classList.remove('active'));
  ['sidebarNavAdmin', 'sidebarNavStaff'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  const un = document.getElementById('sidebarUserName'); if (un) un.textContent = '—';
  const rt = document.getElementById('sidebarRoleTag'); if (rt) rt.textContent = '[ROLE: —]';
  const bd = document.getElementById('periodeActiveBadge'); if (bd) bd.textContent = '—';
  closeSidebar();

  const form = document.getElementById('loginForm'); if (form) form.reset();
  const btn = document.getElementById('loginBtn'); if (btn) btn.disabled = false;
  const bt = document.getElementById('loginBtnText'); if (bt) bt.textContent = 'Masuk ke Sistem';
  showLoginScreen();
  try { window.scrollTo(0, 0); } catch (e) {}
  showToast('Berhasil keluar', 'Anda telah keluar dari aplikasi.', 'success');
}

function afterLoginSuccess() {
  hideLoadingOverlay();
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  document.getElementById('sidebarUserName').textContent = appState.user.nama;
  document.getElementById('sidebarRoleTag').textContent = '[ROLE: ' + appState.user.role + ']';
  document.getElementById(appState.user.role === 'ADMIN' ? 'sidebarNavAdmin' : 'sidebarNavStaff').style.display = 'block';

  if (appState.bootReady) { finishLogin(); return; }
  // cadangan: login berhasil tetapi data awal tidak ikut terkirim
  GSR()
    .withSuccessHandler(res => {
      if (res && res.success && res.data && res.data.valid) appState.bootReady = applyBoot(res.data.boot);
      else showToast('Gagal memuat data awal', res ? res.message : 'Server tidak mengirim respons. Cek Executions di Apps Script.', 'danger');
      finishLogin();
    })
    .withFailureHandler(err => { showToast('Error', err.message, 'danger'); finishLogin(); })
    .bootstrapApp(appState.token);
}
function finishLogin() {
  // jadwalkan tugas latar lebih dulu: kegagalan render satu layar tidak boleh membatalkannya
  setTimeout(prefetchAll, 400);
  if (appState.user.role === 'ADMIN') setTimeout(runAutoSinkron, 1500);
  try { navigateTo(appState.user.role === 'ADMIN' ? 'dashboard' : 'portal'); }
  catch (e) { showToast('Peringatan', 'Sebagian tampilan gagal dimuat: ' + e.message, 'warning'); }
}

// ════════════════════════════════════════════════════════════
// NAVIGASI SPA
// ════════════════════════════════════════════════════════════
const SECTION_TITLES = {
  dashboard: 'Dashboard', karyawan: 'Master Karyawan', periode: 'Periode Penilaian',
  mapping: 'Assign Penilai & Mapping', laporan: 'Laporan & Analitik', audit: 'Audit Trail',
  settings: 'Pengaturan', portal: 'Portal Penilaian Saya', hasilSaya: 'Hasil & Feedback Saya',
  formPenilaian: 'Form Penilaian', formulir: 'Formulir Penilaian'
};

function navigateTo(sectionId, param) {
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('section-' + sectionId);
  if (target) target.classList.add('active');
  document.querySelectorAll('.sidebar-nav .nav-link').forEach(l => l.classList.toggle('active', l.dataset.section === sectionId));
  document.getElementById('pageTitle').textContent = SECTION_TITLES[sectionId] || sectionId;
  closeSidebar();

  const loaders = {
    dashboard: loadDashboard, karyawan: loadKaryawanSection, periode: loadPeriodeSection,
    mapping: loadMappingSection, laporan: loadLaporanSection, audit: loadAuditSection,
    settings: loadSettingsSection, portal: loadPortalSection, hasilSaya: loadHasilSayaSection,
    formulir: loadFormulirSection
  };
  if (loaders[sectionId]) loaders[sectionId](param);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('show');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('show');
  document.getElementById('sidebarOverlay').classList.remove('show');
}
function toggleDarkMode() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateChartsTheme(next);
}

// ════════════════════════════════════════════════════════════
// UI UTILITIES
// ════════════════════════════════════════════════════════════
function showToast(title, message, type) {
  const el = document.getElementById('appToast');
  document.getElementById('toastTitle').textContent = title;
  document.getElementById('toastBody').textContent = message;
  const colors = { success: '#166534', danger: '#BA1A1A', warning: '#854D0E', info: 'var(--wf-primary)' };
  el.style.borderLeft = `3px solid ${colors[type] || colors.info}`;
  new bootstrap.Toast(el, { delay: Math.min(15000, 3500 + String(message || '').length * 45) }).show();
}
function skeletonRows(n, cols) {
  let html = '';
  for (let i = 0; i < n; i++) {
    html += '<tr>' + Array(cols).fill('<td><div class="skel" style="height:14px;width:80%;"></div></td>').join('') + '</tr>';
  }
  return html;
}
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function openConfirm(title, body, onConfirm) {
  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalBody').textContent = body;
  const modalEl = document.getElementById('confirmModal');
  const modal = new bootstrap.Modal(modalEl);
  const btn = document.getElementById('confirmModalBtn');
  const clone = btn.cloneNode(true);
  btn.parentNode.replaceChild(clone, btn);
  clone.onclick = () => { onConfirm(); modal.hide(); };
  modal.show();
}
function periodeSelectorHtml(selId) {
  return `<select class="wf-input" style="max-width:280px" id="${selId}" onchange="onPeriodeSwitch(this.value)">
    ${appState.periodeList.map(p => `<option value="${p.ID_Periode}" ${p.ID_Periode === appState.periodeAktifId ? 'selected' : ''}>${escapeHtml(p.Nama_Periode)} [${p.Status}]</option>`).join('')}
  </select>`;
}
function onPeriodeSwitch(id) {
  appState.periodeAktifId = id;
  const activeNav = document.querySelector('.sidebar-nav .nav-link.active');
  if (activeNav) navigateTo(activeNav.dataset.section);
}

// ════════════════════════════════════════════════════════════
// DASHBOARD (ADMIN)
// ════════════════════════════════════════════════════════════
function loadDashboard() {
  const sec = document.getElementById('section-dashboard');
  if (!appState.periodeAktifId) { sec.innerHTML = emptyState('bi-calendar-x', 'Belum ada periode penilaian', 'Buat periode di menu Periode Penilaian, atau periksa kelengkapan data awal.')
    + `<div class="text-center mt-2"><button class="btn-primary-wf" onclick="navigateTo('formulir')"><i class="bi bi-ui-checks-grid"></i> Periksa Data & Formulir</button></div>`; return; }
  const key = 'dashboard|' + appState.periodeAktifId;
  if (!appState.cache[key]) sec.innerHTML = `<div class="row g-3"><div class="col-12"><div class="skel" style="height:120px;"></div></div></div>`;
  fetchSWR(key, 'getDashboardAdmin', [appState.token, appState.periodeAktifId], res => renderDashboard(res.data));
}

function emptyState(icon, title, sub) {
  return `<div class="empty-state"><i class="bi ${icon}"></i><div class="headline-md mb-1">${title}</div><p class="body-sm">${sub}</p></div>`;
}

function renderDashboard(d) {
  const sec = document.getElementById('section-dashboard');
  sec.innerHTML = `
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
      <span class="annotation">MODULE_REF: DASHBOARD // HR_ADMIN</span>
      ${periodeSelectorHtml('dashPeriodeSel')}
    </div>
    <div class="row g-3 mb-3">
      ${statCard('bi-people', d.totalKaryawan, 'Total Karyawan Aktif')}
      ${statCard('bi-clipboard-check', d.submitted + ' / ' + (d.submitted + d.pending + d.draft), 'Formulir Selesai')}
      ${statCard('bi-hourglass-split', d.pending, 'Menunggu Dinilai')}
      ${statCard('bi-percent', d.completionRate + '%', 'Tingkat Penyelesaian')}
    </div>
    <div class="row g-3">
      <div class="col-lg-8">
        <div class="wf-card mb-3">
          <div class="headline-md mb-3">Distribusi Interpretasi Skor</div>
          <canvas id="chartTier" height="130"></canvas>
        </div>
        <div class="wf-card">
          <div class="headline-md mb-3">Karyawan per Departemen</div>
          <canvas id="chartDept" height="130"></canvas>
        </div>
      </div>
      <div class="col-lg-4">
        <div class="insight-card">
          <h6><i class="bi bi-lightbulb"></i> ANALISIS SISTEM</h6>
          <ul>${d.insights.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
        </div>
        <div class="wf-card mt-3">
          <div class="headline-md mb-2">Aksi Cepat</div>
          <button class="btn-outline-wf w-100 mb-2" onclick="navigateTo('mapping')"><i class="bi bi-diagram-3"></i> Kelola Mapping Penilai</button>
          <button class="btn-outline-wf w-100 mb-2" onclick="navigateTo('laporan')"><i class="bi bi-bar-chart"></i> Lihat Laporan Lengkap</button>
          <button class="btn-primary-wf w-100" onclick="sendInvitationsNow()"><i class="bi bi-envelope"></i> Kirim Reminder Email</button>
        </div>
      </div>
    </div>
  `;
  renderTierChart(d.tierCounts);
  renderDeptChart(d.deptCounts);
}

function statCard(icon, value, label) {
  return `<div class="col-6 col-lg-3"><div class="stat-card">
    <i class="bi ${icon} stat-icon"></i>
    <div class="stat-value">${value}</div>
    <div class="stat-label">${label}</div>
  </div></div>`;
}

function chartSiap() { return typeof Chart !== 'undefined'; }
function renderTierChart(tierCounts) {
  const ctx = document.getElementById('chartTier'); if (!ctx || !chartSiap()) return;
  if (chartInstances.tier) chartInstances.tier.destroy();
  const labels = ['Excellent', 'Good', 'Average', 'Below Avg', 'Critical'];
  const values = [tierCounts.excellent, tierCounts.good, tierCounts.average, tierCounts.below, tierCounts.critical];
  chartInstances.tier = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: ['#166534', '#316BFE', '#854D0E', '#BC3E00', '#BA1A1A'], borderRadius: 4 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });
}
function renderDeptChart(deptCounts) {
  const ctx = document.getElementById('chartDept'); if (!ctx || !chartSiap()) return;
  if (chartInstances.dept) chartInstances.dept.destroy();
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  chartInstances.dept = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(deptCounts), datasets: [{ data: Object.values(deptCounts),
      backgroundColor: ['#316BFE', '#485B9A', '#BC3E00', '#166534', '#854D0E', '#6E8CFF'], borderWidth: 0 }]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: isDark ? '#F0F0FC' : '#191B24' } } } }
  });
}
function updateChartsTheme(theme) {
  Object.values(chartInstances).forEach(c => {
    if (c.options.plugins && c.options.plugins.legend && c.options.plugins.legend.labels) {
      c.options.plugins.legend.labels.color = theme === 'dark' ? '#F0F0FC' : '#191B24';
    }
    c.update();
  });
}
function sendInvitationsNow() {
  openConfirm('Kirim Email Pengingat', 'Kirim email pengingat/undangan penilaian ke semua penilai yang belum submit?', () => {
    GSR()
      .withSuccessHandler(res => showToast(res.success ? 'Terkirim' : 'Gagal', res.message, res.success ? 'success' : 'danger'))
      .withFailureHandler(err => showToast('Error', err.message, 'danger'))
      .sendPenilaianInvitations(appState.token, appState.periodeAktifId);
  });
}

// ════════════════════════════════════════════════════════════
// MASTER KARYAWAN
// ════════════════════════════════════════════════════════════
const KFILTER_DEFAULT = { q: '', dept: '', tipe: '', status: '' };

/**
 * Fungsi murni: menyaring daftar karyawan.
 * - q: kata kunci bebas, semua kata harus cocok (AND), dicari di ID, nama, email, departemen, posisi, dan nama atasan.
 * - dept, tipe, status: cocok persis bila terisi.
 */
function filterKaryawan(all, f) {
  const filt = Object.assign({}, KFILTER_DEFAULT, f || {});
  const tokens = String(filt.q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const kMap = {};
  all.forEach(k => { kMap[k.ID_Karyawan] = k; });
  return all.filter(k => {
    if (filt.dept && (k.Departemen || '') !== filt.dept) return false;
    if (filt.tipe && k.Form_Type !== filt.tipe) return false;
    if (filt.status && k.Status !== filt.status) return false;
    if (tokens.length) {
      const atasan = k.Atasan_Langsung_ID && kMap[k.Atasan_Langsung_ID] ? kMap[k.Atasan_Langsung_ID].Nama : '';
      const hay = [k.ID_Karyawan, k.Nama, k.Email, k.Departemen, k.Posisi, atasan]
        .map(v => String(v == null ? '' : v)).join(' ').toLowerCase();
      if (!tokens.every(t => hay.includes(t))) return false;
    }
    return true;
  });
}

function loadKaryawanSection() {
  const sec = document.getElementById('section-karyawan');
  if (!appState.kFilter) appState.kFilter = Object.assign({}, KFILTER_DEFAULT);
  const f = appState.kFilter;
  sec.innerHTML = `
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
      <span class="annotation">M-DATA // MASTER_KARYAWAN</span>
      <div class="d-flex gap-2">
        <button class="btn-outline-wf" onclick="new bootstrap.Modal(document.getElementById('importModal')).show()"><i class="bi bi-upload"></i> Import Massal</button>
        <button class="btn-primary-wf" onclick="openKaryawanModal()"><i class="bi bi-plus-lg"></i> Tambah Karyawan</button>
      </div>
    </div>
    <div class="wf-card-tight filter-bar">
      <div class="kf-search">
        <i class="bi bi-search"></i>
        <input type="search" class="wf-input" id="kf_q" placeholder="Cari nama, email, ID, posisi, atasan…"
          value="${escapeHtml(f.q)}" autocomplete="off" oninput="setKaryawanFilter('q', this.value)" aria-label="Cari karyawan">
      </div>
      <select class="wf-input kf-select" id="kf_dept" onchange="setKaryawanFilter('dept', this.value)" aria-label="Filter departemen"></select>
      <select class="wf-input kf-select" id="kf_tipe" onchange="setKaryawanFilter('tipe', this.value)" aria-label="Filter tipe form">
        <option value="">Semua tipe</option>
        <option value="STAFF" ${f.tipe === 'STAFF' ? 'selected' : ''}>STAFF</option>
        <option value="MANAGER" ${f.tipe === 'MANAGER' ? 'selected' : ''}>MANAGER</option>
      </select>
      <select class="wf-input kf-select" id="kf_status" onchange="setKaryawanFilter('status', this.value)" aria-label="Filter status">
        <option value="">Semua status</option>
        <option value="Active" ${f.status === 'Active' ? 'selected' : ''}>Active</option>
        <option value="Nonaktif" ${f.status === 'Nonaktif' ? 'selected' : ''}>Nonaktif</option>
      </select>
      <button type="button" class="btn-ghost-wf" onclick="resetKaryawanFilter()"><i class="bi bi-arrow-counterclockwise"></i> Reset</button>
      <span class="body-sm text-muted kf-count" id="kf_count"></span>
    </div>
    <div class="table-responsive wf-card" style="padding:0;">
      <table class="wf-table"><thead><tr>
        <th>ID</th><th>Nama</th><th>Departemen</th><th>Posisi</th><th>Atasan</th><th>Tipe</th><th>Status</th><th></th>
      </tr></thead><tbody id="karyawanTbody">${skeletonRows(5, 8)}</tbody></table>
    </div>`;

  fetchSWR('karyawan', 'getAllKaryawan', [appState.token], res => {
    appState.karyawanCache = res.data;
    applyKaryawanFilter();
  });
  // jika data sudah ada di cache (kunjungan kedua), tampilkan langsung
  if (appState.karyawanCache) applyKaryawanFilter();
}

function setKaryawanFilter(key, value) {
  if (!appState.kFilter) appState.kFilter = Object.assign({}, KFILTER_DEFAULT);
  appState.kFilter[key] = value;
  applyKaryawanFilter();
}

function resetKaryawanFilter() {
  appState.kFilter = Object.assign({}, KFILTER_DEFAULT);
  const q = document.getElementById('kf_q'); if (q) q.value = '';
  const t = document.getElementById('kf_tipe'); if (t) t.value = '';
  const s = document.getElementById('kf_status'); if (s) s.value = '';
  applyKaryawanFilter();
}

/** Terapkan filter ke cache, perbarui pilihan departemen, hitungan, dan tabel. */
function applyKaryawanFilter() {
  const all = appState.karyawanCache || [];
  const f = appState.kFilter || KFILTER_DEFAULT;
  const countEl = document.getElementById('kf_count');
  if (!countEl) return; // layar Master Karyawan sudah ditinggalkan

  // pilihan departemen dari data nyata; pertahankan pilihan aktif bila masih ada
  const deptSel = document.getElementById('kf_dept');
  if (deptSel) {
    const depts = [...new Set(all.map(k => k.Departemen).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
    const active = depts.indexOf(f.dept) > -1 ? f.dept : '';
    if (!active && f.dept) appState.kFilter.dept = '';
    deptSel.innerHTML = '<option value="">Semua departemen</option>' +
      depts.map(d => `<option value="${escapeHtml(d)}" ${d === active ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
  }

  const hit = filterKaryawan(all, appState.kFilter);
  const aktifFilter = !!(f.q.trim() || f.dept || f.tipe || f.status);
  countEl.textContent = all.length ? `Menampilkan ${hit.length} dari ${all.length} karyawan` : '';
  renderKaryawanTable(hit, all.length, aktifFilter);
}

function renderKaryawanTable(list, total, filterAktif) {
  const tbody = document.getElementById('karyawanTbody');
  if (!tbody) return;
  if (!list.length) {
    const kosong = total > 0 && filterAktif;
    tbody.innerHTML = `<tr><td colspan="8">${kosong
      ? emptyState('bi-search', 'Tidak ada karyawan yang cocok', 'Coba kata kunci lain atau atur ulang filter.') +
        `<div class="text-center mb-3"><button type="button" class="btn-outline-wf" onclick="resetKaryawanFilter()"><i class="bi bi-arrow-counterclockwise"></i> Atur ulang filter</button></div>`
      : emptyState('bi-people', 'Belum ada data karyawan', 'Tambahkan karyawan satu per satu atau import massal.')}</td></tr>`;
    return;
  }
  const all = appState.karyawanCache || list;
  const kMap = {}; all.forEach(k => kMap[k.ID_Karyawan] = k);
  tbody.innerHTML = list.map(k => `
    <tr>
      <td><span class="annotation">${escapeHtml(k.ID_Karyawan)}</span></td>
      <td>${escapeHtml(k.Nama)}<div class="body-sm text-muted">${escapeHtml(k.Email)}</div></td>
      <td>${escapeHtml(k.Departemen)}</td>
      <td>${escapeHtml(k.Posisi)}</td>
      <td>${k.Atasan_Langsung_ID && kMap[k.Atasan_Langsung_ID] ? escapeHtml(kMap[k.Atasan_Langsung_ID].Nama) : '-'}</td>
      <td><span class="pill-tag">${escapeHtml(k.Form_Type)}</span></td>
      <td><span class="pill ${k.Status === 'Active' ? 'pill-done' : 'pill-pending'}">${escapeHtml(k.Status)}</span></td>
      <td>
        <button class="btn-sm-icon" onclick='openKaryawanModal(${JSON.stringify(k).replace(/'/g, "&#39;")})'><i class="bi bi-pencil"></i></button>
        <button class="btn-sm-icon" title="Reset PIN" onclick="resetPinUi('${escapeHtml(k.ID_Karyawan)}')"><i class="bi bi-key"></i></button>
        ${k.Status === 'Active' ? `<button class="btn-sm-icon" title="Nonaktifkan" style="color:var(--wf-error)" onclick="deleteKaryawanConfirm('${escapeHtml(k.ID_Karyawan)}')"><i class="bi bi-person-x"></i></button>` : ''}
      </td>
    </tr>`).join('');
}

function openKaryawanModal(data) {
  document.getElementById('karyawanForm').reset();
  document.getElementById('karyawanModalTitle').textContent = data ? 'Edit Karyawan' : 'Tambah Karyawan';
  document.getElementById('k_ID_Karyawan').value = data ? data.ID_Karyawan : '';
  document.getElementById('k_Nama').value = data ? data.Nama : '';
  document.getElementById('k_Email').value = data ? data.Email : '';
  document.getElementById('k_Departemen').value = data ? data.Departemen : '';
  document.getElementById('k_Posisi').value = data ? data.Posisi : '';
  const selAtasan = document.getElementById('k_Atasan_Langsung_ID');
  selAtasan.innerHTML = '<option value="">— Tanpa atasan —</option>' + (appState.karyawanCache || [])
    .filter(k => k.Status === 'Active' && (!data || k.ID_Karyawan !== data.ID_Karyawan))
    .map(k => `<option value="${escapeHtml(k.ID_Karyawan)}">${escapeHtml(k.Nama)} — ${escapeHtml(k.Posisi || '')}</option>`).join('');
  selAtasan.value = data ? (data.Atasan_Langsung_ID || '') : '';
  document.getElementById('k_Form_Type').value = data ? data.Form_Type : 'STAFF';
  document.getElementById('k_Status').value = data ? data.Status : 'Active';
  new bootstrap.Modal(document.getElementById('karyawanModal')).show();
}
function submitKaryawanForm() {
  const obj = {
    ID_Karyawan: document.getElementById('k_ID_Karyawan').value,
    Nama: document.getElementById('k_Nama').value.trim(),
    Email: document.getElementById('k_Email').value.trim(),
    Departemen: document.getElementById('k_Departemen').value.trim(),
    Posisi: document.getElementById('k_Posisi').value.trim(),
    Atasan_Langsung_ID: document.getElementById('k_Atasan_Langsung_ID').value,
    Form_Type: document.getElementById('k_Form_Type').value,
    Status: document.getElementById('k_Status').value
  };
  if (!obj.Nama || !obj.Email) { showToast('Validasi', 'Nama dan Email wajib diisi.', 'warning'); return; }
  GSR()
    .withSuccessHandler(res => {
      if (res.success) {
        bootstrap.Modal.getInstance(document.getElementById('karyawanModal')).hide();
        showToast('Berhasil', res.message, 'success');
        if (res.data && res.data.pin) showPinModal(obj.Nama, res.data.pin);
        loadKaryawanSection();
      } else showToast('Gagal', res.message, 'danger');
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .upsertKaryawan(appState.token, obj);
}
function resetPinUi(id) {
  const k = (appState.karyawanCache || []).find(x => x.ID_Karyawan === id);
  openConfirm('Reset PIN', `Buat PIN baru untuk ${k ? k.Nama : id}? PIN lama tidak berlaku lagi.`, () => {
    GSR()
      .withSuccessHandler(res => { if (res && res.success) showPinModal(k ? k.Nama : id, res.data.pin, res.data.email + ' · sheet Users baris ' + res.data.row); else showToast('Gagal', res ? res.message : 'Tidak ada respons.', 'danger'); })
      .withFailureHandler(err => showToast('Error', err.message, 'danger'))
      .resetPinKaryawan(appState.token, id);
  });
}
/** PIN hanya tampil sekali — modal tetap terbuka sampai ditutup admin */
function showPinModal(nama, pin, info) {
  let el = document.getElementById('pinModal');
  if (el) el.remove();
  el = document.createElement('div');
  el.id = 'pinModal'; el.className = 'modal fade'; el.tabIndex = -1;
  el.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content wf-modal">
    <div class="modal-header"><h5 class="modal-title">PIN login — ${escapeHtml(nama)}</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body text-center"><p class="body-sm text-muted">Catat dan sampaikan PIN ini ke karyawan.${info ? '<br><b>' + escapeHtml(info) + '</b>' : ''}</p>
      <div style="font-family:'JetBrains Mono',monospace;font-size:40px;font-weight:700;letter-spacing:.2em;">${escapeHtml(pin)}</div></div>
    <div class="modal-footer"><button type="button" class="btn-primary-wf" data-bs-dismiss="modal">Sudah dicatat</button></div></div></div>`;
  document.body.appendChild(el);
  new bootstrap.Modal(el).show();
}
/** Modal dinamis sederhana (dibuat ulang tiap dipanggil) */
function openDynModal(id, title, bodyHtml, footerHtml, wide) {
  let el = document.getElementById(id);
  if (el) el.remove();
  el = document.createElement('div');
  el.id = id; el.className = 'modal fade'; el.tabIndex = -1;
  el.innerHTML = `<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable ${wide ? 'modal-lg' : ''}"><div class="modal-content wf-modal">
    <div class="modal-header"><h5 class="modal-title">${escapeHtml(title)}</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-footer">${footerHtml}</div></div></div>`;
  document.body.appendChild(el);
  new bootstrap.Modal(el).show();
  return el;
}
function closeDynModal(id) {
  const el = document.getElementById(id);
  const inst = el && bootstrap.Modal.getInstance ? bootstrap.Modal.getInstance(el) : null;
  if (inst) inst.hide();
}
function planSection(judul, items, fmt, warna) {
  if (!items || !items.length) return '';
  const rows = items.slice(0, 50).map(i => `<li class="body-sm">${fmt(i)}</li>`).join('');
  return `<div class="mb-3"><div class="label-md" style="${warna ? 'color:' + warna : ''}">${judul} (${items.length})</div><ul class="mb-0" style="max-height:160px;overflow:auto;">${rows}${items.length > 50 ? `<li class="body-sm text-muted">… dan ${items.length - 50} lainnya</li>` : ''}</ul></div>`;
}

function previewSinkronAkun() {
  showToast('Memeriksa', 'Membandingkan Master Karyawan dengan akun login...', 'info');
  GSR()
    .withSuccessHandler(res => {
      if (!res || !res.success) { showToast('Gagal', res ? res.message : 'Tidak ada respons dari server.', 'danger'); return; }
      renderSinkronPlan(res.data);
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .sinkronAkunLogin(appState.token, { dryRun: true });
}
function renderSinkronPlan(p) {
  const total = p.baru.length + p.perbarui.length + p.yatim.length;
  const nm = x => `${escapeHtml(x.nama)} <span class="text-muted">· ${escapeHtml(x.email)}</span>`;
  let body = total === 0 ? '<p>Semua akun login sudah sinkron dengan Master Karyawan. Tidak ada yang perlu dilakukan.</p>' : `
    <p class="body-sm text-muted">Berikut yang akan dilakukan. Data di sheet <b>Users</b> akan diubah.</p>
    ${planSection('Akun baru (PIN acak dibuat)', p.baru, nm, 'var(--wf-primary)')}
    ${planSection('Akun diperbarui (PIN tetap)', p.perbarui, x => nm(x) + ' <span class="pill-tag">' + escapeHtml(x.perubahan.join(', ')) + '</span>')}
    ${planSection('Akun tidak ada di Master Karyawan', p.yatim, nm, 'var(--wf-error)')}
    ${p.yatim.length ? `<label class="d-flex gap-2 align-items-start body-sm mb-2"><input type="checkbox" id="sync_hapus" checked> <span>Hapus permanen baris akun ini dari sheet Users (jika tidak dicentang, hanya dinonaktifkan). Akun Admin tidak pernah disentuh.</span></label>` : ''}`;
  body += planSection('Dilewati (perlu dibetulkan di Master Karyawan)', p.dilewati, x => `${escapeHtml(x.nama)} — ${escapeHtml(x.alasan)}`, 'var(--wf-warn-text, #854D0E)');
  const footer = `<button type="button" class="btn-outline-wf" data-bs-dismiss="modal">${total ? 'Batal' : 'Tutup'}</button>` +
    (total ? `<button type="button" class="btn-primary-wf" onclick="applySinkronAkun()">Terapkan</button>` : '');
  openDynModal('syncModal', 'Sinkronkan Akun Login', body, footer, true);
}
function applySinkronAkun() {
  const cb = document.getElementById('sync_hapus');
  const hapus = cb ? !!cb.checked : false;
  GSR()
    .withSuccessHandler(res => {
      closeDynModal('syncModal');
      if (!res || !res.success) { showToast('Gagal', res ? res.message : 'Tidak ada respons dari server.', 'danger'); return; }
      showToast('Berhasil', res.message, 'success');
      if (res.data.pins && res.data.pins.length) showCredentialsModal(res.data.pins);
    })
    .withFailureHandler(err => { closeDynModal('syncModal'); showToast('Error', err.message, 'danger'); })
    .sinkronAkunLogin(appState.token, { dryRun: false, hapusYatim: hapus });
}
function showCredentialsModal(list) {
  const rows = list.map(x => `<tr><td>${escapeHtml(x.nama)}</td><td>${escapeHtml(x.email)}</td><td style="font-family:'JetBrains Mono',monospace;font-weight:700;">${escapeHtml(x.pin)}</td></tr>`).join('');
  const tsv = list.map(x => [x.nama, x.email, x.pin].join('\t')).join('\n');
  openDynModal('credModal', 'Akun baru & PIN login',
    `<p class="body-sm text-muted">Sampaikan PIN ke masing-masing karyawan. PIN juga tersimpan di sheet <b>Users</b>.</p>
     <div class="table-responsive"><table class="wf-table"><thead><tr><th>Nama</th><th>Email</th><th>PIN</th></tr></thead><tbody>${rows}</tbody></table></div>
     <textarea id="credTsv" class="wf-input mt-2" rows="3" readonly>${escapeHtml(tsv)}</textarea>`,
    `<button type="button" class="btn-outline-wf" onclick="copyCredentials()"><i class="bi bi-clipboard"></i> Salin</button><button type="button" class="btn-primary-wf" data-bs-dismiss="modal">Sudah dicatat</button>`, true);
}
function copyCredentials() {
  const ta = document.getElementById('credTsv');
  try { ta.select(); document.execCommand('copy'); showToast('Tersalin', 'Daftar akun disalin ke clipboard.', 'success'); }
  catch (e) { showToast('Info', 'Salin manual dari kotak teks.', 'info'); }
}

const NAMA_TABEL = { MAPPING_PENILAI: 'Penugasan', FORM_RESPONSES: 'Jawaban formulir', FORM_NARASI: 'Narasi', HASIL_PENILAIAN: 'Hasil skor', MASTER_PERIODE: 'Periode' };
function ringkasTabel(o) {
  const parts = Object.keys(o).filter(k => o[k] > 0).map(k => `${NAMA_TABEL[k] || k}: <b>${o[k]}</b>`);
  return parts.length ? parts.join(' · ') : '<span class="text-muted">tidak ada</span>';
}
function previewBersihData() {
  showToast('Memindai', 'Mencari data contoh dan data yatim...', 'info');
  GSR()
    .withSuccessHandler(res => {
      if (!res || !res.success) { showToast('Gagal', res ? res.message : 'Tidak ada respons dari server.', 'danger'); return; }
      renderBersihPlan(res.data);
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .bersihkanDataContoh(appState.token, { dryRun: true });
}
function renderBersihPlan(d) {
  const adaDasar = Object.keys(d.dasar).some(k => d.dasar[k] > 0);
  const pc = d.periodeContoh && d.periodeContoh[0];
  const adaContoh = !!pc;
  const body = `
    <p class="body-sm text-muted">Data yatim = penugasan, jawaban, dan hasil yang merujuk ke karyawan atau periode yang sudah tidak ada. Data periode lain tidak disentuh.</p>
    <div class="mb-3"><div class="label-md">Data yatim terdeteksi</div><div class="body-sm">${ringkasTabel(d.dasar)}</div></div>
    ${adaContoh ? `<div class="wf-card-tight mb-2">
      <label class="d-flex gap-2 align-items-start body-sm"><input type="checkbox" id="bersih_contoh"> <span>Hapus juga <b>periode contoh bawaan</b> “${escapeHtml(pc.nama)}” (${escapeHtml(pc.id)}, status ${escapeHtml(pc.status)}) beserta semua penugasan, jawaban, dan hasilnya.<br><span class="text-muted">Total yang akan dihapus bila dicentang: ${ringkasTabel(d.denganPeriodeContoh)}</span></span></label></div>` : ''}
    ${!adaDasar && !adaContoh ? '<p>Tidak ada data contoh atau data yatim. Semuanya bersih.</p>' : '<p class="body-sm"><b>Tindakan ini tidak dapat dibatalkan.</b> Pastikan Anda sudah membuat salinan spreadsheet bila perlu (File → Buat salinan).</p>'}`;
  const bisa = adaDasar || adaContoh;
  const footer = `<button type="button" class="btn-outline-wf" data-bs-dismiss="modal">${bisa ? 'Batal' : 'Tutup'}</button>` +
    (bisa ? `<button type="button" class="btn-primary-wf" onclick="applyBersihData()">Hapus Sekarang</button>` : '');
  openDynModal('bersihModal', 'Bersihkan Data Contoh / Yatim', body, footer, true);
}
function applyBersihData() {
  const cb = document.getElementById('bersih_contoh');
  GSR()
    .withSuccessHandler(res => {
      closeDynModal('bersihModal');
      if (!res || !res.success) { showToast('Gagal', res ? res.message : 'Tidak ada respons dari server.', 'danger'); return; }
      showToast('Berhasil', res.message + ' Memuat ulang...', 'success');
      setTimeout(refreshAppInPlace, 1500); // periode aktif bisa berubah
    })
    .withFailureHandler(err => { closeDynModal('bersihModal'); showToast('Error', err.message, 'danger'); })
    .bersihkanDataContoh(appState.token, { dryRun: false, hapusPeriodeContoh: !!(cb && cb.checked) });
}

function deleteKaryawanConfirm(id) {
  openConfirm('Nonaktifkan Karyawan', `Nonaktifkan karyawan ${id}? Login dicabut dan penugasan yang belum diisi dihapus; riwayat penilaian tetap tersimpan. Karyawan dapat diaktifkan lagi lewat Edit.`, () => {
    GSR()
      .withSuccessHandler(res => { showToast(res.success ? 'Berhasil' : 'Gagal', res.message, res.success ? 'success' : 'danger'); loadKaryawanSection(); })
      .withFailureHandler(err => showToast('Error', err.message, 'danger'))
      .deleteKaryawan(appState.token, id);
  });
}
function submitBulkImport() {
  const raw = document.getElementById('importTextarea').value.trim();
  if (!raw) return;
  const rows = raw.split('\n').filter(l => l.trim()).map(line => {
    const cols = line.split('\t');
    return { Nama: cols[0] || '', Email: cols[1] || '', Departemen: cols[2] || '', Posisi: cols[3] || '', Atasan_Langsung_ID: cols[4] || '', Form_Type: cols[5] || 'STAFF' };
  });
  GSR()
    .withSuccessHandler(res => {
      if (res.success) {
        bootstrap.Modal.getInstance(document.getElementById('importModal')).hide();
        document.getElementById('importTextarea').value = '';
        showToast('Berhasil', res.message, 'success');
        loadKaryawanSection();
      } else showToast('Gagal', res.message, 'danger');
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .bulkImportKaryawan(appState.token, rows);
}

// ════════════════════════════════════════════════════════════
// PERIODE PENILAIAN
// ════════════════════════════════════════════════════════════
function loadPeriodeSection() {
  const sec = document.getElementById('section-periode');
  sec.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <span class="annotation">M-DATA // MASTER_PERIODE</span>
      <button class="btn-primary-wf" onclick="openPeriodeModal()"><i class="bi bi-plus-lg"></i> Buat Periode</button>
    </div>
    <div id="periodeCards" class="row g-3">${skeletonCardRow()}</div>`;
  fetchSWR('periode', 'getAllPeriode', [appState.token], res => { appState.periodeList = res.data; renderPeriodeCards(res.data); });
}
function skeletonCardRow() { return `<div class="col-md-6"><div class="skel" style="height:150px;"></div></div>`.repeat(2); }

function renderPeriodeCards(list) {
  const el = document.getElementById('periodeCards');
  if (!list.length) { el.innerHTML = `<div class="col-12">${emptyState('bi-calendar-plus', 'Belum ada periode', 'Buat periode penilaian pertama Anda.')}</div>`; return; }
  const statusPill = { Draft: 'pill-pending', Open: 'pill-progress', Closed: 'pill-done', Completed: 'pill-done' };
  el.innerHTML = list.map(p => `
    <div class="col-md-6">
      <div class="wf-card ${p.ID_Periode === appState.periodeAktifId ? 'active-card' : ''}">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <span class="annotation">ID_SIKLUS: ${p.ID_Periode}</span>
            <div class="headline-md mt-1">${escapeHtml(p.Nama_Periode)}</div>
            <div class="body-sm text-muted">${p.Tipe} · ${p.Tgl_Mulai} s/d ${p.Tgl_Selesai}</div>
          </div>
          <span class="pill ${statusPill[p.Status] || 'pill-pending'}">${p.Status}</span>
        </div>
        <div class="body-sm text-muted mt-2">Bobot: Self ${p.Bobot_Self}% · Atasan ${p.Bobot_Atasan}% · Peer ${p.Bobot_Peer}% · Bawahan ${p.Bobot_Bawahan}%</div>
        <div class="d-flex flex-wrap gap-2 mt-3">
          <button class="btn-ghost-wf" onclick='openPeriodeModal(${JSON.stringify(p).replace(/'/g, "&#39;")})'><i class="bi bi-pencil"></i> Edit</button>
          ${p.Status === 'Draft' ? `<button class="btn-outline-wf" onclick="setPeriodeStatusUi('${p.ID_Periode}','Open')">Buka Periode</button>` : ''}
          ${p.Status === 'Open' ? `<button class="btn-outline-wf" onclick="setPeriodeStatusUi('${p.ID_Periode}','Closed')">Tutup & Hitung Skor</button>` : ''}
          ${p.Status !== 'Draft' ? `<button class="btn-ghost-wf" onclick="runAutoMapping('${p.ID_Periode}')"><i class="bi bi-magic"></i> Auto-Mapping Self/Atasan</button>` : ''}
        </div>
      </div>
    </div>`).join('');
}
function openPeriodeModal(data) {
  document.getElementById('periodeForm').reset();
  document.getElementById('periodeModalTitle').textContent = data ? 'Edit Periode' : 'Periode Baru';
  document.getElementById('p_ID_Periode').value = data ? data.ID_Periode : '';
  document.getElementById('p_Nama_Periode').value = data ? data.Nama_Periode : '';
  document.getElementById('p_Tipe').value = data ? data.Tipe : 'Tahunan';
  document.getElementById('p_Status').value = data ? data.Status : 'Draft';
  document.getElementById('p_Tgl_Mulai').value = data ? data.Tgl_Mulai : '';
  document.getElementById('p_Tgl_Selesai').value = data ? data.Tgl_Selesai : '';
  document.getElementById('p_Bobot_Self').value = data ? data.Bobot_Self : 10;
  document.getElementById('p_Bobot_Atasan').value = data ? data.Bobot_Atasan : 40;
  document.getElementById('p_Bobot_Peer').value = data ? data.Bobot_Peer : 30;
  document.getElementById('p_Bobot_Bawahan').value = data ? data.Bobot_Bawahan : 20;
  new bootstrap.Modal(document.getElementById('periodeModal')).show();
}
function submitPeriodeForm() {
  const obj = {
    ID_Periode: document.getElementById('p_ID_Periode').value,
    Nama_Periode: document.getElementById('p_Nama_Periode').value.trim(),
    Tipe: document.getElementById('p_Tipe').value,
    Status: document.getElementById('p_Status').value,
    Tgl_Mulai: document.getElementById('p_Tgl_Mulai').value,
    Tgl_Selesai: document.getElementById('p_Tgl_Selesai').value,
    Bobot_Self: Number(document.getElementById('p_Bobot_Self').value) || 0,
    Bobot_Atasan: Number(document.getElementById('p_Bobot_Atasan').value) || 0,
    Bobot_Peer: Number(document.getElementById('p_Bobot_Peer').value) || 0,
    Bobot_Bawahan: Number(document.getElementById('p_Bobot_Bawahan').value) || 0
  };
  if (!obj.Nama_Periode) { showToast('Validasi', 'Nama periode wajib diisi.', 'warning'); return; }
  GSR()
    .withSuccessHandler(res => {
      if (res.success) { bootstrap.Modal.getInstance(document.getElementById('periodeModal')).hide(); showToast('Berhasil', res.message, 'success'); loadPeriodeSection(); }
      else showToast('Gagal', res.message, 'danger');
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .upsertPeriode(appState.token, obj);
}
function setPeriodeStatusUi(id, status) {
  const msg = status === 'Closed' ? 'Menutup periode akan mengunci semua form & menghitung skor akhir seluruh karyawan. Lanjutkan?' : 'Buka periode ini untuk penilaian?';
  openConfirm('Ubah Status Periode', msg, () => {
    GSR()
      .withSuccessHandler(res => { showToast(res.success ? 'Berhasil' : 'Gagal', res.message, res.success ? 'success' : 'danger'); loadPeriodeSection(); })
      .withFailureHandler(err => showToast('Error', err.message, 'danger'))
      .setPeriodeStatus(appState.token, id, status);
  });
}
function runAutoMapping(periodeId) {
  GSR()
    .withSuccessHandler(res => showToast(res.success ? 'Berhasil' : 'Gagal', res.message, res.success ? 'success' : 'danger'))
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .runAutoGenerateMapping(appState.token, periodeId);
}

// ════════════════════════════════════════════════════════════
// MAPPING / ASSIGN PENILAI (dengan pencarian & filter)
// ════════════════════════════════════════════════════════════
const MFILTER_DEFAULT = { q: '', persp: '', status: '' };

/** Murni: saring daftar penugasan. q = semua kata harus cocok di nama dinilai/penilai (AND). */
function filterMapping(all, f) {
  const filt = Object.assign({}, MFILTER_DEFAULT, f || {});
  const tokens = String(filt.q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter(m => {
    if (filt.persp && m.Perspektif !== filt.persp) return false;
    if (filt.status && m.Status !== filt.status) return false;
    if (tokens.length) {
      const hay = [m.NamaDinilai, m.NamaPenilai].map(v => String(v == null ? '' : v)).join(' ').toLowerCase();
      if (!tokens.every(t => hay.includes(t))) return false;
    }
    return true;
  });
}

/** Murni: karyawan aktif yang cocok dengan kata kunci (ID, nama, email, departemen, posisi). */
function filterPegawaiOpsi(all, q) {
  const tokens = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter(k => {
    if (k.Status !== 'Active') return false;
    if (!tokens.length) return true;
    const hay = [k.ID_Karyawan, k.Nama, k.Email, k.Departemen, k.Posisi].map(v => String(v == null ? '' : v)).join(' ').toLowerCase();
    return tokens.every(t => hay.includes(t));
  });
}

function loadMappingSection() {
  const sec = document.getElementById('section-mapping');
  if (!appState.periodeAktifId) { sec.innerHTML = emptyState('bi-calendar-x', 'Belum ada periode', 'Buat periode terlebih dahulu.'); return; }
  if (!appState.mFilter) appState.mFilter = Object.assign({}, MFILTER_DEFAULT);
  const f = appState.mFilter;
  sec.innerHTML = `
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
      <span class="annotation">EVAL // MAPPING_PENILAI</span>
      ${periodeSelectorHtml('mapPeriodeSel')}
    </div>
    <div class="wf-card mb-3">
      <div class="headline-md mb-3">Tugaskan Penilai Manual (Peer / Bawahan)</div>
      <div class="row g-2 align-items-end">
        <div class="col-md-4"><label class="wf-label" for="map_karyawan">Karyawan Dinilai</label>
          <input type="search" class="wf-input mb-1" id="map_karyawan_q" placeholder="Cari karyawan…" autocomplete="off" oninput="fillMapSelects()" aria-label="Cari karyawan dinilai">
          <select class="wf-input" id="map_karyawan"></select></div>
        <div class="col-md-4"><label class="wf-label" for="map_penilai">Penilai</label>
          <input type="search" class="wf-input mb-1" id="map_penilai_q" placeholder="Cari penilai…" autocomplete="off" oninput="fillMapSelects()" aria-label="Cari penilai">
          <select class="wf-input" id="map_penilai"></select></div>
        <div class="col-md-2"><label class="wf-label" for="map_perspektif">Perspektif</label>
          <select class="wf-input" id="map_perspektif"><option>Peer</option><option>Bawahan</option><option>Atasan</option></select>
        </div>
        <div class="col-md-2"><button class="btn-primary-wf w-100" onclick="addManualMapping()">Tugaskan</button></div>
      </div>
    </div>
    <div class="wf-card-tight filter-bar">
      <div class="kf-search">
        <i class="bi bi-search"></i>
        <input type="search" class="wf-input" id="mf_q" placeholder="Cari nama karyawan dinilai atau penilai…"
          value="${escapeHtml(f.q)}" autocomplete="off" oninput="setMappingFilter('q', this.value)" aria-label="Cari penugasan">
      </div>
      <select class="wf-input kf-select" id="mf_persp" onchange="setMappingFilter('persp', this.value)" aria-label="Filter perspektif">
        <option value="">Semua perspektif</option>
        ${['Self', 'Atasan', 'Peer', 'Bawahan'].map(p => `<option value="${p}" ${f.persp === p ? 'selected' : ''}>${p}</option>`).join('')}
      </select>
      <select class="wf-input kf-select" id="mf_status" onchange="setMappingFilter('status', this.value)" aria-label="Filter status">
        <option value="">Semua status</option>
        ${['Pending', 'Draft', 'Submitted'].map(s => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <button type="button" class="btn-ghost-wf" onclick="resetMappingFilter()"><i class="bi bi-arrow-counterclockwise"></i> Reset</button>
      <span class="body-sm text-muted kf-count" id="mf_count"></span>
    </div>
    <div class="table-responsive wf-card" style="padding:0;">
      <table class="wf-table"><thead><tr><th>Dinilai</th><th>Penilai</th><th>Perspektif</th><th>Status</th><th>Tgl Submit</th><th></th></tr></thead>
      <tbody id="mappingTbody">${skeletonRows(5, 6)}</tbody></table>
    </div>`;

  fetchSWR('karyawan', 'getAllKaryawan', [appState.token], res => {
    appState.karyawanCache = res.data;
    fillMapSelects();
  });
  fetchSWR('mapping|' + appState.periodeAktifId, 'getMappingMatrix', [appState.token, appState.periodeAktifId], res => {
    appState.mappingCache = res.data;
    applyMappingFilter();
  });
}

/** Isi dropdown Karyawan Dinilai & Penilai sesuai kata kunci pencarian masing-masing. */
function fillMapSelects() {
  const all = appState.karyawanCache || [];
  ['map_karyawan', 'map_penilai'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const qEl = document.getElementById(id + '_q');
    const hit = filterPegawaiOpsi(all, qEl ? qEl.value : '');
    const prev = sel.value;
    if (!hit.length) { sel.innerHTML = '<option value="">(tidak ada karyawan yang cocok)</option>'; return; }
    sel.innerHTML = hit.map(k => `<option value="${escapeHtml(k.ID_Karyawan)}">${escapeHtml(k.Nama)}${k.Departemen ? ' · ' + escapeHtml(k.Departemen) : ''}</option>`).join('');
    if (prev && hit.some(k => k.ID_Karyawan === prev)) sel.value = prev;
  });
}

function setMappingFilter(key, value) {
  if (!appState.mFilter) appState.mFilter = Object.assign({}, MFILTER_DEFAULT);
  appState.mFilter[key] = value;
  applyMappingFilter();
}
function resetMappingFilter() {
  appState.mFilter = Object.assign({}, MFILTER_DEFAULT);
  ['mf_q', 'mf_persp', 'mf_status'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  applyMappingFilter();
}
function applyMappingFilter() {
  const countEl = document.getElementById('mf_count');
  if (!countEl) return; // layar Assign Penilai sudah ditinggalkan
  const all = appState.mappingCache || [];
  const f = appState.mFilter || MFILTER_DEFAULT;
  const hit = filterMapping(all, f);
  const aktif = !!(f.q.trim() || f.persp || f.status);
  countEl.textContent = all.length ? `Menampilkan ${hit.length} dari ${all.length} penugasan` : '';
  renderMappingTable(hit, all.length, aktif);
}

function renderMappingTable(list, total, filterAktif) {
  const tbody = document.getElementById('mappingTbody');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6">${total > 0 && filterAktif
      ? emptyState('bi-search', 'Tidak ada penugasan yang cocok', 'Coba kata kunci lain atau atur ulang filter.') +
        `<div class="text-center mb-3"><button type="button" class="btn-outline-wf" onclick="resetMappingFilter()"><i class="bi bi-arrow-counterclockwise"></i> Atur ulang filter</button></div>`
      : emptyState('bi-diagram-3', 'Belum ada mapping', 'Gunakan Auto-Mapping di menu Periode atau tugaskan manual di atas.')}</td></tr>`;
    return;
  }
  const statusPill = { Pending: 'pill-pending', Draft: 'pill-draft', Submitted: 'pill-done' };
  tbody.innerHTML = list.map(m => `
    <tr>
      <td>${escapeHtml(m.NamaDinilai)}</td>
      <td>${escapeHtml(m.NamaPenilai)}</td>
      <td><span class="pill-tag">${escapeHtml(m.Perspektif)}</span></td>
      <td><span class="pill ${statusPill[m.Status] || 'pill-pending'}">${escapeHtml(m.Status)}</span></td>
      <td class="annotation">${m.Tgl_Submit ? new Date(m.Tgl_Submit).toLocaleDateString('id-ID') : '-'}</td>
      <td>${m.Status !== 'Submitted' ? `<button class="btn-sm-icon" style="color:var(--wf-error)" onclick="deleteMappingConfirm('${escapeHtml(m.ID_Mapping)}')"><i class="bi bi-trash"></i></button>` : ''}</td>
    </tr>`).join('');
}
function addManualMapping() {
  const karyawanId = document.getElementById('map_karyawan').value;
  const penilaiId = document.getElementById('map_penilai').value;
  const perspektif = document.getElementById('map_perspektif').value;
  if (!karyawanId || !penilaiId) { showToast('Validasi', 'Pilih karyawan dinilai dan penilai terlebih dahulu.', 'warning'); return; }
  if (karyawanId === penilaiId && perspektif !== 'Self') { showToast('Validasi', 'Penilai tidak boleh menilai dirinya sendiri untuk perspektif ini.', 'warning'); return; }
  GSR()
    .withSuccessHandler(res => { showToast(res.success ? 'Berhasil' : 'Gagal', res.message, res.success ? 'success' : 'danger'); if (res.success) loadMappingSection(); })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .assignMapping(appState.token, appState.periodeAktifId, karyawanId, penilaiId, perspektif);
}
function deleteMappingConfirm(id) {
  openConfirm('Hapus Mapping', 'Hapus penugasan penilaian ini?', () => {
    GSR()
      .withSuccessHandler(res => { showToast(res.success ? 'Berhasil' : 'Gagal', res.message, res.success ? 'success' : 'danger'); loadMappingSection(); })
      .withFailureHandler(err => showToast('Error', err.message, 'danger'))
      .deleteMapping(appState.token, id);
  });
}

// ════════════════════════════════════════════════════════════
// LAPORAN (ADMIN)
// ════════════════════════════════════════════════════════════
function loadLaporanSection() {
  const sec = document.getElementById('section-laporan');
  if (!appState.periodeAktifId) { sec.innerHTML = emptyState('bi-calendar-x', 'Belum ada periode', 'Buat periode terlebih dahulu.'); return; }
  sec.innerHTML = `
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
      <span class="annotation">ANALYTICS // HASIL_PENILAIAN</span>
      ${periodeSelectorHtml('lapPeriodeSel')}
    </div>
    ${(() => { const per = (appState.periodeList || []).find(p => p.ID_Periode === appState.periodeAktifId); return per && per.Status === 'Open' ? '<div class="pill pill-draft mb-3"><i class="bi bi-hourglass-split"></i>&nbsp; Skor SEMENTARA — periode masih Open. Hanya karyawan yang sudah punya formulir ter-submit yang tampil. Skor final dihitung saat periode ditutup.</div>' : ''; })()}
    <div class="filter-bar">
      <button class="btn-outline-wf" onclick="recalcHasil()"><i class="bi bi-arrow-clockwise"></i> Hitung Ulang Skor</button>
      <button class="btn-outline-wf" onclick="downloadCsvLaporan()"><i class="bi bi-file-earmark-excel"></i> Export Excel (CSV)</button>
    </div>
    <div class="table-responsive wf-card" style="padding:0;">
      <table class="wf-table"><thead><tr><th>Karyawan</th><th>Dept</th><th>Self</th><th>Atasan</th><th>Peer</th><th>Bawahan</th><th>Rata-rata</th><th>Interpretasi</th><th></th></tr></thead>
      <tbody id="laporanTbody">${skeletonRows(5, 9)}</tbody></table>
    </div>`;

  fetchSWR('laporan|' + appState.periodeAktifId, 'getLaporan', [appState.token, appState.periodeAktifId, {}], res => renderLaporanTable(res.data));
}
function tierPillClass(interp) {
  if (!interp) return 'pill-pending';
  if (interp.indexOf('Excellent') > -1) return 'pill-done';
  if (interp.indexOf('Good') > -1) return 'pill-progress';
  if (interp.indexOf('Critical') > -1 || interp.indexOf('Below') > -1) return 'pill-draft';
  return 'pill-pending';
}
function renderLaporanTable(rows) {
  const tbody = document.getElementById('laporanTbody');
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="9">${emptyState('bi-bar-chart', 'Belum ada hasil', 'Klik "Hitung Ulang Skor" setelah ada formulir yang disubmit.')}</td></tr>`; return; }
  tbody.innerHTML = rows.map(r => `
    <tr class="row-highlight" style="cursor:pointer" onclick="openReportDrilldown('${r.ID_Karyawan}')">
      <td>${escapeHtml(r.Nama)}<div class="body-sm text-muted">${escapeHtml(r.Posisi)}</div></td>
      <td>${escapeHtml(r.Departemen)}</td>
      <td class="annotation">${r.Self_Score || '-'}</td>
      <td class="annotation">${r.Atasan_Score || '-'}</td>
      <td class="annotation">${r.Peer_Score || '-'}</td>
      <td class="annotation">${r.Bawahan_Score || '-'}</td>
      <td class="annotation" style="font-weight:600">${r.Avg_Score.toFixed(2)}</td>
      <td><span class="pill ${tierPillClass(r.Interpretasi)}">${escapeHtml(r.Interpretasi)}</span></td>
      <td><i class="bi bi-chevron-right text-muted"></i></td>
    </tr>`).join('');
}
function recalcHasil() {
  GSR()
    .withSuccessHandler(res => { showToast(res.success ? 'Berhasil' : 'Gagal', res.message, res.success ? 'success' : 'danger'); loadLaporanSection(); })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .runGenerateHasil(appState.token, appState.periodeAktifId);
}
function downloadCsvLaporan() {
  GSR()
    .withSuccessHandler(res => {
      if (!res.success) { showToast('Gagal', res.message, 'danger'); return; }
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `Laporan_360_${appState.periodeAktifId}.csv`;
      link.click();
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .exportMasterLaporanCsv(appState.token, appState.periodeAktifId);
}

function openReportDrilldown(karyawanId) {
  const modalBody = document.getElementById('reportModalBody');
  modalBody.innerHTML = `<div class="skel" style="height:220px;"></div>`;
  new bootstrap.Modal(document.getElementById('reportModal')).show();
  GSR()
    .withSuccessHandler(res => {
      if (!res.success) { modalBody.innerHTML = `<p>${res.message}</p>`; return; }
      renderReportDetail(res.data, modalBody, karyawanId);
    })
    .withFailureHandler(err => modalBody.innerHTML = `<p>${err.message}</p>`)
    .getEmployeeResult(appState.token, karyawanId, appState.periodeAktifId);
}

function renderReportDetail(r, container, karyawanId) {
  container.innerHTML = `
    <div class="text-center mb-3">
      <span class="annotation">${r.departemen} · ${r.posisi}</span>
      <div class="headline-lg mt-1">${escapeHtml(r.nama)}</div>
      <div class="running-score-value">${r.hasData === false ? '—' : r.avgScore.toFixed(2) + ' / 5.00'}</div>
      <span class="pill ${tierPillClass(r.interpretasi)} mt-1">${escapeHtml(r.interpretasi)}</span>
    </div>
    <div class="row g-3 mb-3">
      <div class="col-6 col-md-3">
        <div class="wf-card-tight text-center"><div class="annotation">SELF</div><div class="label-md">${r.perspectiveScores.Self !== null ? r.perspectiveScores.Self.toFixed(2) : '—'}</div></div>
      </div>
      <div class="col-6 col-md-3">
        <div class="wf-card-tight text-center"><div class="annotation">ATASAN</div><div class="label-md">${r.perspectiveScores.Atasan !== null ? r.perspectiveScores.Atasan.toFixed(2) : '—'}</div></div>
      </div>
      <div class="col-6 col-md-3">
        <div class="wf-card-tight text-center"><div class="annotation">PEER</div><div class="label-md">${r.perspectiveScores.Peer !== null ? r.perspectiveScores.Peer.toFixed(2) : '—'}</div></div>
      </div>
      <div class="col-6 col-md-3">
        <div class="wf-card-tight text-center"><div class="annotation">BAWAHAN</div><div class="label-md">${r.perspectiveScores.Bawahan !== null ? r.perspectiveScores.Bawahan.toFixed(2) : '—'}</div></div>
      </div>
    </div>
    <canvas id="radarChart" height="200" class="mb-3"></canvas>
    <div class="row g-3 mb-3">
      <div class="col-md-6"><div class="strength-box"><h6><i class="bi bi-arrow-up-circle"></i> KEKUATAN</h6>
        <ul class="body-sm mb-0">${(r.strengths.length ? r.strengths : [{nama:'Belum ada data cukup'}]).map(s => `<li>${escapeHtml(s.nama)}</li>`).join('')}</ul></div></div>
      <div class="col-md-6"><div class="weak-box"><h6><i class="bi bi-arrow-down-circle"></i> AREA PENGEMBANGAN</h6>
        <ul class="body-sm mb-0">${(r.weaknesses.length ? r.weaknesses : [{nama:'Belum ada data cukup'}]).map(s => `<li>${escapeHtml(s.nama)}</li>`).join('')}</ul></div></div>
    </div>
    <div class="insight-card mb-3"><h6><i class="bi bi-flag"></i> ACTION PLAN</h6><p class="body-sm mb-0">${escapeHtml(r.actionPlan)}</p></div>
    ${(r.narasi && (r.narasi.kelebihan.length || r.narasi.perbaikan.length)) ? `
      <div class="row g-3 mb-3">
        <div class="col-md-6"><div class="strength-box"><h6><i class="bi bi-hand-thumbs-up"></i> KELEBIHAN (MASUKAN PENILAI)</h6>
          <ul class="body-sm mb-0">${(r.narasi.kelebihan.length ? r.narasi.kelebihan : [{teks:'Belum ada masukan'}]).map(n => `<li>${escapeHtml(n.teks)}</li>`).join('')}</ul></div></div>
        <div class="col-md-6"><div class="weak-box"><h6><i class="bi bi-tools"></i> PERLU DIPERBAIKI (MASUKAN PENILAI)</h6>
          <ul class="body-sm mb-0">${(r.narasi.perbaikan.length ? r.narasi.perbaikan : [{teks:'Belum ada masukan'}]).map(n => `<li>${escapeHtml(n.teks)}</li>`).join('')}</ul></div></div>
      </div>` : ''}
    ${r.feedback.length ? `<div class="headline-md mb-2">Feedback Anonim</div>` + r.feedback.map(f => `
      <div class="feedback-card"><span class="pill-tag">${f.perspektif} Feedback</span><p class="quote mt-2 mb-0">"${escapeHtml(f.catatan)}"</p></div>`).join('') : ''}
    <div class="text-end mt-3">
      <button class="btn-primary-wf" onclick="downloadIndividualPdf('${karyawanId}')"><i class="bi bi-file-earmark-pdf"></i> Unduh PDF</button>
    </div>
  `;
  const footerEl = document.getElementById('reportModalFooter');
  if (footerEl) footerEl.innerHTML = `<button class="btn-outline-wf" data-bs-dismiss="modal">Tutup</button>`;

  const ctx = container.querySelector('#radarChart') || document.getElementById('radarChart');
  if (!ctx || !chartSiap()) return;
  if (chartInstances.radar) chartInstances.radar.destroy();
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  chartInstances.radar = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Self', 'Atasan', 'Peer', 'Bawahan'],
      datasets: [{ label: 'Skor', data: ['Self', 'Atasan', 'Peer', 'Bawahan'].map(p => r.perspectiveScores[p] || 0),
        backgroundColor: 'rgba(49,107,254,.2)', borderColor: '#316BFE', pointBackgroundColor: '#316BFE' }]
    },
    options: { responsive: true, scales: { r: { min: 0, max: 5, ticks: { stepSize: 1, color: isDark ? '#C3C5D8' : '#434655' }, grid: { color: isDark ? '#343649' : '#E7E7F4' }, pointLabels: { color: isDark ? '#F0F0FC' : '#191B24' } } }, plugins: { legend: { display: false } } }
  });
}
function downloadIndividualPdf(karyawanId) {
  showToast('Memproses', 'Sedang membuat PDF laporan...', 'info');
  GSR()
    .withSuccessHandler(res => {
      if (res && res.success) {
        showToast('Siap Diunduh', 'PDF berhasil dibuat.', 'success');
        const bin = atob(res.data.base64), bytes = new Uint8Array(bin.length);
        for (let n = 0; n < bin.length; n++) bytes[n] = bin.charCodeAt(n);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const a = document.createElement('a'); a.href = url; a.download = res.data.fileName || 'laporan.pdf';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else showToast('Gagal', res ? res.message : 'Tidak ada respons.', 'danger');
    })
    .withFailureHandler(err => showToast('Error', err.message, 'danger'))
    .generateIndividualReportPdf(appState.token, karyawanId, appState.periodeAktifId);
}

// ════════════════════════════════════════════════════════════
// AUDIT TRAIL
// ════════════════════════════════════════════════════════════
function loadAuditSection() {
  const sec = document.getElementById('section-audit');
  sec.innerHTML = `<span class="annotation">SPEC // AUDIT_TRAIL</span>
    <div class="table-responsive wf-card mt-3" style="padding:0;">
      <table class="wf-table"><thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Detail</th></tr></thead>
      <tbody id="auditTbody">${skeletonRows(6, 4)}</tbody></table>
    </div>`;
  fetchSWR('audit', 'getAuditTrail', [appState.token], res => {
      const tbody = document.getElementById('auditTbody');
      if (!tbody) return;
      tbody.innerHTML = res.data.map(a => `<tr><td class="annotation">${new Date(a.Timestamp).toLocaleString('id-ID')}</td><td>${escapeHtml(a.User_Email)}</td><td><span class="pill-tag">${a.Action}</span></td><td class="body-sm">${escapeHtml(a.Detail)}</td></tr>`).join('') ||
        `<tr><td colspan="4">${emptyState('bi-shield-check', 'Belum ada aktivitas', '')}</td></tr>`;
  });
}

// ════════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════════
function loadSettingsSection() {
  const sec = document.getElementById('section-settings');
  sec.innerHTML = `<div class="skel" style="height:300px;"></div>`;
  fetchSWR('config', 'getAllConfig', [appState.token], res => renderSettings(res.data));
}
function renderSettings(cfg) {
  const sec = document.getElementById('section-settings');
  sec.innerHTML = `
    <span class="annotation">SYS_CONFIG // APPCONFIG</span>
    <div class="wf-card mt-3" style="max-width:640px;">
      <div class="headline-md mb-3">Identitas Organisasi & Brand</div>
      <div class="mb-3"><label class="wf-label">Nama Perusahaan</label><input class="wf-input" id="cfg_companyName" value="${escapeHtml(cfg.companyName || '')}"></div>
      <div class="mb-3"><label class="wf-label">Nama Aplikasi</label><input class="wf-input" id="cfg_appName" value="${escapeHtml(cfg.appName || '')}"></div>
      <div class="mb-3"><label class="wf-label">Warna Utama (hex)</label><input class="wf-input" id="cfg_primaryColor" value="${escapeHtml(cfg.primaryColor || '#316BFE')}"></div>
      <div class="mb-3"><label class="wf-label">Logo (PNG/JPG/WEBP — diperkecil otomatis)</label>
        ${cfg.logoUrl && /^data:image\//.test(cfg.logoUrl) ? `<div class="mb-2"><img src="${cfg.logoUrl}" alt="" style="height:48px;max-width:160px;object-fit:contain;border:1px solid var(--wf-border);border-radius:var(--wf-radius);padding:4px;"></div>` : ''}
        <input type="file" class="wf-input" id="cfg_logoFile" accept="image/png,image/jpeg,image/webp,image/gif">
        <label class="d-flex gap-2 align-items-center body-sm mt-2"><input type="checkbox" id="cfg_logoHapus"> Hapus logo saat ini</label></div>
      <div class="mb-3"><label class="wf-label">Periode Aktif (default saat login)</label>
        <select class="wf-input" id="cfg_periodeAktif">${appState.periodeList.map(p => `<option value="${p.ID_Periode}" ${p.ID_Periode === cfg.periodeAktif ? 'selected' : ''}>${escapeHtml(p.Nama_Periode)}</option>`).join('')}</select>
      </div>
      <button class="btn-primary-wf" onclick="saveSettingsUi()">Simpan Pengaturan</button>
    </div>
    <div class="wf-card mt-3" style="max-width:640px;">
      <div class="headline-md mb-1">Otomatisasi</div>
      <p class="body-sm text-muted">Akun login disinkronkan otomatis setiap admin membuka aplikasi. Aktifkan trigger agar sinkronisasi juga berjalan <b>seketika saat Master Karyawan diedit di Google Sheets</b>, tiap jam, serta reminder harian pukul 08.00.</p>
      <div id="otoStatus" class="body-sm mb-2 text-muted">Memeriksa status…</div>
      <button class="btn-primary-wf" onclick="aktifkanOtomatisasiUi()"><i class="bi bi-lightning-charge"></i> Aktifkan / Perbarui Otomatisasi</button>
    </div>
    <div class="wf-card mt-3" style="max-width:640px;">
      <div class="headline-md mb-1">Sinkronisasi Akun & Pembersihan Data</div>
      <p class="body-sm text-muted">Gunakan setelah Master Karyawan diubah atau ditempel langsung di Google Sheets. Akun login dicocokkan lewat <b>email</b>. Semua tindakan menampilkan pratinjau dulu sebelum dijalankan.</p>
      <div class="d-flex gap-2 flex-wrap">
        <button class="btn-outline-wf" onclick="previewSinkronAkun()"><i class="bi bi-people"></i> Sinkronkan Akun Login</button>
        <button class="btn-outline-wf" onclick="previewBersihData()"><i class="bi bi-eraser"></i> Bersihkan Data Contoh / Yatim</button>
      </div>
    </div>`;
  loadOtoStatus();
}
function loadOtoStatus() {
  GSR(true).withSuccessHandler(res => { if (res && res.success) renderOtoStatus(res.data); else { const el = document.getElementById('otoStatus'); if (el) el.textContent = 'Status trigger tidak dapat dibaca.'; } })
    .withFailureHandler(() => {}).getStatusOtomatisasi(appState.token);
}
function renderOtoStatus(s) {
  const el = document.getElementById('otoStatus'); if (!el) return;
  if (!s || !s.diketahui) { el.textContent = 'Status trigger belum dapat dibaca (izin belum diberikan). Klik tombol di bawah atau jalankan aktifkanOtomatisasi dari editor Apps Script.'; return; }
  const row = (ok, t) => `<div>${ok ? '<span style="color:#166534">✔</span>' : '<span style="color:#BA1A1A">✘</span>'} ${t}</div>`;
  el.innerHTML = row(s.sinkronEdit, 'Sinkron akun saat Master Karyawan diedit') + row(s.sinkronJam, 'Sinkron akun tiap jam') + row(s.reminder, 'Reminder harian 08.00');
}
function aktifkanOtomatisasiUi() {
  GSR().withSuccessHandler(res => {
    if (res && res.success) { showToast('Berhasil', res.message, 'success'); renderOtoStatus(res.data); }
    else showToast('Belum bisa', res ? res.message : 'Tidak ada respons.', 'danger');
  }).withFailureHandler(err => showToast('Error', err.message, 'danger')).aktifkanOtomatisasiAdmin(appState.token);
}
function saveSettingsUi() {
  const fileInput = document.getElementById('cfg_logoFile');
  const payload = {
    companyName: document.getElementById('cfg_companyName').value.trim(),
    appName: document.getElementById('cfg_appName').value.trim(),
    primaryColor: document.getElementById('cfg_primaryColor').value.trim(),
    periodeAktif: document.getElementById('cfg_periodeAktif').value
  };
  const doSave = () => {
    GSR()
      .withSuccessHandler(res => {
        showToast(res.success ? 'Berhasil' : 'Gagal', res.message, res.success ? 'success' : 'danger');
        if (res.success) { appState.config = Object.assign(appState.config, payload); applyBranding(appState.config); loadSettingsSection(); }
      })
      .withFailureHandler(err => showToast('Error', err.message, 'danger'))
      .saveSettings(appState.token, payload);
  };
  const hapus = document.getElementById('cfg_logoHapus');
  if (hapus && hapus.checked) { payload.logoUrl = ''; doSave(); return; }
  if (fileInput.files && fileInput.files[0]) {
    resizeLogo(fileInput.files[0]).then(uri => { payload.logoUrl = uri; doSave(); })
      .catch(err => showToast('Logo', err.message, 'warning'));
  } else {
    doSave();
  }
}

// ════════════════════════════════════════════════════════════
// PORTAL SAYA (STAFF) — Penilaian Saya
// ════════════════════════════════════════════════════════════
function loadPortalSection() {
  const sec = document.getElementById('section-portal');
  if (!appState.periodeAktifId) { sec.innerHTML = emptyState('bi-calendar-x', 'Belum ada periode aktif', 'Hubungi Admin HR.'); return; }
  sec.innerHTML = `
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
      <span class="annotation">EVAL // PORTAL_PENILAIAN</span>
      ${periodeSelectorHtml('portalPeriodeSel')}
    </div>
    <div id="portalStats" class="row g-3 mb-3"></div>
    <div id="portalList">${skeletonRows(3, 1)}</div>`;

  fetchSWR('portal|' + appState.periodeAktifId, 'getMyAssignments', [appState.token, appState.periodeAktifId], res => renderPortalList(res.data));
}
function renderPortalList(list) {
  const total = list.length;
  const done = list.filter(m => m.Status === 'Submitted').length;
  document.getElementById('portalStats').innerHTML = `
    ${statCard('bi-clipboard-check', total, 'Total Penugasan')}
    ${statCard('bi-check-circle', done, 'Selesai Disubmit')}
    ${statCard('bi-hourglass-split', total - done, 'Belum Selesai')}
    ${statCard('bi-percent', total ? Math.round(done / total * 100) + '%' : '0%', 'Progress')}
  `;
  const listEl = document.getElementById('portalList');
  if (!total) { listEl.innerHTML = emptyState('bi-inbox', 'Belum ada penugasan', 'Anda belum ditugaskan untuk menilai siapa pun pada periode ini.'); return; }

  const statusPill = { Pending: 'pill-pending', Draft: 'pill-draft', Submitted: 'pill-done' };
  listEl.innerHTML = list.map(m => `
    <div class="wf-card mb-3">
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-3">
        <div class="d-flex gap-3 align-items-center">
          <div class="box-x"></div>
          <div>
            <div class="label-md">${escapeHtml(m.NamaDinilai)} ${m.ID_Karyawan_Dinilai === appState.user.karyawanId ? '<span class="pill-tag">Self-Assessment</span>' : ''}</div>
            <div class="body-sm text-muted">${escapeHtml(m.Posisi)} · ${escapeHtml(m.Departemen)}</div>
            <span class="pill-tag mt-1 d-inline-block">${m.Perspektif}</span>
          </div>
        </div>
        <div class="text-end" style="min-width:160px;">
          <span class="pill ${statusPill[m.Status]}">${m.Status}</span>
          <div class="wf-progress mt-2" style="width:140px;"><div style="width:${m.ParamTotal ? (m.ParamTerisi/m.ParamTotal*100) : 0}%"></div></div>
          <div class="annotation mt-1">${m.ParamTerisi}/${m.ParamTotal} TERISI</div>
        </div>
        <button class="btn-primary-wf" onclick="openFormPenilaian('${m.ID_Mapping}')">
          ${m.Status === 'Submitted' ? 'Lihat Tanda Terima' : (m.Status === 'Draft' ? 'Lanjutkan Nilai' : 'Mulai Nilai')} <i class="bi bi-arrow-right-short"></i>
        </button>
      </div>
    </div>`).join('');
}

// ════════════════════════════════════════════════════════════
// FORM PENILAIAN (Dynamic Likert Scoring)
// ════════════════════════════════════════════════════════════
const LEVEL_LABELS = ['Timbul problem', 'Perlu perbaikan', 'Capai standar', 'Lebih standar', 'Luar biasa'];
const EMPTY_NARASI = { k1: '', k2: '', k3: '', p1: '', p2: '', p3: '' };

function openFormPenilaian(mappingId) {
  appState.previewMode = false;
  appState.currentMappingId = mappingId;
  navigateTo('formPenilaian');
  const sec = document.getElementById('section-formPenilaian');
  sec.innerHTML = `<div class="skel" style="height:400px;"></div>`;
  GSR()
    .withSuccessHandler(res => {
      if (!res.success) { sec.innerHTML = `<p>${escapeHtml(res.message)}</p>`; return; }
      appState.currentFormData = res.data;
      appState.pendingResponses = Object.assign({}, res.data.responses);
      appState.pendingNarasi = Object.assign({}, EMPTY_NARASI, res.data.narasi);
      renderFormPenilaian(res.data);
    })
    .withFailureHandler(err => sec.innerHTML = `<p>${escapeHtml(err.message)}</p>`)
    .getFormForMapping(appState.token, mappingId);
}

function computeRunningScore() {
  const params = appState.currentFormData.params;
  let sumW = 0, sumWS = 0, filled = 0;
  params.forEach(p => {
    const r = appState.pendingResponses[p.ID_Parameter];
    if (r && r.Skor) {
      const w = Number(p.Bobot) || 1;
      sumW += w; sumWS += w * Number(r.Skor); filled++;
    }
  });
  return { score: sumW ? (sumWS / sumW) : 0, filled, total: params.length };
}

function formatBobot(b) { return (Number(b) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%'; }
function formatSkorBobot(b, nilai) { return (Number(b) * Number(nilai)).toLocaleString('id-ID', { minimumFractionDigits: 3, maximumFractionDigits: 3 }); }

function renderFormPenilaian(data) {
  const sec = document.getElementById('section-formPenilaian');
  const { mapping, target, params, locked, formTitle, penilaiNama } = data;
  const running = computeRunningScore();
  const n = appState.pendingNarasi;
  const dis = locked ? 'disabled' : '';
  const narasiInput = (key, no) => `
    <div class="narasi-row"><span class="narasi-no">${no}.</span>
      <input type="text" class="wf-input" maxlength="500" id="narasi_${key}" value="${escapeHtml(n[key] || '')}" ${dis}
        placeholder="Tuliskan poin ${no}..." oninput="updateNarasi('${key}', this.value)"></div>`;

  sec.innerHTML = `
    <div class="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-3">
      <div>
        <span class="annotation">MODULE_REF: FORM_PENILAIAN // ${escapeHtml(mapping.Perspektif).toUpperCase()}</span>
        <div class="headline-lg mt-1">${escapeHtml(formTitle || 'Performance Appraisal')}</div>
      </div>
      <button class="btn-ghost-wf" onclick="navigateTo('${data.backTo || 'portal'}')"><i class="bi bi-arrow-left"></i> Kembali${data.backTo ? '' : ' ke Daftar'}</button>
    </div>
    <div class="form-identity mb-3">
      <div><span class="annotation">Karyawan yang dinilai</span><div class="label-md">${escapeHtml(target.Nama)}</div></div>
      <div><span class="annotation">Dept / Jabatan</span><div class="label-md">${escapeHtml(target.Departemen)} · ${escapeHtml(target.Posisi)}</div></div>
      <div><span class="annotation">Penilai</span><div class="label-md">${escapeHtml(penilaiNama || '')} <span class="pill-tag">${escapeHtml(mapping.Perspektif)}</span></div></div>
    </div>
    ${data.preview ? `<div class="pill pill-draft mb-3"><i class="bi bi-eye"></i>&nbsp; MODE PRATINJAU — simulasi pengisian, tidak ada data yang disimpan.</div>` : ''}
    ${locked ? `<div class="pill pill-done mb-3"><i class="bi bi-check-circle"></i>&nbsp; Formulir sudah disubmit & dikunci pada ${new Date(mapping.Tgl_Submit).toLocaleString('id-ID')}</div>` : ''}
    <div class="row">
      <div class="col-lg-8">
        <div class="form-category"><i class="bi bi-person-badge"></i> KARAKTER PRIBADI</div>
        <div id="paramListContainer"></div>
        <div class="param-card">
          <div class="headline-md"><i class="bi bi-hand-thumbs-up"></i> Kelebihan karyawan</div>
          <p class="body-sm text-muted">Menurut Anda, hal-hal apa saja yang menjadi kelebihan karyawan ybs?</p>
          ${['k1', 'k2', 'k3'].map((k, i) => narasiInput(k, i + 1)).join('')}
        </div>
        <div class="param-card">
          <div class="headline-md"><i class="bi bi-tools"></i> Hal yang masih harus diperbaiki</div>
          <p class="body-sm text-muted">Menurut Anda, hal-hal apa saja yang masih harus diperbaiki oleh karyawan ybs?</p>
          ${['p1', 'p2', 'p3'].map((k, i) => narasiInput(k, i + 1)).join('')}
        </div>
      </div>
      <div class="col-lg-4">
        <div class="running-score-card">
          <div class="annotation">TOTAL SKOR (BOBOT × NILAI)</div>
          <div class="running-score-value" id="runningScoreValue">${running.score.toFixed(2)} / 5.00</div>
          <div class="running-score-bar"><div style="width:${running.score / 5 * 100}%"></div></div>
          <div class="body-sm text-muted mt-2" id="runningScoreCount">${running.filled} dari ${running.total} parameter terisi</div>
          <table class="score-summary mt-3"><tbody>
            ${params.map(p => `<tr><td>${p.Urutan}. ${escapeHtml(p.Nama_Parameter)}</td><td>${formatBobot(p.Bobot)}</td><td id="sum-${p.ID_Parameter}">—</td></tr>`).join('')}
          </tbody></table>
          ${!locked ? `
            <button class="btn-outline-wf w-100 mt-3" onclick="saveDraftUi(false)">Simpan Draft</button>
            <button class="btn-primary-wf w-100 mt-2" onclick="confirmSubmitForm()">Submit & Kunci</button>
          ` : `<div class="body-sm text-muted mt-3"><i class="bi bi-check-circle"></i> Penilaian Anda sudah tercatat. Terima kasih.</div>`}
        </div>
      </div>
    </div>`;

  document.getElementById('paramListContainer').innerHTML = params.map(p => renderParamCard(p, locked)).join('');
  params.forEach(p => updateParamSummary(p.ID_Parameter));
}

function renderParamCard(p, locked) {
  const resp = appState.pendingResponses[p.ID_Parameter] || {};
  const selected = Number(resp.Skor) || 0;
  const opts = [1, 2, 3, 4, 5].map(v => {
    const lines = String(p['Level_' + v] || '').split('\n').filter(x => x.trim());
    return `
    <div class="rubric-opt ${selected === v ? 'selected' : ''}" data-param="${p.ID_Parameter}" data-val="${v}"
      ${locked ? '' : `role="radio" tabindex="0" onclick="selectLikert('${p.ID_Parameter}', ${v}, this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectLikert('${p.ID_Parameter}', ${v}, this)}"`}>
      <div class="rubric-num">${v}</div>
      <div class="rubric-body">
        <div class="rubric-title">${LEVEL_LABELS[v - 1]}</div>
        ${lines.map(l => `<div class="rubric-line">${escapeHtml(l)}</div>`).join('')}
      </div>
    </div>`;
  }).join('');
  return `
    <div class="param-card ${selected ? 'answered' : ''}" id="paramcard-${p.ID_Parameter}">
      <div class="d-flex justify-content-between align-items-start gap-2">
        <div class="headline-md">${p.Urutan}. ${escapeHtml(p.Nama_Parameter)}</div>
        <span class="pill-tag" style="white-space:nowrap;">Bobot ${formatBobot(p.Bobot)}</span>
      </div>
      <p class="body-sm text-muted" style="font-style:italic;">${escapeHtml(p.Deskripsi)}</p>
      <div class="rubric-list" role="radiogroup" aria-label="${escapeHtml(p.Nama_Parameter)}">${opts}</div>
      <div class="rubric-result body-sm" id="result-${p.ID_Parameter}"></div>
      <textarea class="wf-input mt-2" rows="2" placeholder="Catatan / contoh perilaku (opsional)..."
        ${locked ? 'disabled' : `oninput="updateCatatan('${p.ID_Parameter}', this.value)"`}>${escapeHtml(resp.Catatan || '')}</textarea>
    </div>`;
}

function updateParamSummary(paramId) {
  const p = appState.currentFormData.params.find(x => x.ID_Parameter === paramId);
  const r = appState.pendingResponses[paramId];
  const sumEl = document.getElementById('sum-' + paramId);
  const resEl = document.getElementById('result-' + paramId);
  if (r && r.Skor) {
    if (sumEl) sumEl.textContent = r.Skor + ' → ' + formatSkorBobot(p.Bobot, r.Skor);
    if (resEl) resEl.innerHTML = `Nilai <b>${r.Skor}</b> (${LEVEL_LABELS[r.Skor - 1]}) × bobot ${formatBobot(p.Bobot)} = skor <b>${formatSkorBobot(p.Bobot, r.Skor)}</b>`;
  } else {
    if (sumEl) sumEl.textContent = '—';
    if (resEl) resEl.textContent = 'Belum dinilai — pilih salah satu level di atas.';
  }
}

function selectLikert(paramId, val, el) {
  appState.pendingResponses[paramId] = Object.assign({}, appState.pendingResponses[paramId], { Skor: val });
  // Optimistic UI instant update (gas-instant-ux)
  const card = document.getElementById('paramcard-' + paramId);
  card.querySelectorAll('.rubric-opt').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
  card.classList.add('answered');
  updateParamSummary(paramId);
  updateRunningScoreUi();
  scheduleAutoSaveDraft();
}
function updateCatatan(paramId, val) {
  appState.pendingResponses[paramId] = Object.assign({}, appState.pendingResponses[paramId], { Catatan: val });
  scheduleAutoSaveDraft();
}
function updateNarasi(key, val) {
  appState.pendingNarasi[key] = val;
  scheduleAutoSaveDraft();
}
function updateRunningScoreUi() {
  const running = computeRunningScore();
  document.getElementById('runningScoreValue').textContent = running.score.toFixed(2) + ' / 5.00';
  document.querySelector('.running-score-bar > div').style.width = (running.score / 5 * 100) + '%';
  document.getElementById('runningScoreCount').textContent = running.filled + ' dari ' + running.total + ' parameter terisi';
}
function scheduleAutoSaveDraft() {
  if (appState.previewMode) return;
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => saveDraftUi(true), 1500);
}
function buildResponsesArray() {
  return Object.keys(appState.pendingResponses)
    .filter(pid => appState.pendingResponses[pid].Skor)
    .map(pid => ({ ID_Parameter: pid, Skor: appState.pendingResponses[pid].Skor, Catatan: appState.pendingResponses[pid].Catatan || '' }));
}
function hasNarasi() {
  return Object.keys(appState.pendingNarasi || {}).some(k => String(appState.pendingNarasi[k] || '').trim());
}
function saveDraftUi(silent) {
  if (appState.previewMode) { if (!silent) showToast('Mode Pratinjau', 'Simulasi saja — tidak disimpan.', 'info'); return; }
  const arr = buildResponsesArray();
  if (!arr.length && !hasNarasi()) return;
  GSR()
    .withSuccessHandler(res => { if (!silent || !res.success) showToast(res.success ? 'Draft Tersimpan' : 'Gagal', res.message, res.success ? 'success' : 'danger'); })
    .withFailureHandler(err => { if (!silent) showToast('Error', err.message, 'danger'); })
    .saveDraftResponses(appState.token, appState.currentMappingId, arr, appState.pendingNarasi);
}
function confirmSubmitForm() {
  if (appState.previewMode) { showToast('Mode Pratinjau', 'Simulasi saja — formulir tidak dikirim.', 'info'); return; }
  const running = computeRunningScore();
  if (running.filled < running.total) {
    showToast('Belum Lengkap', `${running.total - running.filled} parameter belum dinilai.`, 'warning');
    const first = appState.currentFormData.params.find(p => !(appState.pendingResponses[p.ID_Parameter] || {}).Skor);
    if (first) document.getElementById('paramcard-' + first.ID_Parameter).scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  openConfirm('Submit Penilaian', 'Setelah disubmit, formulir ini akan dikunci dan tidak dapat diubah lagi. Lanjutkan?', () => {
    const arr = buildResponsesArray();
    GSR()
      .withSuccessHandler(res => {
        if (res.success) { showToast('Berhasil', res.message, 'success'); openFormPenilaian(appState.currentMappingId); }
        else showToast('Gagal', res.message, 'danger');
      })
      .withFailureHandler(err => showToast('Error', err.message, 'danger'))
      .submitForm(appState.token, appState.currentMappingId, arr, appState.pendingNarasi);
  });
}

// ════════════════════════════════════════════════════════════
// FORMULIR PENILAIAN (ADMIN) — status data, daftar parameter, pratinjau
// ════════════════════════════════════════════════════════════
function loadFormulirSection() {
  const sec = document.getElementById('section-formulir');
  EDIT = null;
  if (!appState.cache['formulir']) sec.innerHTML = `<div class="skel" style="height:300px;"></div>`;
  fetchSWR('formulir', 'getFormTemplatePreview', [appState.token], res => {
    if (EDIT) return; // jangan menimpa editor yang sedang dipakai
    appState.formulirData = res.data;
    renderFormulirSection(appState.formulirTab || 'STAFF');
  }, msg => { sec.innerHTML = emptyState('bi-exclamation-triangle', 'Gagal memuat formulir', escapeHtml(msg)); });
}

function renderFormulirSection(tab) {
  appState.formulirTab = tab;
  const d = appState.formulirData, st = d.status, sec = document.getElementById('section-formulir');
  const issues = [];
  if (st.perluPeriode) issues.push('Belum ada periode penilaian');
  if (st.perluMigrasi) issues.push('Formulir Performance Appraisal 2025 belum terpasang di database');
  if (st.perluMapping) issues.push('Belum ada penugasan penilai pada periode aktif');
  const params = d.templates[tab] || [];
  const totalBobot = params.reduce((a, p) => a + Number(p.Bobot || 0), 0);

  sec.innerHTML = `
    <span class="annotation">EVAL // FORMULIR_PENILAIAN</span>
    <div class="row g-3 my-1">
      ${statCard('bi-calendar-range', st.periode, 'Periode')}
      ${statCard('bi-people', st.karyawan, 'Karyawan Aktif')}
      ${statCard('bi-diagram-3', st.mapping, 'Penugasan (periode aktif)')}
      ${statCard('bi-ui-checks-grid', st.paramStaff + ' + ' + st.paramManager, 'Parameter Staff + Manager')}
    </div>
    ${issues.length ? `
      <div class="insight-card my-3" style="border-color:var(--wf-warn-text);">
        <h6 style="color:var(--wf-warn-text);"><i class="bi bi-exclamation-triangle"></i> PERLU DIPERBAIKI</h6>
        <ul>${issues.map(x => `<li>${x}</li>`).join('')}</ul>
        <button class="btn-primary-wf mt-2" id="btnFixData" onclick="runPerbaikiDataAwal()"><i class="bi bi-wrench-adjustable"></i> Perbaiki Data Awal (1 klik)</button>
      </div>` : `<div class="pill pill-done my-3"><i class="bi bi-check-circle"></i>&nbsp; Data awal & formulir sudah lengkap.</div>`}
    <div class="d-flex gap-2 flex-wrap mb-3">
      <button class="${tab === 'STAFF' ? 'btn-primary-wf' : 'btn-outline-wf'}" onclick="renderFormulirSection('STAFF')">Staff / Admin Office</button>
      <button class="${tab === 'MANAGER' ? 'btn-primary-wf' : 'btn-outline-wf'}" onclick="renderFormulirSection('MANAGER')">SPV / Manager / GM</button>
      <span class="ms-auto d-flex gap-2 flex-wrap">
        <button class="btn-outline-wf" onclick="openParamEditor('${tab}')"><i class="bi bi-pencil-square"></i> Edit Parameter & Bobot</button>
        ${params.length ? `<button class="btn-ghost-wf" onclick="openFormPreview('${tab}')"><i class="bi bi-eye"></i> Pratinjau & coba isi formulir</button>` : ''}
      </span>
    </div>
    ${params.length ? `
    <div class="wf-card-tight" style="overflow-x:auto;">
      <div class="headline-md mb-2">${escapeHtml(d.titles[tab] || '')}</div>
      <table class="table table-sm mb-0"><thead><tr><th>No</th><th>Parameter</th><th>Deskripsi</th><th class="text-end">Bobot</th></tr></thead>
      <tbody>${params.map(p => `<tr><td>${p.Urutan}</td><td><b>${escapeHtml(p.Nama_Parameter)}</b></td><td class="body-sm text-muted">${escapeHtml(p.Deskripsi)}</td><td class="text-end">${formatBobot(p.Bobot)}</td></tr>`).join('')}
      <tr><td></td><td colspan="2"><b>TOTAL BOBOT</b></td><td class="text-end"><b>${formatBobot(totalBobot)}</b></td></tr></tbody></table>
    </div>` : emptyState('bi-ui-checks-grid', 'Formulir belum terpasang', 'Klik "Perbaiki Data Awal" di atas untuk memasang formulir.')}`;
}

function runPerbaikiDataAwal() {
  const btn = document.getElementById('btnFixData');
  if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }
  GSR()
    .withSuccessHandler(res => {
      if (!res || !res.success) {
        showToast('Gagal', res ? res.message : 'Server tidak mengirim respons.', 'danger');
        if (btn) { btn.disabled = false; btn.textContent = 'Perbaiki Data Awal (1 klik)'; }
        return;
      }
      showToast('Berhasil', res.message, 'success');
      setTimeout(refreshAppInPlace, 1200); // baca ulang periode aktif tanpa memuat ulang halaman
    })
    .withFailureHandler(err => {
      showToast('Error', err.message, 'danger');
      if (btn) { btn.disabled = false; btn.textContent = 'Perbaiki Data Awal (1 klik)'; }
    })
    .perbaikiDataAwal(appState.token);
}

// ════════════════════════════════════════════════════════════
// EDITOR PARAMETER & BOBOT (ADMIN)
// ════════════════════════════════════════════════════════════
let EDIT = null; // { type, items:[{...,Bobot(%)}], orig:{id:{Bobot,Aktif}}, dirty }
function edRound2(v) { return Math.round(Number(v) * 100) / 100; }
function openParamEditor(type) {
  const sec = document.getElementById('section-formulir');
  sec.innerHTML = `<div class="skel" style="height:300px;"></div>`;
  GSR()
    .withSuccessHandler(res => {
      if (!res || !res.success) { showToast('Gagal', res ? res.message : 'Tidak ada respons.', 'danger'); loadFormulirSection(); return; }
      const items = (res.data.templates[type] || []).map(x => Object.assign({}, x, { Bobot: edRound2(Number(x.Bobot) * 100), _baru: false }));
      const orig = {}; items.forEach(x => orig[x.ID_Parameter] = { Bobot: x.Bobot, Aktif: x.Aktif });
      EDIT = { type: type, title: res.data.titles[type] || type, items: items, orig: orig, dirty: false };
      renderParamEditor();
    })
    .withFailureHandler(err => { showToast('Error', err.message, 'danger'); loadFormulirSection(); })
    .getFormEditorData(appState.token);
}
function edTotal() { return edRound2(EDIT.items.reduce((a, x) => a + (x.Aktif === 'Ya' ? (Number(x.Bobot) || 0) : 0), 0)); }
function edUpdateTotal() {
  const el = document.getElementById('edTotal'); if (!el) return;
  const t = edTotal(), ok = Math.abs(t - 100) < 0.05, diff = edRound2(100 - t);
  el.className = 'ed-total ' + (ok ? 'ok' : 'warn');
  el.textContent = 'Total bobot aktif: ' + t + '%' + (ok ? ' ✔' : (diff > 0 ? ' · kurang ' + diff + '%' : ' · lebih ' + Math.abs(diff) + '%'));
}
function edCard(x, i, n) {
  const lv = [1, 2, 3, 4, 5].map(k => `<div class="ed-level"><label class="wf-label">Level ${k} — ${LEVEL_LABELS[k - 1]}</label>
      <textarea class="wf-input" rows="3" oninput="edSet(${i},'Level_${k}',this.value)">${escapeHtml(x['Level_' + k] || '')}</textarea></div>`).join('');
  return `<div class="param-card ed-card ${x.Aktif === 'Ya' ? '' : 'ed-off'}" id="edcard-${i}">
    <div class="ed-head">
      <span class="pill-tag">#${i + 1}</span>
      ${x._baru ? '<span class="pill-tag">BARU</span>' : ''}
      ${x.jawaban ? `<span class="pill-tag" title="Jawaban yang sudah masuk untuk parameter ini">${x.jawaban} jawaban</span>` : ''}
      <div class="ed-tools">
        <button class="btn-sm-icon" title="Naikkan" ${i === 0 ? 'disabled' : ''} onclick="edMove(${i},-1)"><i class="bi bi-arrow-up"></i></button>
        <button class="btn-sm-icon" title="Turunkan" ${i === n - 1 ? 'disabled' : ''} onclick="edMove(${i},1)"><i class="bi bi-arrow-down"></i></button>
        <label class="d-flex gap-1 align-items-center body-sm mb-0"><input type="checkbox" ${x.Aktif === 'Ya' ? 'checked' : ''} onchange="edToggle(${i})"> Aktif</label>
        ${x._baru ? `<button class="btn-sm-icon" style="color:var(--wf-error)" title="Hapus" onclick="edHapus(${i})"><i class="bi bi-trash"></i></button>` : ''}
      </div>
    </div>
    <div class="ed-grid">
      <div><label class="wf-label">Nama parameter</label><input class="wf-input" maxlength="120" value="${escapeHtml(x.Nama_Parameter)}" oninput="edSet(${i},'Nama_Parameter',this.value)"></div>
      <div><label class="wf-label">Bobot (%)</label><input class="wf-input" type="number" min="0" max="100" step="0.5" value="${x.Bobot}" oninput="edBobot(${i},this.value)"></div>
    </div>
    <label class="wf-label mt-2">Deskripsi / definisi</label>
    <textarea class="wf-input" rows="2" maxlength="600" oninput="edSet(${i},'Deskripsi',this.value)">${escapeHtml(x.Deskripsi || '')}</textarea>
    <details><summary>Rubrik penilaian level 1–5</summary>${lv}</details>
  </div>`;
}
function renderParamEditor() {
  const sec = document.getElementById('section-formulir'), n = EDIT.items.length;
  sec.innerHTML = `
    <div class="ed-bar">
      <div><span class="annotation">EDIT // PARAMETER_FORMULIR</span><div class="headline-md">${escapeHtml(EDIT.title)}</div></div>
      <div class="ed-total" id="edTotal"></div>
      <div class="d-flex gap-2 flex-wrap">
        <button class="btn-ghost-wf" onclick="edBagiRata()">Bagi rata</button>
        <button class="btn-ghost-wf" onclick="edNormalisasi()">Normalisasi ke 100%</button>
        <button class="btn-outline-wf" onclick="edBatal()">Batal</button>
        <button class="btn-primary-wf" onclick="edSimpan()"><i class="bi bi-check2"></i> Simpan</button>
      </div>
    </div>
    <p class="body-sm text-muted">Total bobot semua parameter <b>aktif</b> harus tepat 100%. Parameter tidak dihapus, hanya dinonaktifkan, sehingga jawaban lama tetap tersimpan. Perubahan berlaku untuk formulir berikutnya; skor yang sudah dihitung berubah setelah "Hitung Ulang Skor".</p>
    <div id="edList">${EDIT.items.map((x, i) => edCard(x, i, n)).join('')}</div>
    <button class="btn-outline-wf mt-2 mb-4" onclick="edTambah()"><i class="bi bi-plus-lg"></i> Tambah Parameter</button>`;
  edUpdateTotal();
}
function edSet(i, f, v) { EDIT.items[i][f] = v; EDIT.dirty = true; }
function edBobot(i, v) { EDIT.items[i].Bobot = v === '' ? 0 : Number(v); EDIT.dirty = true; edUpdateTotal(); }
function edToggle(i) { EDIT.items[i].Aktif = EDIT.items[i].Aktif === 'Ya' ? 'Tidak' : 'Ya'; EDIT.dirty = true; renderParamEditor(); }
function edMove(i, d) { const j = i + d; if (j < 0 || j >= EDIT.items.length) return; const t = EDIT.items[i]; EDIT.items[i] = EDIT.items[j]; EDIT.items[j] = t; EDIT.dirty = true; renderParamEditor(); }
function edTambah() {
  EDIT.items.push({ ID_Parameter: '', Nama_Parameter: '', Deskripsi: '', Bobot: 0, Level_1: '', Level_2: '', Level_3: '', Level_4: '', Level_5: '', Aktif: 'Ya', jawaban: 0, _baru: true });
  EDIT.dirty = true; renderParamEditor();
  const el = document.getElementById('edcard-' + (EDIT.items.length - 1)); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function edHapus(i) { if (EDIT.items[i]._baru) { EDIT.items.splice(i, 1); EDIT.dirty = true; renderParamEditor(); } }
function edAktif() { return EDIT.items.filter(x => x.Aktif === 'Ya'); }
function edBagiRata() {
  const a = edAktif(); if (!a.length) return;
  const each = Math.floor(10000 / a.length) / 100;
  a.forEach(x => x.Bobot = each);
  a[0].Bobot = edRound2(a[0].Bobot + (100 - each * a.length));
  EDIT.dirty = true; renderParamEditor();
}
function edNormalisasi() {
  const a = edAktif(); if (!a.length) return;
  const s = a.reduce((t, x) => t + (Number(x.Bobot) || 0), 0);
  if (s <= 0) { edBagiRata(); return; }
  a.forEach(x => x.Bobot = Math.floor((Number(x.Bobot) || 0) * 10000 / s) / 100);
  const sisa = edRound2(100 - a.reduce((t, x) => t + x.Bobot, 0));
  const terbesar = a.reduce((m, x) => x.Bobot > m.Bobot ? x : m, a[0]);
  terbesar.Bobot = edRound2(terbesar.Bobot + sisa);
  EDIT.dirty = true; renderParamEditor();
}
function edBatal() {
  if (EDIT && EDIT.dirty) openConfirm('Buang perubahan?', 'Perubahan parameter yang belum disimpan akan hilang.', () => loadFormulirSection());
  else loadFormulirSection();
}
function edValidasi() {
  const a = edAktif();
  if (!a.length) return 'Minimal satu parameter harus aktif.';
  for (let i = 0; i < EDIT.items.length; i++) {
    const x = EDIT.items[i];
    if (!String(x.Nama_Parameter || '').trim()) return `Parameter #${i + 1}: nama wajib diisi.`;
    if (!(Number(x.Bobot) >= 0 && Number(x.Bobot) <= 100)) return `"${x.Nama_Parameter}": bobot harus 0–100%.`;
    if (x.Aktif === 'Ya' && [1, 2, 3, 4, 5].some(k => !String(x['Level_' + k] || '').trim())) return `"${x.Nama_Parameter}": rubrik level 1–5 wajib diisi untuk parameter aktif.`;
  }
  const t = edTotal();
  if (Math.abs(t - 100) >= 0.05) return `Total bobot aktif harus 100% (saat ini ${t}%). Gunakan "Normalisasi ke 100%" bila perlu.`;
  return null;
}
function edSimpan() {
  const err = edValidasi();
  if (err) { showToast('Belum bisa disimpan', err, 'warning'); return; }
  const terdampak = EDIT.items.filter(x => !x._baru && x.jawaban > 0 && EDIT.orig[x.ID_Parameter] &&
    (EDIT.orig[x.ID_Parameter].Aktif !== x.Aktif || Math.abs(EDIT.orig[x.ID_Parameter].Bobot - Number(x.Bobot)) > 0.001));
  const kirim = () => {
    const items = EDIT.items.map(x => ({ ID_Parameter: x.ID_Parameter, Nama_Parameter: String(x.Nama_Parameter).trim(), Deskripsi: x.Deskripsi || '',
      Bobot: Math.round(Number(x.Bobot) * 100) / 10000, Aktif: x.Aktif, Level_1: x.Level_1, Level_2: x.Level_2, Level_3: x.Level_3, Level_4: x.Level_4, Level_5: x.Level_5 }));
    GSR()
      .withSuccessHandler(res => {
        if (res && res.success) { showToast('Tersimpan', res.message, 'success'); EDIT = null; loadFormulirSection(); }
        else showToast('Gagal', res ? res.message : 'Tidak ada respons.', 'danger');
      })
      .withFailureHandler(e => showToast('Error', e.message, 'danger'))
      .saveParameterForm(appState.token, EDIT.type, items);
  };
  if (terdampak.length) openConfirm('Bobot/status berubah untuk parameter yang sudah dijawab',
    `${terdampak.map(x => '“' + x.Nama_Parameter + '” (' + x.jawaban + ' jawaban)').join(', ')}. Skor yang sudah dihitung baru berubah setelah "Hitung Ulang Skor" atau penutupan periode. Lanjutkan menyimpan?`, kirim);
  else kirim();
}

function openFormPreview(type) {
  const d = appState.formulirData, params = d.templates[type] || [];
  appState.previewMode = true;
  appState.currentMappingId = null;
  appState.pendingResponses = {};
  appState.pendingNarasi = Object.assign({}, EMPTY_NARASI);
  const data = {
    preview: true, backTo: 'formulir', locked: false, params, formType: type,
    formTitle: d.titles[type],
    penilaiNama: appState.user ? appState.user.nama : '',
    mapping: { Perspektif: 'Pratinjau', Tgl_Submit: null, ID_Karyawan_Dinilai: '' },
    target: { Nama: '(Contoh) Nama Karyawan', Departemen: 'Departemen', Posisi: type === 'STAFF' ? 'Staff / Admin Office' : 'SPV / Manager / GM' }
  };
  appState.currentFormData = data;
  navigateTo('formPenilaian');
  renderFormPenilaian(data);
}

// ════════════════════════════════════════════════════════════
// HASIL & FEEDBACK SAYA (EMPLOYEE)
// ════════════════════════════════════════════════════════════
function loadHasilSayaSection() {
  const sec = document.getElementById('section-hasilSaya');
  if (!appState.periodeAktifId) { sec.innerHTML = emptyState('bi-calendar-x', 'Belum ada periode aktif', ''); return; }
  if (!appState.user.karyawanId) { sec.innerHTML = emptyState('bi-person-x', 'Akun tidak terhubung', 'Akun Anda belum terhubung ke data karyawan.'); return; }
  sec.innerHTML = `<div class="skel" style="height:400px;"></div>`;
  GSR()
    .withSuccessHandler(res => {
      if (!res.success) { sec.innerHTML = emptyState('bi-hourglass', 'Hasil belum tersedia', res.message); return; }
      sec.innerHTML = '<span class="annotation">ANALYTICS // HASIL_SAYA</span>';
      const wrapped = document.createElement('div');
      wrapped.className = 'wf-card mt-3';
      sec.appendChild(wrapped);
      renderReportDetail(res.data, wrapped, appState.user.karyawanId);
    })
    .withFailureHandler(err => sec.innerHTML = emptyState('bi-exclamation-triangle', 'Terjadi kesalahan', err.message))
    .getEmployeeResult(appState.token, appState.user.karyawanId, appState.periodeAktifId);
}
