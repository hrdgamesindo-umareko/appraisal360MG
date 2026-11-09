/* Appraisal360 — landing: menu, daftar parameter, globe 3D holografis, branding */
(function () {
  var btn = document.getElementById('menuBtn'), menu = document.getElementById('menu');
  var open = document.getElementById('icoOpen'), close = document.getElementById('icoClose');
  function set(show) {
    menu.classList.toggle('hidden', !show);
    open.classList.toggle('hidden', show); close.classList.toggle('hidden', !show);
    btn.setAttribute('aria-expanded', String(show));
    btn.setAttribute('aria-label', show ? 'Tutup menu' : 'Buka menu');
  }
  btn.addEventListener('click', function () { set(menu.classList.contains('hidden')); });
  menu.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { set(false); btn.focus(); } });
  window.addEventListener('resize', function () { if (window.innerWidth >= 768) set(false); });

  var staff = [['Sikap dan etos kerja',15],['Inisiatif & kreativitas',15],['Relasi sosial',10],['Pengetahuan pekerjaan',12.5],['Penyesuaian diri pada perubahan',12.5],['Kerjasama tim',15],['Kualitas pekerjaan',20]];
  var mgr = [['Sikap dan etos kerja',12.5],['Inisiatif & kreativitas',10],['Relasi sosial',10],['Penyesuaian diri pada perubahan',10],['Pengetahuan pekerjaan',10],['Kualitas pekerjaan',12.5],['Kepemimpinan',12.5],['Kerjasama tim',12.5],['Inovasi & efisiensi kerja',10]];
  function render(id, rows) {
    document.getElementById(id).innerHTML = rows.map(function (r) {
      var pct = String(r[1]).replace('.', ',') + '%';
      return '<li><div class="flex justify-between gap-3"><span>' + r[0] + '</span><span class="font-medium text-muted">' + pct + '</span></div>' +
        '<div class="mt-1 h-1.5 rounded-full bg-line"><div class="h-1.5 rounded-full bg-brand" style="width:' + (r[1] * 5) + '%"></div></div></li>';
    }).join('');
  }
  render('listStaff', staff); render('listMgr', mgr);
})();

(function () {
  var cv = document.getElementById('globe'), stage = document.getElementById('globeStage');
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext('2d');
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var CY = [34, 228, 255], PU = [167, 92, 255], TAU = Math.PI * 2;
  var W = 0, H = 0, dpr = 1, R = 0, cx = 0, cy = 0;
  var yaw = -0.6, pitch = 0.38, tp = 0.38, extra = 0, drag = false, lx = 0, ly = 0, vis = true, raf = 0, last = 0;
  var cyw = 1, syw = 0, cpw = 1, spw = 0;
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.max(0, a).toFixed(3) + ')'; }
  function ll(lat, lon) { var c = Math.cos(lat); return [c * Math.sin(lon), Math.sin(lat), c * Math.cos(lon)]; }
  function pr(p) {
    var x1 = p[0] * cyw + p[2] * syw, z1 = -p[0] * syw + p[2] * cyw;
    var y2 = p[1] * cpw - z1 * spw, z2 = p[1] * spw + z1 * cpw, f = 3.4 / (3.4 - z2 * 0.9);
    return [cx + x1 * R * f, cy - y2 * R * f, z2, f];
  }
  /* titik permukaan: bola Fibonacci, "daratan" dari medan gelombang */
  var N = window.innerWidth < 640 ? 1100 : 2400, GA = Math.PI * (3 - Math.sqrt(5)), dots = [];
  for (var i = 0; i < N; i++) {
    var y = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - y * y), t = GA * i, x = Math.cos(t) * r, z = Math.sin(t) * r;
    var lat = Math.asin(y), lon = Math.atan2(x, z);
    var n = Math.sin(lon * 2 + 1) * Math.cos(lat * 2) + Math.sin(lat * 4 + lon) * 0.55 + Math.sin(lon * 5 - lat * 3) * 0.35;
    dots.push([x, y, z, n > 0.35 ? 1 : 0]);
  }
  /* empat perspektif + hub skor, dihubungkan busur great-circle */
  var nodes = [
    { n: 'Atasan', p: ll(0.55, 0.2) }, { n: 'Peer', p: ll(0.1, 1.75) },
    { n: 'Bawahan', p: ll(-0.45, 3.0) }, { n: 'Self', p: ll(-0.1, -1.4) },
    { n: 'Skor 360°', p: ll(0.95, -0.4), hub: true }
  ];
  function arc(a, b) {
    var d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])), om = Math.acos(d), s = Math.sin(om) || 1;
    var h = 0.1 + 0.22 * om / Math.PI, pts = [];
    for (var i = 0; i <= 36; i++) {
      var t = i / 36, k1 = Math.sin((1 - t) * om) / s, k2 = Math.sin(t * om) / s, L = 1 + h * Math.sin(Math.PI * t);
      pts.push([(a[0] * k1 + b[0] * k2) * L, (a[1] * k1 + b[1] * k2) * L, (a[2] * k1 + b[2] * k2) * L]);
    }
    return pts;
  }
  var arcs = [];
  for (var k = 0; k < 4; k++) {
    arcs.push({ pts: arc(nodes[k].p, nodes[4].p), off: k * 0.23, sp: 0.2, w: 1.7 });
    arcs.push({ pts: arc(nodes[k].p, nodes[(k + 1) % 4].p), off: k * 0.31 + 0.1, sp: 0.14, w: 1.1 });
  }
  function ringPt(a, rad, tl) { return [rad * Math.cos(a), -rad * Math.sin(a) * Math.sin(tl), rad * Math.sin(a) * Math.cos(tl)]; }

  function glowDot(x, y, rad, col, a) {
    ctx.shadowBlur = 16 * dpr; ctx.shadowColor = rgba(col, 0.9);
    ctx.fillStyle = rgba([220, 250, 255], a); ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
  }
  function pill(text, x, y, a) {
    ctx.font = '600 ' + 12 * dpr + 'px "Space Grotesk",system-ui,sans-serif';
    var w = ctx.measureText(text).width + 14 * dpr, h = 21 * dpr, r = 8 * dpr;
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    ctx.fillStyle = 'rgba(6,12,32,' + (0.72 * a).toFixed(3) + ')'; ctx.fill();
    ctx.strokeStyle = rgba(CY, 0.55 * a); ctx.lineWidth = dpr; ctx.stroke();
    ctx.fillStyle = 'rgba(234,244,255,' + a.toFixed(3) + ')'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 7 * dpr, y + h / 2 + dpr * 0.5);
  }

  function draw(t) {
    cyw = Math.cos(yaw); syw = Math.sin(yaw); cpw = Math.cos(pitch); spw = Math.sin(pitch);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = 'lighter';
    var by = cy + R * 1.18, g, i, j, p, q;
    /* halo sinematik */
    g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.55);
    g.addColorStop(0, rgba(CY, 0.12)); g.addColorStop(0.5, rgba(PU, 0.11)); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    /* kerucut proyektor + cincin dasar */
    g = ctx.createLinearGradient(0, by, 0, cy);
    g.addColorStop(0, rgba(CY, 0.09)); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx - R * 0.85, by); ctx.lineTo(cx - R * 0.5, cy + R * 0.25);
    ctx.lineTo(cx + R * 0.5, cy + R * 0.25); ctx.lineTo(cx + R * 0.85, by); ctx.fill();
    ctx.shadowBlur = 14 * dpr; ctx.shadowColor = rgba(CY, 0.8); ctx.lineWidth = 1.3 * dpr;
    for (i = 0; i < 3; i++) {
      var rr = R * (0.8 + i * 0.22); ctx.strokeStyle = rgba(i === 1 ? PU : CY, 0.5 - i * 0.12);
      ctx.beginPath(); ctx.ellipse(cx, by, rr, rr * 0.2, 0, 0, TAU); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    /* volume bola */
    g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R * 1.02);
    g.addColorStop(0, rgba(CY, 0.16)); g.addColorStop(0.65, rgba(PU, 0.07)); g.addColorStop(1, rgba(PU, 0.0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, TAU); ctx.fill();
    /* grid lintang & bujur (depan terang, belakang redup) */
    var fr = new Path2D(), bk = new Path2D();
    function seg(a, b) {
      var s = (a[2] + b[2]) / 2 > 0 ? fr : bk; s.moveTo(a[0], a[1]); s.lineTo(b[0], b[1]);
    }
    for (i = 0; i < 12; i++) {
      var lo = i * Math.PI / 6; p = null;
      for (j = 0; j <= 24; j++) { q = pr(ll(-Math.PI / 2 + j * Math.PI / 24, lo)); if (p) seg(p, q); p = q; }
    }
    [-1.05, -0.52, 0, 0.52, 1.05].forEach(function (la) {
      p = null; for (j = 0; j <= 64; j++) { q = pr(ll(la, j * TAU / 64)); if (p) seg(p, q); p = q; }
    });
    ctx.lineWidth = dpr; ctx.strokeStyle = rgba(PU, 0.08); ctx.stroke(bk);
    ctx.strokeStyle = rgba(CY, 0.24); ctx.stroke(fr);
    /* titik "daratan" holografik, dikelompokkan per kedalaman */
    var bk6 = [[], [], [], [], [], []], al = [0.12, 0.2, 0.3, 0.5, 0.4, 0.9];
    for (i = 0; i < dots.length; i++) {
      var d = dots[i]; q = pr(d), land = d[3];
      var b = (q[2] < 0 ? 0 : q[2] < 0.4 ? 2 : 4) + land;
      bk6[b].push(q[0], q[1], (land ? 1.25 : 0.8) * dpr * q[3]);
    }
    for (i = 0; i < 6; i++) {
      var arr = bk6[i]; ctx.fillStyle = rgba(i % 2 ? CY : PU, al[i]); ctx.beginPath();
      for (j = 0; j < arr.length; j += 3) { ctx.moveTo(arr[j] + arr[j + 2], arr[j + 1]); ctx.arc(arr[j], arr[j + 1], arr[j + 2], 0, TAU); }
      ctx.fill();
    }
    /* cincin orbit + satelit */
    [[1.24, 0.42, 0.11, CY], [1.4, -0.75, -0.08, PU]].forEach(function (rg, idx) {
      var f2 = new Path2D(), b2 = new Path2D(), pp = null, qq, sg;
      for (j = 0; j <= 96; j++) {
        qq = pr(ringPt(j * TAU / 96, rg[0], rg[1]));
        if (pp) { sg = (pp[2] + qq[2]) / 2 > 0 ? f2 : b2; sg.moveTo(pp[0], pp[1]); sg.lineTo(qq[0], qq[1]); } pp = qq;
      }
      ctx.lineWidth = 1.2 * dpr; ctx.strokeStyle = rgba(rg[3], 0.1); ctx.stroke(b2);
      ctx.strokeStyle = rgba(rg[3], 0.5); ctx.stroke(f2);
      var s = pr(ringPt(t * rg[2] * 6 + idx * 2, rg[0], rg[1]));
      glowDot(s[0], s[1], 3 * dpr * s[3], rg[3], s[2] > 0 ? 1 : 0.4);
    });
    /* busur data + denyut */
    for (i = 0; i < arcs.length; i++) {
      var A = arcs[i], pj = A.pts.map(pr);
      ctx.lineWidth = A.w * dpr;
      for (j = 1; j < pj.length; j++) {
        var m = j / pj.length, dz = (pj[j][2] + pj[j - 1][2]) / 2, aa = 0.1 + 0.5 * Math.max(0, (dz + 0.6) / 1.6);
        ctx.strokeStyle = 'rgba(' + Math.round(CY[0] + (PU[0] - CY[0]) * m) + ',' + Math.round(CY[1] + (PU[1] - CY[1]) * m) + ',' + Math.round(CY[2] + (PU[2] - CY[2]) * m) + ',' + aa.toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(pj[j - 1][0], pj[j - 1][1]); ctx.lineTo(pj[j][0], pj[j][1]); ctx.stroke();
      }
      var ph = (t * A.sp + A.off) % 1, ix = Math.floor(ph * 36);
      for (j = 0; j < 5; j++) { var e = pj[Math.max(0, ix - j)]; glowDot(e[0], e[1], (2.6 - j * 0.4) * dpr * e[3], CY, (1 - j * 0.2) * (e[2] > -0.2 ? 1 : 0.35)); }
    }
    /* garis pindai hologram, dipotong di dalam bola */
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R * 1.0, 0, TAU); ctx.clip();
    var sy = cy - R + ((t * 0.28) % 1) * 2 * R;
    g = ctx.createLinearGradient(0, sy - R * 0.2, 0, sy + R * 0.2);
    g.addColorStop(0, 'rgba(34,228,255,0)'); g.addColorStop(0.5, rgba(CY, 0.13)); g.addColorStop(1, 'rgba(34,228,255,0)');
    ctx.fillStyle = g; ctx.fillRect(cx - R, sy - R * 0.2, 2 * R, R * 0.4);
    ctx.strokeStyle = rgba(CY, 0.04); ctx.lineWidth = dpr; ctx.beginPath();
    for (var yy = cy - R; yy < cy + R; yy += 5 * dpr) { ctx.moveTo(cx - R, yy); ctx.lineTo(cx + R, yy); }
    ctx.stroke(); ctx.restore();
    /* tepi bola (rim light) */
    g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    g.addColorStop(0, rgba(CY, 0.95)); g.addColorStop(1, rgba(PU, 0.95));
    ctx.shadowBlur = 22 * dpr; ctx.shadowColor = rgba(CY, 0.7); ctx.strokeStyle = g; ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.0, 0, TAU); ctx.stroke(); ctx.shadowBlur = 0;
    /* node + label */
    ctx.globalCompositeOperation = 'source-over';
    for (i = 0; i < nodes.length; i++) {
      var nd = nodes[i], s2 = pr(nd.p);
      if (s2[2] < -0.15) continue;
      var vis2 = Math.min(1, (s2[2] + 0.15) / 0.5), pp2 = (t * 0.8 + i * 0.3) % 1;
      ctx.strokeStyle = rgba(nd.hub ? PU : CY, (1 - pp2) * 0.6 * vis2); ctx.lineWidth = 1.4 * dpr;
      ctx.beginPath(); ctx.arc(s2[0], s2[1], (6 + pp2 * 18) * dpr, 0, TAU); ctx.stroke();
      glowDot(s2[0], s2[1], (nd.hub ? 5.5 : 4) * dpr, nd.hub ? PU : CY, vis2);
      if (s2[2] > 0.1) pill(nd.n, s2[0] + 11 * dpr, s2[1] - 10 * dpr, Math.min(1, (s2[2] - 0.1) / 0.4));
    }
  }

  function resize() {
    var rc = stage.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(rc.width * dpr)); H = Math.max(1, Math.round(rc.height * dpr));
    cv.width = W; cv.height = H; R = Math.min(W, H) * 0.33; cx = W / 2; cy = H * 0.44; if (reduce) draw(0);
  }
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    var dt = Math.min(50, ts - last) / 16.67; last = ts;
    if (!drag) { yaw += (0.0034 + extra) * dt; extra *= Math.pow(0.95, dt); pitch += (tp - pitch) * 0.05 * dt; }
    draw(ts / 1000);
  }
  function start() { if (reduce || raf || !vis || document.hidden) return; last = performance.now(); raf = requestAnimationFrame(loop); }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  stage.addEventListener('pointerdown', function (e) { drag = true; lx = e.clientX; ly = e.clientY; try { stage.setPointerCapture(e.pointerId); } catch (x) {} });
  stage.addEventListener('pointermove', function (e) {
    if (drag) {
      var dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      yaw += dx * 0.007; pitch = Math.max(-0.9, Math.min(0.9, pitch + dy * 0.005)); extra = dx * 0.0009; if (reduce) draw(0);
    } else if (e.pointerType !== 'touch') {
      var rc = stage.getBoundingClientRect(); tp = 0.38 - ((e.clientY - rc.top) / rc.height - 0.5) * 0.3;
    }
  });
  function up() { drag = false; }
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  stage.addEventListener('pointerleave', function () { if (!drag) tp = 0.38; });
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage); else window.addEventListener('resize', resize);
  if (window.IntersectionObserver) new IntersectionObserver(function (en) { vis = en[0].isIntersecting; vis ? start() : stop(); }).observe(stage);
  document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
  resize(); start();
})();

/* kemiringan 3D kartu saat kursor bergerak */
(function () {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('.rounded-xl.bg-bg,.demo-card').forEach(function (el) {
    el.setAttribute('data-tilt', '');
    el.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = 'perspective(900px) rotateX(' + (-y * 7).toFixed(2) + 'deg) rotateY(' + (x * 9).toFixed(2) + 'deg)';
    });
    el.addEventListener('pointerleave', function () { el.style.transform = ''; });
  });
})();

/* Branding dinamis dari server (nama, perusahaan, logo) */
(function () {
  if (typeof API === 'undefined') return;
  API.call('getAllConfig', [null]).then(function (res) {
    if (!res || !res.success) return;
    var c = res.data || {}, name = c.appName || 'Appraisal360', co = c.companyName || name;
    document.querySelectorAll('[data-app-name]').forEach(function (el) { el.textContent = name; });
    document.querySelectorAll('[data-company-name]').forEach(function (el) { el.textContent = co; });
    document.title = name + ' — Penilaian kinerja 360° untuk tim Anda';
    var img = document.getElementById('brandLogo');
    if (img && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(c.logoUrl || '')) { img.src = c.logoUrl; img.style.display = ''; }
  }).catch(function () { /* landing tetap tampil dengan nama bawaan */ });
})();

