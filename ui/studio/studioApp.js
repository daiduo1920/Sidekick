(function () {
  const R = window.KuroRegistry;
  const bus = window.KuroBus;

  // Mute background global audio in Studio so typing/clicking never echoes double with the desktop PetWindow!
  const state = new window.KuroState.CompanionState({ silentGlobal: true });
  const pvViewport = document.getElementById('preview-viewport');
  const pipeline = new window.KuroStagePipeline.StagePipeline(
    document.getElementById('pv-2d'),
    document.getElementById('pv-3d'),
    document.getElementById('pv-fx')
  );

  let studioVisible = true;
  let rafId = 0;
  let lastCustomSig = '__init__';
  let gridsBuilt = false;

  // Toast helper
  let toastTimer = null;
  function showToast(msg, isErr) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.remove('show'); }, 2800);
  }

  function applyStudioTheme() {
    const isDark = state.cfg.studioTheme === 'atelier-dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'atelier-dark' : 'atelier-light');
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) btn.textContent = isDark ? '墨炭暗室' : '和纸画廊';
  }

  function patchConfig(patch, deferSave) {
    state.applyConfig(patch);
    if (patch.studioTheme) applyStudioTheme();
    bus.send({ cmd: 'patchConfig', patch, deferSave: !!deferSave });
    if (deferSave) {
      syncLightweightControls();
    } else {
      syncAllControls();
    }
  }

  // --- 1. NAVIGATION TABS & THEME SWITCH ---
  document.getElementById('nav-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-tab');
    if (!btn) return;
    const tab = btn.dataset.tab;
    document.querySelectorAll('.nav-tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + tab));
  });

  document.getElementById('btn-theme-toggle').addEventListener('click', () => {
    const next = state.cfg.studioTheme === 'atelier-dark' ? 'atelier-light' : 'atelier-dark';
    patchConfig({ studioTheme: next });
  });

  // --- 2. PREVIEW BACKDROP SIMULATOR (isolated from live host ctx ticks!) ---
  const AMB_SIM = {
    paper: [244, 240, 232, 0.92],
    stone: [226, 224, 218, 0.84],
    charcoal: [32, 31, 36, 0.16],
    grid: [236, 232, 224, 0.86],
  };
  state.setAmbientOverride(AMB_SIM.paper);

  document.getElementById('bg-switcher').addEventListener('click', (e) => {
    const chip = e.target.closest('.bg-chip');
    if (!chip) return;
    const bg = chip.dataset.bg;
    document.querySelectorAll('.bg-chip').forEach((c) => c.classList.toggle('active', c === chip));
    pvViewport.className = 'preview-viewport bg-' + bg;
    state.setAmbientOverride(AMB_SIM[bg] || AMB_SIM.paper);
  });

  // --- 3. INTERACTIVE LIVE PREVIEW (REAL EYE TRACKING, PROXIMITY, DIZZY, PETTING, 3D ORBIT) ---
  let orbiting = false, pvMouseDown = false, ox = 0, oy = 0;
  window.addEventListener('mousemove', (e) => {
    if (!studioVisible) return;
    const r = pvViewport.getBoundingClientRect();
    state.onMouseMoveScreen(e.clientX, e.clientY, r.left, r.top, r.width, r.height, 0, 0, window.innerWidth, window.innerHeight);
    if (orbiting) {
      state.orbitYaw.target = Math.max(-0.58, Math.min(0.58, (e.clientX - ox) / 120));
      state.orbitPitch.target = Math.max(-0.34, Math.min(0.34, (e.clientY - oy) / 120));
    }
  });

  pvViewport.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      orbiting = true; ox = e.clientX; oy = e.clientY;
    } else if (e.button === 0) {
      pvMouseDown = true;
      state.onMouseButton(0, true);
    }
  });
  window.addEventListener('mouseup', () => {
    if (pvMouseDown) {
      pvMouseDown = false;
      state.onMouseButton(0, false);
    }
    if (orbiting) { orbiting = false; state.orbitYaw.target = 0; state.orbitPitch.target = 0; }
  });
  pvViewport.addEventListener('contextmenu', (e) => e.preventDefault());

  // 1-Click Demo Playground (synced cleanly to both preview and desktop pet!)
  document.querySelector('.demo-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('.demo-pill');
    if (!btn) return;
    const action = btn.dataset.demo;
    state.triggerDemo(action);
    bus.send({ cmd: 'triggerDemo', action });
  });

  // --- 4. REAL MODEL GALLERY & DYNAMIC VRM / LIVE2D EXPRESSION-MOTION CONTROLS ---
  let lastCapSig = '';

  function refreshModelCapabilitiesUI() {
    const cfg = state.cfg;
    const av = R.getAvatar(cfg.avatar, cfg.customAssets);
    const vrmCard = document.getElementById('vrm-controls-card');
    const l2dCard = document.getElementById('l2d-controls-card');
    if (vrmCard) vrmCard.classList.toggle('hidden', av.renderer !== 'vrm3d');
    if (l2dCard) l2dCard.classList.toggle('hidden', av.renderer !== 'live2d');

    const cap = pipeline.getActiveCapabilities(state);
    const sig = av.id + '|' + cap.kind + '|' + cap.ready + '|' + (cap.expressions || []).join(',') + '|' + (cap.motions || []).length + '|' + (cfg.hasCubismCore ? 1 : 0);
    if (sig === lastCapSig) return;
    lastCapSig = sig;

    if (av.renderer === 'vrm3d') {
      const strip = document.getElementById('vrm-expr-strip');
      if (strip) {
        strip.innerHTML = '';
        const labels = { happy: '开心微笑', relaxed: '温柔放松', surprised: '惊讶睁眼', sad: '委屈失落', angry: '鼓嘴生气' };
        const avail = (cap.expressions && cap.expressions.length)
          ? cap.expressions.filter((n) => labels[n])
          : ['happy', 'relaxed', 'surprised', 'sad', 'angry'];
        const list = avail.length ? avail : ['happy', 'relaxed', 'surprised', 'sad', 'angry'];
        list.forEach((expr) => {
          const b = document.createElement('button');
          b.className = 'expr-chip';
          b.textContent = labels[expr] || expr;
          b.addEventListener('click', () => {
            pipeline.triggerExpression(state, expr);
            bus.send({ cmd: 'triggerExpression', name: expr });
          });
          strip.appendChild(b);
        });
      }
      const clearVrmaBtn = document.getElementById('btn-clear-vrma');
      if (clearVrmaBtn) {
        clearVrmaBtn.style.display = cfg.vrmaUrl ? '' : 'none';
      }
    } else if (av.renderer === 'live2d') {
      const desc = document.getElementById('l2d-ctrl-desc');
      const inlineBtn = document.getElementById('btn-l2d-import-core-inline');
      const expStrip = document.getElementById('l2d-expr-strip');
      const motStrip = document.getElementById('l2d-motion-strip');
      const coreOk = !!(cfg.hasCubismCore || cap.hasCore);
      if (inlineBtn) inlineBtn.style.display = coreOk ? 'none' : '';
      if (desc) {
        if (!coreOk) {
          desc.textContent = '当前为贴图预览模式 — 导入官方 live2dcubismcore.min.js 后立即解锁完整蒙版、物理与骨骼表情';
        } else if (cap.isBongoCat) {
          desc.textContent = 'BongoCat / Mver 模式已激活（逐键手部图层 + 骨骼物理已联动）';
        } else {
          desc.textContent = cap.ready
            ? 'Live2D 引擎运行中（蒙版裁剪 + 物理模拟已启用），点击下方按钮触发模型自带表情与动作'
            : '正在加载 Live2D 模型资源…';
        }
      }
      if (expStrip) {
        expStrip.innerHTML = '';
        (cap.expressions || []).forEach((name) => {
          const b = document.createElement('button');
          b.className = 'expr-chip';
          b.textContent = '表情 · ' + name;
          b.addEventListener('click', () => {
            pipeline.triggerExpression(state, name);
            bus.send({ cmd: 'triggerExpression', name });
          });
          expStrip.appendChild(b);
        });
      }
      if (motStrip) {
        motStrip.innerHTML = '';
        (cap.motions || []).slice(0, 12).forEach((m) => {
          const b = document.createElement('button');
          b.className = 'expr-chip';
          b.textContent = '动作 · ' + m.label;
          b.addEventListener('click', () => {
            pipeline.triggerMotion(state, m.group, m.index);
            bus.send({ cmd: 'triggerMotion', group: m.group, index: m.index });
          });
          motStrip.appendChild(b);
        });
      }
    }
  }

  pipeline.vrm.onModelLoaded = () => {
    lastCapSig = '';
    refreshModelCapabilitiesUI();
  };
  pipeline.live2d.onModelLoaded = () => {
    lastCapSig = '';
    refreshModelCapabilitiesUI();
  };

  // --- 5. RENDER MODEL GALLERY & CONFIG GRIDS ---
  function renderAvatarGrid() {
    const grid = document.getElementById('avatar-grid');
    grid.innerHTML = '';

    const allAvatars = R.avatars.slice();
    (state.cfg.customAssets || []).forEach((a) => {
      if (a.kind !== 'soundpack' && a.kind !== 'vrma') {
        allAvatars.push(R.getAvatar('custom:' + a.id, state.cfg.customAssets));
      }
    });

    allAvatars.forEach((av) => {
      const btn = document.createElement('button');
      btn.className = 'opt-card avatar-card' + (state.cfg.avatar === av.id ? ' active' : '');
      btn.dataset.id = av.id;

      const thumbSrc = av.customAsset
        ? (av.customAsset.previewUrl || (av.customAsset.kind === 'avatar25d' ? av.customAsset.entryUrl : ''))
        : (av.thumbUrl || '');
      const dotsHtml = (av.previewColors || ['#4E6FA6', '#F3EDE2', '#D85B43'])
        .map((c) => '<span class="mini-dot" style="background:' + c + '"></span>').join('');

      btn.innerHTML =
        '<div class="av-thumb-box">' +
          (thumbSrc
            ? '<img class="av-thumb-img" src="' + escapeHtml(thumbSrc) + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\';" />' +
              '<div class="av-thumb-custom" style="display:none">' + escapeHtml(av.badge) + '</div>'
            : '<div class="av-thumb-custom">' + escapeHtml(av.badge) + '</div>') +
        '</div>' +
        '<div class="av-meta">' +
          '<div class="opt-top">' +
            '<span class="opt-badge">' + escapeHtml(av.badge) + '</span>' +
            '<span class="mini-dots">' + dotsHtml + '</span>' +
          '</div>' +
          '<div class="opt-title">' + escapeHtml(av.name) + '</div>' +
          '<div class="opt-sub">' + escapeHtml(av.subtitle) + '</div>' +
        '</div>';

      btn.addEventListener('click', () => {
        const patch = { avatar: av.id, avatarVariant: '' };
        if (av.customAsset) {
          patch.customEyeX = av.customAsset.eyeAnchorX;
          patch.customEyeY = av.customAsset.eyeAnchorY;
          patch.customScale = av.customAsset.scale;
          patch.customOffsetY = av.customAsset.offsetY;
        }
        lastCapSig = '';
        patchConfig(patch);
      });
      grid.appendChild(btn);
    });

    // Bridge card leading straight to the External Model Ecosystem!
    const moreBtn = document.createElement('button');
    moreBtn.className = 'opt-card avatar-card add-model-card';
    moreBtn.innerHTML =
      '<div class="av-thumb-box add-thumb">+</div>' +
      '<div class="av-meta">' +
        '<div class="opt-top"><span class="opt-badge">双引擎导入</span></div>' +
        '<div class="opt-title">导入 Live2D / BongoCat / VRM</div>' +
        '<div class="opt-sub">支持 BongoCat .zip、Mver 包、VRoid .vrm 与 .vrma 动作</div>' +
      '</div>';
    moreBtn.addEventListener('click', () => {
      const tabBtn = document.querySelector('.nav-tab[data-tab="workshop"]');
      if (tabBtn) tabBtn.click();
    });
    grid.appendChild(moreBtn);
  }

  function renderPaletteStrip() {
    const strip = document.getElementById('palette-strip');
    if (!strip) return;
    strip.innerHTML = '';
    R.palettes.forEach((p) => {
      const btn = document.createElement('button');
      btn.className = 'pal-btn' + (state.cfg.palette === p.id ? ' active' : '');
      btn.dataset.id = p.id;
      btn.innerHTML =
        '<span class="pal-orb" style="background:' + p.swatch + '"></span>' +
        '<span>' + p.name + '</span>';
      btn.addEventListener('click', () => patchConfig({ palette: p.id }));
      strip.appendChild(btn);
    });
  }

  function renderSoundPacks() {
    const el = document.getElementById('sound-pack-list');
    if (!el) return;
    el.innerHTML = '';
    const packs = R.soundPacks.slice();
    (state.cfg.customAssets || []).forEach((a) => {
      if (a.kind === 'soundpack') {
        packs.push({ id: 'custom:' + a.id, name: '自定义 · ' + a.name });
      }
    });
    packs.forEach((sp) => {
      const btn = document.createElement('button');
      btn.className = 'snd-chip' + (state.cfg.soundPack === sp.id ? ' active' : '');
      btn.dataset.id = sp.id;
      btn.textContent = sp.name;
      btn.addEventListener('click', () => {
        patchConfig({ soundPack: sp.id });
        setTimeout(() => state.onKeyEvent(1, 4, 0, 0, true, undefined, true), 40);
      });
      el.appendChild(btn);
    });
  }

  function renderCustomAssetsList() {
    const list = document.getElementById('custom-asset-list');
    if (!list) return;
    const items = state.cfg.customAssets || [];
    list.innerHTML = '';
    if (items.length === 0) {
      list.innerHTML = '<div class="custom-empty">暂未导入外部模型 — 点击上方按钮导入 Awesome-BongoCat .zip、Live2D .model3.json、VRoid .vrm 或 .vrma 动作</div>';
      return;
    }
    items.forEach((a) => {
      const row = document.createElement('div');
      row.className = 'custom-item';
      const isActive = state.cfg.avatar === 'custom:' + a.id
        || state.cfg.soundPack === 'custom:' + a.id
        || (a.kind === 'vrma' && state.cfg.vrmaUrl === a.entryUrl);
      row.innerHTML =
        '<div class="custom-item-meta">' +
          '<div class="custom-item-name">' + escapeHtml(a.name) + '</div>' +
          '<div class="custom-item-sub">' + escapeHtml(a.notes || a.kind) + '</div>' +
        '</div>' +
        '<div class="custom-item-btns">' +
          '<button class="primary-mini-btn" data-use="' + a.id + '">' + (isActive ? '使用中' : '立即应用') + '</button>' +
          '<button class="danger-btn" data-del="' + a.id + '">移除</button>' +
        '</div>';
      row.querySelector('[data-use]').addEventListener('click', () => {
        if (a.kind === 'soundpack') {
          patchConfig({ soundPack: 'custom:' + a.id });
        } else if (a.kind === 'vrma') {
          patchConfig({ vrmaUrl: a.entryUrl });
        } else {
          lastCapSig = '';
          patchConfig({
            avatar: 'custom:' + a.id,
            customEyeX: a.eyeAnchorX,
            customEyeY: a.eyeAnchorY,
            customScale: a.scale,
            customOffsetY: a.offsetY,
          });
        }
        showToast('已切换至：' + a.name);
      });
      row.querySelector('[data-del]').addEventListener('click', () => {
        bus.send({ cmd: 'deleteAsset', id: a.id });
      });
      list.appendChild(row);
    });
  }

  // --- 6. WIRE SWITCHES, SEGMENTS, DEBOUNCED SLIDERS & ACTIONS ---
  document.querySelectorAll('input.ios-switch[data-cfg]').forEach((inp) => {
    inp.addEventListener('change', () => {
      patchConfig({ [inp.dataset.cfg]: inp.checked });
    });
  });

  const vrmCamSeg = document.getElementById('vrmcam-seg');
  if (vrmCamSeg) {
    vrmCamSeg.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-opt');
      if (b) patchConfig({ vrmCamera: b.dataset.val });
    });
  }

  const shaderSeg = document.getElementById('shader3d-seg');
  if (shaderSeg) {
    shaderSeg.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-opt');
      if (b) patchConfig({ shader3d: b.dataset.val });
    });
  }

  const clearVrmaBtn = document.getElementById('btn-clear-vrma');
  if (clearVrmaBtn) {
    clearVrmaBtn.addEventListener('click', () => {
      patchConfig({ vrmaUrl: '' });
      showToast('已恢复程序化桌伴姿态');
    });
  }

  const dockSeg = document.getElementById('dockmode-seg');
  if (dockSeg) {
    dockSeg.addEventListener('click', (e) => {
      const b = e.target.closest('.seg-opt');
      if (b) patchConfig({ dockMode: b.dataset.val });
    });
  }

  document.querySelectorAll('.eco-link-btn[data-url]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      if (bus.isNative) bus.send({ cmd: 'openUrl', url });
      else window.open(url, '_blank');
    });
  });

  const inlineCoreBtn = document.getElementById('btn-l2d-import-core-inline');
  if (inlineCoreBtn) {
    inlineCoreBtn.addEventListener('click', () => {
      if (!bus.isNative) {
        showToast('请在桌面端 KuroCat.exe 中选择本地 live2dcubismcore.min.js', false);
        return;
      }
      bus.send({ cmd: 'importCubismCore' });
    });
  }

  const volSlider = document.getElementById('vol-slider');
  volSlider.addEventListener('input', () => {
    const v = Number(volSlider.value) / 100;
    document.getElementById('vol-val').textContent = volSlider.value + '%';
    patchConfig({ soundVolume: v }, true);
  });
  volSlider.addEventListener('change', () => {
    patchConfig({ soundVolume: Number(volSlider.value) / 100 }, false);
  });

  const scaleSlider = document.getElementById('scale-slider');
  scaleSlider.addEventListener('input', () => {
    const v = Number(scaleSlider.value) / 100;
    document.getElementById('scale-val').textContent = scaleSlider.value + '%';
    patchConfig({ scale: v }, true);
  });
  scaleSlider.addEventListener('change', () => {
    patchConfig({ scale: Number(scaleSlider.value) / 100 }, false);
  });

  // Custom anchor calibrator sliders (with live eye-reticle crosshair overlay!)
  let crosshairHideTimer = null;
  function flashCalibrationCrosshair(ms) {
    state.showCalibrationCrosshair = true;
    clearTimeout(crosshairHideTimer);
    crosshairHideTimer = setTimeout(() => { state.showCalibrationCrosshair = false; }, ms || 1600);
  }

  const calBind = (id, valId, key, toCfg, fmt, isEyeAxis) => {
    const sl = document.getElementById(id);
    sl.addEventListener('input', () => {
      const cv = toCfg(Number(sl.value));
      document.getElementById(valId).textContent = fmt(Number(sl.value));
      if (isEyeAxis) flashCalibrationCrosshair(1800);
      patchConfig({ [key]: cv }, true);
    });
    sl.addEventListener('change', () => {
      patchConfig({ [key]: toCfg(Number(sl.value)) }, false);
    });
    if (isEyeAxis) {
      sl.addEventListener('pointerenter', () => { state.showCalibrationCrosshair = true; clearTimeout(crosshairHideTimer); });
      sl.addEventListener('pointerleave', () => flashCalibrationCrosshair(400));
    }
  };
  calBind('cal-eyex', 'cal-eyex-val', 'customEyeX', (v) => v / 100, (v) => v + '%', true);
  calBind('cal-eyey', 'cal-eyey-val', 'customEyeY', (v) => v / 100, (v) => v + '%', true);
  calBind('cal-scale', 'cal-scale-val', 'customScale', (v) => v / 100, (v) => v + '%', false);
  calBind('cal-offy', 'cal-offy-val', 'customOffsetY', (v) => v, (v) => v + ' px', false);

  document.querySelectorAll('.import-card[data-import]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!bus.isNative) {
        showToast('请在桌面端 KuroCat.exe 中使用原生本地导入对话框', false);
        return;
      }
      bus.send({ cmd: 'importAsset', kind: btn.dataset.import });
    });
  });

  const cubismBtn = document.getElementById('btn-import-cubism');
  if (cubismBtn) {
    cubismBtn.addEventListener('click', () => {
      if (!bus.isNative) {
        showToast('请在桌面端 KuroCat.exe 中选择本地 live2dcubismcore.min.js', false);
        return;
      }
      bus.send({ cmd: 'importCubismCore' });
    });
  }

  document.getElementById('btn-open-assets').addEventListener('click', () => bus.send({ cmd: 'openAssetsFolder' }));
  document.getElementById('btn-reset-pos').addEventListener('click', () => {
    bus.send({ cmd: 'resetPos' });
    showToast('桌宠已复位至屏幕右下角');
  });
  document.getElementById('btn-quit-app').addEventListener('click', () => bus.send({ cmd: 'quitApp' }));

  // Lightweight state sync without destroying/rebuilding DOM grids!
  function syncLightweightControls() {
    const cfg = state.cfg;
    applyStudioTheme();
    refreshModelCapabilitiesUI();

    const cubPill = document.getElementById('cubism-status-pill');
    if (cubPill) {
      const coreOk = !!(cfg.hasCubismCore || (window.KuroLive2DRenderer && window.KuroLive2DRenderer.isCoreAvailable && window.KuroLive2DRenderer.isCoreAvailable()));
      cubPill.textContent = coreOk ? 'Cubism Core 已激活' : '待导入 Core';
      cubPill.classList.toggle('ok', coreOk);
    }

    document.querySelectorAll('#avatar-grid .opt-card').forEach((b) => b.classList.toggle('active', b.dataset.id === cfg.avatar));
    document.querySelectorAll('#palette-strip .pal-btn').forEach((b) => b.classList.toggle('active', b.dataset.id === cfg.palette));
    document.querySelectorAll('#sound-pack-list .snd-chip').forEach((b) => b.classList.toggle('active', b.dataset.id === cfg.soundPack));

    document.querySelectorAll('#vrmcam-seg .seg-opt').forEach((b) => b.classList.toggle('active', b.dataset.val === (cfg.vrmCamera || 'bust')));
    document.querySelectorAll('#shader3d-seg .seg-opt').forEach((b) => b.classList.toggle('active', b.dataset.val === cfg.shader3d));
    document.querySelectorAll('#dockmode-seg .seg-opt').forEach((b) => b.classList.toggle('active', b.dataset.val === cfg.dockMode));

    document.querySelectorAll('input.ios-switch[data-cfg]').forEach((inp) => {
      inp.checked = !!cfg[inp.dataset.cfg];
    });

    if (document.activeElement !== volSlider) {
      volSlider.value = Math.round((cfg.soundVolume || 0.72) * 100);
      document.getElementById('vol-val').textContent = volSlider.value + '%';
    }
    if (document.activeElement !== scaleSlider) {
      scaleSlider.value = Math.round((cfg.scale || 1.0) * 100);
      document.getElementById('scale-val').textContent = scaleSlider.value + '%';
    }

    const calEx = document.getElementById('cal-eyex');
    const calEy = document.getElementById('cal-eyey');
    const calSc = document.getElementById('cal-scale');
    const calOy = document.getElementById('cal-offy');
    if (document.activeElement !== calEx) {
      calEx.value = Math.round((cfg.customEyeX || 0.48) * 100);
      document.getElementById('cal-eyex-val').textContent = calEx.value + '%';
    }
    if (document.activeElement !== calEy) {
      calEy.value = Math.round((cfg.customEyeY || 0.34) * 100);
      document.getElementById('cal-eyey-val').textContent = calEy.value + '%';
    }
    if (document.activeElement !== calSc) {
      calSc.value = Math.round((cfg.customScale || 1.0) * 100);
      document.getElementById('cal-scale-val').textContent = calSc.value + '%';
    }
    if (document.activeElement !== calOy) {
      calOy.value = Math.round(cfg.customOffsetY || 0);
      document.getElementById('cal-offy-val').textContent = calOy.value + ' px';
    }
  }

  function syncAllControls() {
    if (!gridsBuilt) {
      gridsBuilt = true;
      renderPaletteStrip();
    }
    const sig = JSON.stringify((state.cfg.customAssets || []).map((a) => a.id + ':' + a.name + ':' + (state.cfg.avatar === 'custom:' + a.id || state.cfg.soundPack === 'custom:' + a.id || state.cfg.vrmaUrl === a.entryUrl)));
    if (sig !== lastCustomSig) {
      lastCustomSig = sig;
      renderAvatarGrid();
      renderSoundPacks();
      renderCustomAssetsList();
    }
    syncLightweightControls();
  }

  function setStudioVisible(v) {
    const next = !!v;
    if (next === studioVisible) return;
    studioVisible = next;
    if (studioVisible) {
      lastTs = performance.now();
      if (!rafId) rafId = requestAnimationFrame(loop);
    }
  }

  // Receive live host messages & telemetry
  const CAT_LABELS = {
    coding: '写代码模式',
    gaming: '电竞模式',
    media: '影音听歌模式',
    creative: '画图创作模式',
    general: '日常通用',
  };

  bus.onMessage((msg) => {
    if (!msg || !msg.t) return;
    if (msg.t === 'cfg' && msg.cfg) {
      state.applyConfig(msg.cfg);
      pipeline.pruneUnusedAssets(state.cfg.customAssets);
      syncAllControls();
    } else if (msg.t === 'vis') {
      setStudioVisible(msg.v);
    } else if (msg.t === 'hk') {
      ['s', 'd', 'p', 'h'].forEach((k) => {
        const el = document.querySelector('.hk-status[data-hk="' + k + '"]');
        if (!el) return;
        const ok = !!msg[k];
        el.textContent = ok ? '已生效' : '已被占用';
        el.classList.toggle('conflict', !ok);
      });
    } else if (msg.t === 'k') {
      state.onKeyEvent(msg.r, msg.c, msg.h, msg.k, msg.d === 1, msg.tk, false, msg.vk);
    } else if (msg.t === 'mb') {
      state.onMouseButton(msg.b, msg.d === 1, msg.tc);
    } else if (msg.t === 'mw') {
      state.onMouseWheel(msg.dy);
    } else if (msg.t === 'aud') {
      state.onAudioData(msg.lvl, msg.bass, msg.beat, msg.play);
      document.getElementById('audio-meter-fill').style.width = Math.round(Math.min(1, msg.lvl * 1.4) * 100) + '%';
      document.getElementById('audio-meter-state').textContent = msg.play ? '律动中' : '静音';
    } else if (msg.t === 'ctx') {
      state.onContextData(msg.cat, msg.proc, msg.night, msg.ar, msg.ag, msg.ab, msg.alum);
      const lbl = CAT_LABELS[msg.cat] || '日常通用';
      document.getElementById('tele-app').textContent = lbl;
      document.getElementById('live-ctx-label').textContent = lbl + (msg.night ? ' · 深夜' : '');
    } else if (msg.t === 'meme') {
      state.onShortcutMeme(msg.id);
    } else if (msg.t === 'toast') {
      showToast(msg.msg, msg.level === 'err');
    }
  });

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.__kuroStudio = { state, pipeline, patchConfig };

  syncAllControls();
  let lastTs = performance.now();
  let lastK = -1, lastC = -1;

  function loop(now) {
    if (!studioVisible) {
      rafId = 0;
      return;
    }
    const dt = (now - lastTs) / 1000;
    lastTs = now;
    state.update(dt);
    pipeline.render(state);

    if (state.cfg.todayKeys !== lastK) {
      lastK = state.cfg.todayKeys;
      document.getElementById('tele-keys').textContent = lastK.toLocaleString('en-US');
    }
    if (state.cfg.todayClicks !== lastC) {
      lastC = state.cfg.todayClicks;
      document.getElementById('tele-clicks').textContent = lastC.toLocaleString('en-US');
    }
    rafId = requestAnimationFrame(loop);
  }

  bus.send({ cmd: 'ready' });
  rafId = requestAnimationFrame(loop);
})();
