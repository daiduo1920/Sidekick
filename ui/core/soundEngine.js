window.KuroSound = (function () {
  let ctx = null;
  let enabled = true;
  let muted = false;
  let volume = 0.72;
  let packId = 'creamy-thock';
  let noiseBuf = null;
  let lastKeyTime = 0;
  let lastPurrTime = 0;

  // Decoded custom .wav/.mp3/.ogg AudioBuffers cached by URL (separate loading set prevents silent-mode lock!)
  const customBuffers = new Map();
  const loadingUrls = new Set();

  function ensureContext(forceForPreview) {
    if (!enabled) return null;
    if (muted && !forceForPreview) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const len = Math.floor(ctx.sampleRate * 0.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + w * 0.029;
        b1 = 0.985 * b1 + w * 0.032;
        b2 = 0.950 * b2 + w * 0.048;
        data[i] = (b0 + b1 + b2 + w * 0.12) * 0.55;
      }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function preloadCustomSample(url, forceForPreview) {
    if (!url || customBuffers.has(url) || loadingUrls.has(url)) return;
    const ac = ensureContext(forceForPreview);
    if (!ac) return; // Do NOT poison cache when muted/disabled — will retry once enabled!
    loadingUrls.add(url);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then((arr) => ac.decodeAudioData(arr))
      .then((buf) => {
        if (buf) customBuffers.set(url, buf);
      })
      .catch(() => {})
      .finally(() => {
        loadingUrls.delete(url);
      });
  }

  function playKey(colNorm, isSpace, isAccent, customUrl, forceForPreview) {
    const ac = ensureContext(forceForPreview);
    if (!ac) return;
    const now = ac.currentTime;
    if (now - lastKeyTime < 0.020) return;
    lastKeyTime = now;

    const vol = Math.max(0.05, Math.min(1.0, volume));

    // If user selected a custom imported .wav/.mp3 sound pack and it's decoded, play it!
    if (packId.startsWith('custom:') && customUrl) {
      const buf = customBuffers.get(customUrl);
      if (buf) {
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = (isSpace ? 0.86 : 0.95 + (colNorm - 0.5) * 0.12 + (Math.random() - 0.5) * 0.06);
        const g = ac.createGain();
        g.gain.value = 0.36 * vol;
        src.connect(g);
        g.connect(ac.destination);
        src.start(now);
        return;
      } else {
        preloadCustomSample(customUrl, forceForPreview);
      }
    }

    // Procedural acoustic switch synthesizer (3 curated profiles)
    if (packId === 'silent-plush') {
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(isSpace ? 520 : 760, now);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.045 * vol, now + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);
      src.connect(lp); lp.connect(g); g.connect(ac.destination);
      src.start(now, Math.random() * 0.25, 0.04);
      return;
    }

    const isCrisp = packId === 'tactile-blue';
    const osc = ac.createOscillator();
    const bodyG = ac.createGain();
    const baseFreq = isSpace
      ? (isCrisp ? 175 : 132)
      : (isAccent ? 185 : (isCrisp ? 245 : 196) + (colNorm - 0.5) * 34 + (Math.random() - 0.5) * 14);
    osc.type = isCrisp ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(baseFreq * 1.5, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.62, now + 0.036);

    bodyG.gain.setValueAtTime(0.0001, now);
    bodyG.gain.linearRampToValueAtTime((isSpace ? 0.10 : 0.072) * vol, now + 0.0025);
    bodyG.gain.exponentialRampToValueAtTime(0.0001, now + (isSpace ? 0.06 : 0.044));
    osc.connect(bodyG); bodyG.connect(ac.destination);
    osc.start(now); osc.stop(now + 0.068);

    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(isCrisp ? 3400 + Math.random() * 500 : (isSpace ? 1280 : 1980), now);
    bp.Q.setValueAtTime(isCrisp ? 3.2 : 2.1, now);
    const cg = ac.createGain();
    cg.gain.setValueAtTime(0.0001, now);
    cg.gain.linearRampToValueAtTime((isCrisp ? 0.08 : 0.055) * vol, now + 0.0015);
    cg.gain.exponentialRampToValueAtTime(0.0001, now + (isCrisp ? 0.015 : 0.019));
    src.connect(bp); bp.connect(cg); cg.connect(ac.destination);
    src.start(now, Math.random() * 0.25, 0.025);
  }

  function playMouseClick(btn) {
    const ac = ensureContext();
    if (!ac) return;
    const now = ac.currentTime;
    const vol = Math.max(0.05, Math.min(1.0, volume));

    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(btn === 1 ? 2350 : 2900, now);
    bp.Q.setValueAtTime(3.3, now);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.052 * vol, now + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.016);
    src.connect(bp); bp.connect(g); g.connect(ac.destination);
    src.start(now, Math.random() * 0.2, 0.022);
  }

  function playPurrPulse() {
    const ac = ensureContext();
    if (!ac) return;
    const now = ac.currentTime;
    if (now - lastPurrTime < 0.36) return;
    lastPurrTime = now;
    const vol = Math.max(0.05, Math.min(1.0, volume));

    const osc = ac.createOscillator();
    const lfo = ac.createOscillator();
    const lg = ac.createGain();
    const m = ac.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(64, now);
    lfo.type = 'sine'; lfo.frequency.setValueAtTime(24, now);
    lg.gain.setValueAtTime(0.014 * vol, now);
    m.gain.setValueAtTime(0.0001, now);
    m.gain.linearRampToValueAtTime(0.026 * vol, now + 0.09);
    m.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    lfo.connect(lg); lg.connect(m.gain);
    osc.connect(m); m.connect(ac.destination);
    osc.start(now); lfo.start(now);
    osc.stop(now + 0.36); lfo.stop(now + 0.36);
  }

  function playMemeChime(memeId) {
    const ac = ensureContext();
    if (!ac) return;
    const now = ac.currentTime;
    const vol = Math.max(0.05, Math.min(1.0, volume));
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';

    if (memeId === 'save_zen') {
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.exponentialRampToValueAtTime(990, now + 0.11);
    } else if (memeId === 'undo_panic') {
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(340, now + 0.12);
    } else if (memeId === 'cv_flurry') {
      osc.frequency.setValueAtTime(740, now);
      osc.frequency.exponentialRampToValueAtTime(1080, now + 0.08);
    } else {
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.09);
    }
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.036 * vol, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(g); g.connect(ac.destination);
    osc.start(now); osc.stop(now + 0.15);
  }

  return {
    configure(en, vol, pack, customUrl) {
      enabled = !!en;
      volume = typeof vol === 'number' ? vol : 0.72;
      packId = pack || 'creamy-thock';
      if (enabled && packId.startsWith('custom:') && customUrl) {
        preloadCustomSample(customUrl, false);
      }
    },
    setMuted(m) {
      muted = !!m;
    },
    playKey,
    playMouseClick,
    playPurrPulse,
    playMemeChime,
  };
})();
