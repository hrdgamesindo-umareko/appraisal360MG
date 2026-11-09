/* Boot awal: tema, pengaman storage, fallback Bootstrap JS, pembebas overlay. Dimuat sinkron di <head>. */
    (function () {
      try {
        var t = localStorage.getItem('theme');
        if (!t) t = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', t);
      } catch (e) {}
    })();
  
;
    (function () {
      try {
        var k = '__probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k);
      } catch (e) {
        var mem = {};
        var safe = {
          getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
          setItem: function (k, v) { mem[k] = String(v); },
          removeItem: function (k) { delete mem[k]; },
          clear: function () { mem = {}; }
        };
        try { Object.defineProperty(window, 'localStorage', { value: safe, configurable: true }); } catch (e2) {}
      }
    })();
  
;
    (function () {
      function setOpen(el, on) {
        if (!el) return;
        if (on) {
          el.classList.add('show');
          el.setAttribute('aria-modal', 'true');
          el.style.cssText += ';display:flex;position:fixed;inset:0;z-index:1055;align-items:center;justify-content:center;background:rgba(10,37,64,.45);padding:16px;';
        } else {
          el.classList.remove('show');
          el.style.display = 'none';
        }
      }
      function FModal(el) { this._el = el; }
      FModal.prototype.show = function () { setOpen(this._el, true); return this; };
      FModal.prototype.hide = function () { setOpen(this._el, false); return this; };
      FModal.getInstance = function (el) { return el ? new FModal(el) : null; };

      function FToast(el, opts) { this._el = el; this._delay = (opts && opts.delay) || 4000; }
      FToast.prototype.show = function () {
        var el = this._el;
        el.classList.add('show');
        el.style.display = 'block';
        clearTimeout(el._hideT);
        el._hideT = setTimeout(function () { el.classList.remove('show'); el.style.display = 'none'; }, this._delay);
      };

      window.bootstrap = { Modal: FModal, Toast: FToast };

      document.addEventListener('click', function (ev) {
        var t = ev.target.closest && ev.target.closest('[data-bs-dismiss]');
        if (!t) return;
        var kind = t.getAttribute('data-bs-dismiss');
        if (kind === 'modal') setOpen(t.closest('.modal'), false);
        if (kind === 'toast') { var tt = t.closest('.toast'); if (tt) { tt.classList.remove('show'); tt.style.display = 'none'; } }
      });
    })();
  
;
    (function () {
      function unblock() {
        var ov = document.getElementById('loadingOverlay');
        if (ov) ov.style.display = 'none';
        var shell = document.getElementById('appShell');
        var login = document.getElementById('loginScreen');
        if (login && (!shell || shell.style.display !== 'block')) login.style.display = 'flex';
      }
      window.addEventListener('error', unblock);
      window.addEventListener('unhandledrejection', unblock);
    })();
  
