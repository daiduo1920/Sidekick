(function () {
  const stage = document.getElementById('pet-stage');
  const c2d = document.getElementById('canvas-2d');
  const c3d = document.getElementById('canvas-3d');
  const cFx = document.getElementById('canvas-fx');
  const miniCounter = document.getElementById('mini-counter');
  const mcKeys = document.getElementById('mc-keys');
  const mcClicks = document.getElementById('mc-clicks');

  const state = new window.KuroState.CompanionState();
  const pipeline = new window.KuroStagePipeline.StagePipeline(c2d, c3d, cFx);
  let paused = false;
  let rafId = 0;

  function syncStageClasses() {
    stage.classList.toggle('click-through', !!state.cfg.clickThrough);
    stage.classList.toggle('peek-mode', state.cfg.dockMode === 'peek');
    miniCounter.classList.toggle('hidden', !state.cfg.showMiniCounter || state.cfg.dockMode === 'peek');
  }

  function setPaused(p) {
    const next = !!p;
    if (next === paused) return;
    paused = next;
    window.KuroSound.setMuted(paused);
    if (!paused) {
      lastTs = performance.now();
      if (!rafId) rafId = requestAnimationFrame(loop);
    }
  }

  // Receive live host messages
  window.KuroBus.onMessage((msg) => {
    if (!msg || !msg.t) return;
    if (msg.t === 'cfg' && msg.cfg) {
      state.applyConfig(msg.cfg);
      pipeline.pruneUnusedAssets(state.cfg.customAssets);
      syncStageClasses();
    } else if (msg.t === 'pause') {
      setPaused(msg.p);
    } else if (msg.t === 'k') {
      state.onKeyEvent(msg.r, msg.c, msg.h, msg.k, msg.d === 1, msg.tk, false, msg.vk);
    } else if (msg.t === 'mm') {
      state.onMouseMoveScreen(msg.sx, msg.sy, msg.wx, msg.wy, msg.ww, msg.wh, msg.vx, msg.vy, msg.vw, msg.vh);
    } else if (msg.t === 'mb') {
      state.onMouseButton(msg.b, msg.d === 1, msg.tc);
    } else if (msg.t === 'mw') {
      state.onMouseWheel(msg.dy);
    } else if (msg.t === 'aud') {
      state.onAudioData(msg.lvl, msg.bass, msg.beat, msg.play);
    } else if (msg.t === 'ctx') {
      state.onContextData(msg.cat, msg.proc, msg.night, msg.ar, msg.ag, msg.ab, msg.alum);
    } else if (msg.t === 'meme') {
      state.onShortcutMeme(msg.id);
    } else if (msg.t === 'demo') {
      state.triggerDemo(msg.a);
    } else if (msg.t === 'mcmd') {
      if (msg.k === 'exp') pipeline.triggerExpression(state, msg.n);
      else if (msg.k === 'motion') pipeline.triggerMotion(state, msg.n, msg.i || 0);
    }
  });

  // Pure desktop interaction (zero hover chrome! 4px drag deadzone prevents double-click nudge!)
  let pendingDrag = false;
  let dragStarted = false;
  let dragDownX = 0, dragDownY = 0;
  let orbiting = false;
  let ox = 0, oy = 0;

  stage.addEventListener('mousedown', (e) => {
    if (state.cfg.clickThrough) return;
    if (e.button === 0 && state.cfg.dockMode !== 'peek') {
      pendingDrag = true;
      dragStarted = false;
      dragDownX = e.screenX;
      dragDownY = e.screenY;
    } else if (e.button === 2) {
      const av = window.KuroRegistry.getAvatar(state.cfg.avatar, state.cfg.customAssets);
      if (av.renderer === 'vrm3d') {
        orbiting = true;
        ox = e.clientX;
        oy = e.clientY;
      }
    }
  });

  stage.addEventListener('dblclick', () => {
    pendingDrag = false;
    dragStarted = false;
    stage.classList.remove('dragging');
    if (!state.cfg.clickThrough) {
      window.KuroBus.send({ cmd: 'openStudio' });
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (pendingDrag && !dragStarted) {
      if (Math.hypot(e.screenX - dragDownX, e.screenY - dragDownY) >= 4) {
        dragStarted = true;
        stage.classList.add('dragging');
        window.KuroBus.send({ cmd: 'startDrag' });
      }
    }
    if (orbiting) {
      state.orbitYaw.target = Math.max(-0.58, Math.min(0.58, (e.clientX - ox) / 140));
      state.orbitPitch.target = Math.max(-0.34, Math.min(0.34, (e.clientY - oy) / 140));
    }
    if (!window.KuroBus.isNative) {
      const r = stage.getBoundingClientRect();
      state.onMouseMoveScreen(e.clientX, e.clientY, r.left, r.top, r.width, r.height, 0, 0, window.innerWidth, window.innerHeight);
    }
  });

  window.addEventListener('mouseup', () => {
    pendingDrag = false;
    dragStarted = false;
    stage.classList.remove('dragging');
    if (orbiting) {
      orbiting = false;
      state.orbitYaw.target = 0;
      state.orbitPitch.target = 0;
    }
  });

  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  stage.addEventListener('wheel', (e) => {
    if (e.ctrlKey && window.KuroBus.isNative) {
      e.preventDefault();
      window.KuroBus.send({ cmd: 'deltaScale', value: e.deltaY < 0 ? 0.08 : -0.08 });
    } else if (!window.KuroBus.isNative) {
      state.onMouseWheel(e.deltaY < 0 ? 120 : -120);
    }
  }, { passive: false });

  // Standalone browser preview URL params & keyboard fallback
  if (!window.KuroBus.isNative) {
    const p = new URLSearchParams(window.location.search);
    const patch = {};
    if (p.get('avatar')) patch.avatar = p.get('avatar');
    if (p.get('keyboard')) patch.keyboard = p.get('keyboard');
    if (p.get('gear')) patch.mouseGear = p.get('gear');
    if (p.get('dock')) patch.dockMode = p.get('dock');
    if (p.get('shader')) patch.shader3d = p.get('shader');
    if (p.get('palette')) patch.palette = p.get('palette');
    state.applyConfig(patch);
    syncStageClasses();

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      state.onKeyEvent(1, Math.floor(Math.random() * 10), e.code === 'Space' ? 0 : (Math.random() < 0.5 ? 0 : 1), e.code === 'Space' ? 2 : 0, true);
    });
    window.addEventListener('keyup', () => {
      state.onKeyEvent(1, 3, 0, 0, false);
    });
  }

  // Expose debug API for deterministic visual inspection
  window.__kuroPet = {
    state,
    pipeline,
    renderNow() { pipeline.render(state); },
  };

  let lastK = -1, lastC = -1;
  let lastTs = performance.now();
  function loop(now) {
    if (paused) {
      rafId = 0;
      return;
    }
    const dt = (now - lastTs) / 1000;
    lastTs = now;
    state.update(dt);
    pipeline.render(state);

    if (state.cfg.showMiniCounter && (state.cfg.todayKeys !== lastK || state.cfg.todayClicks !== lastC)) {
      lastK = state.cfg.todayKeys;
      lastC = state.cfg.todayClicks;
      mcKeys.textContent = lastK.toLocaleString('en-US');
      mcClicks.textContent = lastC.toLocaleString('en-US');
    }
    rafId = requestAnimationFrame(loop);
  }

  window.KuroBus.send({ cmd: 'ready' });
  rafId = requestAnimationFrame(loop);
})();
