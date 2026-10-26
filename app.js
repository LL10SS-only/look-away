(() => {
  'use strict';

  const KEY = 'lookaway.v1';
  const SNOOZE_MS = 5 * 60 * 1000;
  const RING_R = 112;
  const RING_C = 2 * Math.PI * RING_R;

  const DEFAULTS = {
    intervalMin: 20,
    restSec: 20,
    sound: true,
    notify: false,
    vibrate: true,
    wakeLock: false,
    running: true,
    anchorAt: 0,
    nextAt: 0,
    pausedLeft: 0,
    doneDate: '',
    doneCount: 0,
  };

  const NOTIFY_ICON =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
        '<rect width="64" height="64" rx="16" fill="#2f7d6d"/>' +
        '<path d="M10 32c6-9 13-13.5 22-13.5S48 23 54 32c-6 9-13 13.5-22 13.5S16 41 10 32Z" fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round"/>' +
        '<circle cx="32" cy="32" r="6.4" fill="#fff"/>' +
      '</svg>'
    );

  const $ = (sel) => document.querySelector(sel);
  const el = {
    app: $('#app'),
    countdown: $('#countdown'),
    stateLabel: $('#stateLabel'),
    nextAt: $('#nextAt'),
    ring: $('#ring'),
    meta: $('#meta'),
    doneCount: $('#doneCount'),
    btnRest: $('#btnRest'),
    btnToggle: $('#btnToggle'),
    btnReset: $('#btnReset'),
    btnSettings: $('#btnSettings'),
    btnInstall: $('#btnInstall'),
    settings: $('#settings'),
    toast: $('#toast'),
    overlay: $('#overlay'),
    restDial: $('#restDial'),
    restCount: $('#restCount'),
    overlayNote: $('#overlayNote'),
    btnFinish: $('#btnFinish'),
    btnSnooze: $('#btnSnooze'),
    interval: $('#interval'),
    intervalOut: $('#intervalOut'),
    rest: $('#rest'),
    restOut: $('#restOut'),
    sound: $('#sound'),
    notify: $('#notify'),
    vibrate: $('#vibrate'),
    wakeLock: $('#wakeLock'),
    rowVibrate: $('#rowVibrate'),
    rowWake: $('#rowWake'),
  };

  let state = loadState();
  let resting = false;
  let restEnd = 0;
  let restTotal = 0;
  let restTimer = 0;
  let toastTimer = 0;
  let deferredPrompt = null;
  let wakeLock = null;
  let audioCtx = null;

  /* ---------- state ---------- */

  function clampNum(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function loadState() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (_) {
      raw = null;
    }
    const merged = Object.assign({}, DEFAULTS, raw && typeof raw === 'object' ? raw : {});
    merged.intervalMin = Math.round(clampNum(merged.intervalMin, 5, 120, DEFAULTS.intervalMin));
    merged.restSec = Math.round(clampNum(merged.restSec, 10, 60, DEFAULTS.restSec));
    merged.doneCount = Math.max(0, Math.round(clampNum(merged.doneCount, 0, 9999, 0)));
    merged.running = Boolean(merged.running);
    merged.sound = Boolean(merged.sound);
    merged.vibrate = Boolean(merged.vibrate);
    merged.wakeLock = Boolean(merged.wakeLock);
    merged.notify = Boolean(merged.notify);
    return merged;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (_) {
      /* 隐私模式下可能不可写，忽略即可 */
    }
  }

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function rollDay() {
    const key = todayKey();
    if (state.doneDate !== key) {
      state.doneDate = key;
      state.doneCount = 0;
      save();
    }
  }

  /* ---------- time helpers ---------- */

  const pad = (n) => (n < 10 ? '0' + n : String(n));

  function clock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    return (minutes < 10 ? '0' + minutes : String(minutes)) + ':' + pad(total % 60);
  }

  function hm(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* ---------- scheduling ---------- */

  function schedule(from, delay) {
    state.anchorAt = from;
    state.nextAt = from + delay;
    state.running = true;
    state.pausedLeft = 0;
    save();
    render();
    syncWakeLock();
  }

  function setRunning(on) {
    if (on === state.running) return;
    if (on) {
      const left = state.pausedLeft > 0 ? state.pausedLeft : state.intervalMin * 60000;
      schedule(Date.now(), left);
      toast('继续计时');
    } else {
      state.pausedLeft = Math.max(0, state.nextAt - Date.now()) || state.intervalMin * 60000;
      state.running = false;
      save();
      render();
      syncWakeLock();
      toast('已暂停，随时可以继续');
    }
  }

  /* ---------- rendering ---------- */

  function render(now = Date.now()) {
    const running = state.running;
    const left = running ? Math.max(0, state.nextAt - now) : Math.max(0, state.pausedLeft);
    const span = running ? Math.max(1000, state.nextAt - state.anchorAt) : state.intervalMin * 60000;
    const frac = Math.min(1, Math.max(0, 1 - left / span));

    el.ring.style.strokeDashoffset = (RING_C * frac).toFixed(2);
    el.countdown.textContent = clock(left);
    el.stateLabel.textContent = running ? '距离下一次远眺' : '已暂停';
    el.nextAt.textContent = running ? '下次提醒 ' + hm(state.nextAt) : '继续后会接着计时';
    el.btnToggle.textContent = running ? '暂停' : '继续';
    el.meta.textContent = '每 ' + state.intervalMin + ' 分钟 · ' + state.restSec + ' 秒';
    el.doneCount.textContent = String(state.doneCount);
    el.app.classList.toggle('is-paused', !running);
    document.title = running ? clock(left) + ' · 远眺提醒' : '已暂停 · 远眺提醒';
  }

  function toast(message) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2400);
  }

  /* ---------- sound ---------- */

  function audio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return audioCtx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      audioCtx = new AC();
    } catch (_) {
      return null;
    }
    return audioCtx;
  }

  function chime(kind) {
    if (!state.sound) return;
    const ctx = audio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const start = ctx.currentTime + 0.04;
    const notes = kind === 'done' ? [523.25, 659.25] : [659.25, 987.77];
    notes.forEach((freq, i) => {
      const t = start + i * 0.38;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.11, t + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1.6);
    });
  }

  /* ---------- alerts ---------- */

  function signal() {
    chime('remind');
    if (state.vibrate && typeof navigator.vibrate === 'function') {
      navigator.vibrate([180, 90, 180]);
    }
    if (state.notify && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const note = new Notification('该远眺窗外啦', {
          body: '看向 6 米外的窗外 ' + state.restSec + ' 秒，让睫状肌松一松。',
          icon: NOTIFY_ICON,
          tag: 'lookaway',
          renotify: true,
          silent: !(document.hidden && state.sound),
        });
        note.onclick = () => {
          window.focus();
          note.close();
        };
        setTimeout(() => note.close(), 30000);
      } catch (_) {
        /* 通知失败时页面内提示仍然有效 */
      }
    }
  }

  async function askNotify() {
    if (!('Notification' in window)) {
      toast('当前浏览器不支持系统通知');
      return false;
    }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
      return (await Notification.requestPermission()) === 'granted';
    } catch (_) {
      return false;
    }
  }

  /* ---------- wake lock ---------- */

  async function syncWakeLock() {
    if (!('wakeLock' in navigator)) return;
    const wanted = state.wakeLock && state.running && !document.hidden;
    if (wanted && !wakeLock) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
        });
      } catch (_) {
        wakeLock = null;
      }
    } else if (!wanted && wakeLock) {
      try {
        await wakeLock.release();
      } catch (_) {
        /* ignore */
      }
      wakeLock = null;
    }
  }

  /* ---------- rest overlay ---------- */

  function openRest(auto) {
    if (resting) return;
    resting = true;
    restTotal = state.restSec * 1000;
    restEnd = Date.now() + restTotal;

    el.overlayNote.textContent =
      '今日第 ' + (state.doneCount + 1) + ' 次 · ' + (auto ? '已连续用眼 ' + state.intervalMin + ' 分钟' : '手动开始');
    el.overlay.hidden = false;
    el.overlay.setAttribute('aria-hidden', 'false');
    el.app.inert = true;
    requestAnimationFrame(() => el.overlay.classList.add('show'));

    el.restCount.textContent = String(state.restSec);
    el.restDial.style.setProperty('--p', '0');
    clearInterval(restTimer);
    restTimer = setInterval(updateRest, 100);
    updateRest();

    signal();
    syncWakeLock();
    try {
      el.btnFinish.focus({ preventScroll: true });
    } catch (_) {
      /* ignore */
    }
  }

  function updateRest() {
    const left = Math.max(0, restEnd - Date.now());
    const p = Math.min(100, Math.max(0, (1 - left / restTotal) * 100));
    el.restCount.textContent = String(Math.ceil(left / 1000));
    el.restDial.style.setProperty('--p', p.toFixed(2));
    if (left <= 0) closeRest(true);
  }

  function closeRest(completed) {
    if (!resting) return;
    resting = false;
    clearInterval(restTimer);
    el.overlay.classList.remove('show');
    el.overlay.setAttribute('aria-hidden', 'true');
    el.app.inert = false;
    setTimeout(() => {
      if (!resting) el.overlay.hidden = true;
    }, 380);

    const now = Date.now();
    if (completed) {
      rollDay();
      state.doneCount += 1;
      state.doneDate = todayKey();
      chime('done');
      schedule(now, state.intervalMin * 60000);
      toast('很好，眼睛休息了一下');
    } else {
      schedule(now, SNOOZE_MS);
      toast('5 分钟后再提醒你');
    }
    syncWakeLock();
  }

  /* ---------- main loop ---------- */

  function tick() {
    const now = Date.now();
    rollDay();
    if (resting) return;
    if (!state.running) {
      render(now);
      return;
    }
    const left = state.nextAt - now;
    if (left <= 0) {
      const late = -left;
      const tolerance = Math.max(state.intervalMin * 60000 * 2, 15 * 60000);
      if (late > tolerance) {
        schedule(now, state.intervalMin * 60000);
        toast('已重新开始计时');
      } else {
        openRest(true);
      }
      return;
    }
    render(now);
  }

  /* ---------- settings UI ---------- */

  function syncSettingsUI() {
    el.interval.value = String(state.intervalMin);
    el.intervalOut.textContent = state.intervalMin + ' 分钟';
    el.rest.value = String(state.restSec);
    el.restOut.textContent = state.restSec + ' 秒';
    el.sound.checked = state.sound;
    el.notify.checked = state.notify;
    el.vibrate.checked = state.vibrate;
    el.wakeLock.checked = state.wakeLock;
    if (!('vibrate' in navigator)) el.rowVibrate.hidden = true;
    if (!('wakeLock' in navigator)) el.rowWake.hidden = true;
  }

  function bind() {
    el.btnToggle.addEventListener('click', () => setRunning(!state.running));
    el.btnRest.addEventListener('click', () => openRest(false));
    el.btnFinish.addEventListener('click', () => closeRest(true));
    el.btnSnooze.addEventListener('click', () => closeRest(false));

    el.btnReset.addEventListener('click', () => {
      schedule(Date.now(), state.intervalMin * 60000);
      toast('计时已重置');
    });

    el.btnSettings.addEventListener('click', () => {
      syncSettingsUI();
      if (typeof el.settings.showModal === 'function') {
        el.settings.showModal();
      } else {
        el.settings.setAttribute('open', '');
      }
    });

    el.interval.addEventListener('input', () => {
      el.intervalOut.textContent = el.interval.value + ' 分钟';
    });
    el.interval.addEventListener('change', () => {
      state.intervalMin = Number(el.interval.value);
      if (!resting) {
        if (state.running) {
          schedule(Date.now(), state.intervalMin * 60000);
        } else {
          state.pausedLeft = state.intervalMin * 60000;
        }
      }
      save();
      render();
    });

    el.rest.addEventListener('input', () => {
      el.restOut.textContent = el.rest.value + ' 秒';
    });
    el.rest.addEventListener('change', () => {
      state.restSec = Number(el.rest.value);
      save();
      render();
    });

    el.sound.addEventListener('change', () => {
      state.sound = el.sound.checked;
      save();
      if (state.sound) chime('remind');
    });

    el.vibrate.addEventListener('change', () => {
      state.vibrate = el.vibrate.checked;
      save();
    });

    el.wakeLock.addEventListener('change', () => {
      state.wakeLock = el.wakeLock.checked;
      save();
      syncWakeLock();
    });

    el.notify.addEventListener('change', async () => {
      if (el.notify.checked) {
        const granted = await askNotify();
        if (!granted) {
          el.notify.checked = false;
          state.notify = false;
          save();
          toast('没有拿到通知权限，可以稍后在浏览器设置里开启');
          return;
        }
      }
      state.notify = el.notify.checked;
      save();
      toast(state.notify ? '已开启系统通知' : '已关闭系统通知');
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) tick();
      syncWakeLock();
    });

    window.addEventListener('beforeunload', save);

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredPrompt = event;
      el.btnInstall.hidden = false;
    });

    el.btnInstall.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } catch (_) {
        /* ignore */
      }
      deferredPrompt = null;
      el.btnInstall.hidden = true;
    });

    window.addEventListener('appinstalled', () => {
      el.btnInstall.hidden = true;
      toast('已安装到桌面');
    });
  }

  function init() {
    rollDay();
    if (!state.anchorAt || !state.nextAt) {
      state.anchorAt = Date.now();
      state.nextAt = state.anchorAt + state.intervalMin * 60000;
      save();
    }
    if (!state.running && !state.pausedLeft) {
      state.pausedLeft = state.intervalMin * 60000;
      save();
    }

    el.ring.style.strokeDasharray = RING_C.toFixed(2) + ' ' + RING_C.toFixed(2);
    syncSettingsUI();
    bind();
    render();
    tick();
    setInterval(tick, 250);

    const unlock = () => {
      const ctx = audio();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });

    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      el.btnInstall.hidden = true;
    }

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
  }

  init();
})();
