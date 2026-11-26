window.KuroState = (function () {
  class Spring {
    constructor(value, stiffness, damping) {
      this.value = value;
      this.target = value;
      this.velocity = 0;
      this.stiffness = stiffness;
      this.damping = damping;
    }
    impulse(v) { this.velocity += v; }
    step(dt) {
      const steps = dt > 0.02 ? 2 : 1;
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const accel = (this.target - this.value) * this.stiffness - this.velocity * this.damping;
        this.velocity += accel * h;
        this.value += this.velocity * h;
      }
      return this.value;
    }
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  class CompanionState {
    constructor(opts) {
      this.time = 0;
      this.silentGlobal = !!(opts && opts.silentGlobal);
      this.ambientOverride = null; // Optional Studio preview backdrop override [r, g, b, lum]
      this.showCalibrationCrosshair = false;

      // Active full config synced from Host (v5 VRM 3D + Live2D/BongoCat dual engine defaults)
      this.cfg = {
        avatar: 'vrm-sample-a',
        avatarVariant: '',
        shader3d: 'mtoon',
        vrmCamera: 'bust',
        vrmaUrl: '',
        keyboard: 'signature',
        mouseGear: 'pebble-wireless',
        deskMat: 'minimal-felt',
        palette: 'washi-amber',
        studioTheme: 'atelier-light',
        dockMode: 'desk',
        scale: 1.0,
        clickThrough: false,
        topMost: true,
        autoStart: false,
        pauseOnFullscreen: true,
        hasCubismCore: false,
        eyeTrackCursor: true,
        eyeProximityFX: true,
        petting: true,
        appContextAuto: true,
        audioReactive: true,
        shortcutMemes: true,
        ambientFusion: true,
        sound: true,
        soundPack: 'creamy-thock',
        soundVolume: 0.72,
        propCoffee: true,
        propHeadphones: true,
        propLedStrip: true,
        showMiniCounter: false,
        customEyeX: 0.48,
        customEyeY: 0.34,
        customScale: 1.0,
        customOffsetY: 0.0,
        todayKeys: 0,
        todayClicks: 0,
        customAssets: [],
      };

      // Active canonical key names for exact BongoCat / BongoCatMver per-key hand & keycap overlays
      this.activeKeyMap = new Map();
      this.manualExpression = '';
      this.manualExpressionTimer = 0;

      // --- 1. TRUE SCREEN-SPACE EYE TRACKING & PROXIMITY ---
      this.cursorScreenX = 0;
      this.cursorScreenY = 0;
      this.cursorNormX = 0.5;
      this.cursorNormY = 0.5;
      this.localX = -1;
      this.localY = -1;
      this.prevLocalX = -1;
      this.prevLocalY = -1;
      this.hasRealScreenVec = false;
      this.cursorDistPx = 600;
      this.nearness = new Spring(0, 80, 14);      // 0 (far) .. 1 (right in front of eyes!)
      this.eyeConverge = new Spring(0, 130, 18);  // binocular inward cross-eye focus when very close
      this.targetLookX = 0;
      this.targetLookY = 0;

      // Rapid circle-around-eyes -> adorable dizzy interaction!
      this.prevCursorAngle = null;
      this.circleAccum = 0;
      this.dizzyTimer = 0;

      // --- 2. SYSTEM CONTEXT & WALLPAPER AMBIENT FUSION ---
      this.appCategory = 'general'; // coding | gaming | media | creative | general
      this.activeProc = '';
      this.isLateNight = false;
      this.ambientRgb = [46, 54, 72];
      this.ambientLum = 0.22;

      // --- 3. WASAPI AUDIO REACTIVE ---
      this.audioLevel = 0;
      this.audioBass = 0;
      this.audioBeat = 0;
      this.audioPlaying = false;
      this.musicNod = new Spring(0, 180, 16);
      this.musicNoteTimer = 0.8;

      // --- 4. SHORTCUT MEME STATE ---
      this.memeId = '';       // undo_panic | save_zen | cv_flurry | enter_slam
      this.memeTimer = 0;
      this.saveWave = 0;      // 0..1 shimmering sweep across keycaps on Ctrl+S
      this.enterShock = 0;    // 0..1 crisp pulse ring on Enter slam

      // --- 5. MOODS, IDLE, TYPING CPS & PETTING ---
      this.idleTime = 0;
      this.timeSinceMouseMove = 5.0;
      this.timeSinceRightKb = 5.0;
      this.keyTimestamps = [];
      this.cps = 0;
      this.turboLevel = 0;

      this.mood = 'active'; // active | idle | turbo | yawn | sleep | pet | dizzy | meme
      this.yawnProgress = 0;
      this.hasYawnedThisIdle = false;
      this.sleepBlend = new Spring(0, 44, 11);
      this.yawnOpen = new Spring(0, 120, 15);
      this.alertPop = new Spring(0, 260, 16);

      this.blinkTimer = 2.4;
      this.blinkPhase = 0;
      this.blinkActive = false;
      this.blinkClock = 0;
      this.blinkDur = 0.14;
      this.earTwitchTimer = 3.8;

      this.petHeat = 0;
      this.petBlend = new Spring(0, 68, 13);
      this.petLeanX = new Spring(0, 82, 13);
      this.petParticleTimer = 0;
      this.zzzTimer = 0;
      this.turboSparkTimer = 0;

      // --- 6. ANATOMICAL SPRINGS (Head, Hair, Eyes, Brows, Ears, Body) ---
      this.headYaw = new Spring(0, 125, 16);
      this.headPitch = new Spring(0, 125, 16);
      this.headRoll = new Spring(0, 95, 14);
      this.eyeX = new Spring(0, 380, 25);
      this.eyeY = new Spring(0, 380, 25);
      this.pupilSize = new Spring(0.56, 75, 14);
      this.browLift = new Spring(0, 130, 16);   // -1 furrowed .. +1 curious/surprised
      this.earL = new Spring(0, 150, 13);
      this.earR = new Spring(0, 150, 13);
      this.hairSway = new Spring(0, 72, 8.5);   // silky anime secondary hair lag!
      this.ahogeBounce = new Spring(0, 110, 7.5);
      this.bodyBounce = new Spring(0, 220, 15);
      this.bodyLean = new Spring(0, 85, 13);

      // --- 7. PERIPHERALS (Keyboard, Mouse, Pen, Gamepad) ---
      this.mouseX = new Spring(0.5, 200, 20);
      this.mouseY = new Spring(0.5, 200, 20);
      this.mouseL = new Spring(0, 440, 26);
      this.mouseR = new Spring(0, 440, 26);
      this.mouseM = new Spring(0, 440, 26);
      this.scrollAngle = 0;
      this.scrollVel = 0;
      this.mouseClickFlash = 0;

      this.keys = [];
      for (let i = 0; i < window.KuroKeymap.count; i++) {
        this.keys.push({
          down: false,
          holdTimer: 0,
          press: new Spring(0, 540, 26),
          glow: 0,
        });
      }

      this.leftPawU = new Spring(0.30, 270, 22);
      this.leftPawV = new Spring(0.55, 270, 22);
      this.leftPawDown = new Spring(0, 500, 26);
      this.leftPawHold = 0;

      this.rightPawMode = new Spring(0, 145, 18); // 0=gear, 1=right-half keyboard
      this.rightPawU = new Spring(0.76, 270, 22);
      this.rightPawV = new Spring(0.55, 270, 22);
      this.rightPawDown = new Spring(0, 500, 26);
      this.rightPawHold = 0;

      // 3D turntable inspect orbit
      this.orbitYaw = new Spring(0, 95, 14);
      this.orbitPitch = new Spring(0, 95, 14);

      this.particles = [];
    }

    applyConfig(newCfg) {
      if (!newCfg) return;
      Object.assign(this.cfg, newCfg);
      const customSound = this.resolveCustomSoundUrl();
      window.KuroSound.configure(this.cfg.sound, this.cfg.soundVolume, this.cfg.soundPack, customSound);
    }

    resolveCustomSoundUrl() {
      if (!this.cfg.soundPack || !this.cfg.soundPack.startsWith('custom:')) return null;
      const cid = this.cfg.soundPack.slice(7);
      const item = (this.cfg.customAssets || []).find((a) => a.id === cid);
      return item ? item.entryUrl : null;
    }

    // Effective gear & props combining user preference + Direction 1 App Context Awareness
    getEffectiveGear() {
      if (this.cfg.dockMode === 'peek') return 'none';
      if (this.cfg.appContextAuto && this.cfg.mouseGear !== 'none') {
        if (this.appCategory === 'creative') return 'pen-tablet';
        if (this.appCategory === 'gaming') return 'gamepad-pro';
      }
      return this.cfg.mouseGear;
    }

    shouldShowCoffee() {
      if (this.cfg.dockMode === 'peek' || !this.cfg.propCoffee) return false;
      if (!this.cfg.appContextAuto) return true;
      return this.appCategory === 'coding' || this.isLateNight || this.appCategory === 'general';
    }

    shouldShowHeadphones() {
      if (!this.cfg.propHeadphones) return false;
      if (!this.cfg.appContextAuto) return true;
      return this.appCategory === 'media' || this.audioPlaying;
    }

    getEyeAnchor() {
      const av = window.KuroRegistry.getAvatar(this.cfg.avatar, this.cfg.customAssets);
      if (this.cfg.dockMode === 'peek') return av.peekEyeAnchor || { x: 0.50, y: 0.34 };
      if (av.customAsset) {
        return { x: this.cfg.customEyeX, y: this.cfg.customEyeY };
      }
      return av.eyeAnchor || { x: 0.50, y: 0.36 };
    }

    static vkToKeyName(vk) {
      if (vk >= 0x41 && vk <= 0x5A) return 'Key' + String.fromCharCode(vk);
      if (vk >= 0x30 && vk <= 0x39) return 'Digit' + String.fromCharCode(vk);
      if (vk >= 0x70 && vk <= 0x7B) return 'F' + (vk - 0x6F);
      const map = {
        0x20: 'Space', 0x0D: 'Enter', 0x09: 'Tab', 0x08: 'Backspace', 0x1B: 'Escape',
        0x14: 'CapsLock', 0xA0: 'ShiftLeft', 0x10: 'ShiftLeft', 0xA1: 'ShiftRight',
        0xA2: 'ControlLeft', 0x11: 'ControlLeft', 0xA3: 'ControlRight',
        0xA4: 'AltLeft', 0x12: 'AltLeft', 0xA5: 'AltRight',
        0x25: 'ArrowLeft', 0x26: 'ArrowUp', 0x27: 'ArrowRight', 0x28: 'ArrowDown',
      };
      return map[vk] || '';
    }

    getActiveKeyNames() {
      const out = [];
      for (const [k, exp] of this.activeKeyMap.entries()) {
        if (exp > this.time) out.push(k);
      }
      return out;
    }

    setManualExpression(name, duration) {
      if (!name || (this.manualExpression === name && this.manualExpressionTimer > 0)) {
        this.manualExpression = '';
        this.manualExpressionTimer = 0;
        return;
      }
      this.manualExpression = name;
      this.manualExpressionTimer = duration || 3.0;
    }

    onKeyEvent(row, col, hand, kind, isDown, tk, forceAudible, vk) {
      if (typeof tk === 'number') this.cfg.todayKeys = tk;
      const idx = window.KuroKeymap.resolveKeyIndex(row, col, kind);
      const km = window.KuroKeymap.keys[idx];
      const ks = this.keys[idx];

      const keyName = (typeof vk === 'number' && vk > 0)
        ? CompanionState.vkToKeyName(vk)
        : (km.isSpace ? 'Space' : (km.label && km.label.length === 1 && /[A-Z]/.test(km.label) ? 'Key' + km.label : ''));

      if (isDown) {
        if (keyName) this.activeKeyMap.set(keyName, this.time + 0.16);
        const wasAsleep = this.mood === 'sleep' || this.mood === 'yawn';
        this.idleTime = 0;
        this.hasYawnedThisIdle = false;
        this.yawnProgress = 0;
        this.yawnOpen.target = 0;
        if (wasAsleep) this.triggerWake();

        ks.down = true;
        ks.holdTimer = 0.085;
        ks.glow = 1.0;

        this.keyTimestamps.push(this.time);
        if (typeof tk !== 'number') this.cfg.todayKeys++;

        const effGear = this.getEffectiveGear();
        const useRightPaw = (effGear === 'none') || (hand === 1 && kind !== 2 && this.timeSinceMouseMove > 0.32 && effGear !== 'gamepad-pro');
        if (useRightPaw) {
          this.timeSinceRightKb = 0;
          this.rightPawU.target = km.uc;
          this.rightPawV.target = km.vc;
          this.rightPawDown.target = 1.0;
          this.rightPawDown.impulse(5.8);
          this.rightPawHold = 0.085;
          this.rightPawMode.target = 1.0;
        } else {
          this.leftPawU.target = km.uc;
          this.leftPawV.target = km.vc;
          this.leftPawDown.target = 1.0;
          this.leftPawDown.impulse(5.8);
          this.leftPawHold = 0.085;
        }

        const punch = km.isSpace ? 1.45 : 1.0;
        this.bodyBounce.impulse(1.65 * punch);
        this.headPitch.impulse(0.6 * punch);
        this.headRoll.impulse((km.uc - 0.5) * 0.38);
        this.hairSway.impulse((km.uc - 0.5) * 1.4);
        this.ahogeBounce.impulse(2.8 * punch);
        this.earL.impulse(-0.55 * punch);
        this.earR.impulse(0.55 * punch);

        if (!this.silentGlobal || forceAudible) {
          window.KuroSound.playKey(km.uc, km.isSpace, km.accent, this.resolveCustomSoundUrl(), !!forceAudible);
        }
      } else {
        ks.down = false;
      }
    }

    onShortcutMeme(memeId) {
      if (!this.cfg.shortcutMemes) return;
      this.memeId = memeId;
      this.idleTime = 0;

      if (memeId === 'undo_panic') {
        this.memeTimer = 2.1;
        this.browLift.impulse(4.0);
        this.ahogeBounce.impulse(9.0);
        this.headRoll.impulse(-1.4);
        this.spawnParticle('sweat', 0.60, 0.24);
        this.spawnParticle('sweat', 0.64, 0.30);
        if (!this.silentGlobal) window.KuroSound.playMemeChime(memeId);
      } else if (memeId === 'save_zen') {
        this.memeTimer = 1.5;
        this.saveWave = 1.0;
        this.headPitch.impulse(2.6); // crisp approving nod!
        this.spawnParticle('sparkle', 0.36, 0.20);
        this.spawnParticle('sparkle', 0.58, 0.22);
        if (!this.silentGlobal) window.KuroSound.playMemeChime(memeId);
      } else if (memeId === 'cv_flurry') {
        this.memeTimer = 1.7;
        this.ahogeBounce.impulse(7.5);
        this.leftPawDown.impulse(8.5);
        this.rightPawDown.impulse(8.5);
        this.spawnParticle('sparkle', 0.30, 0.58);
        this.spawnParticle('sparkle', 0.54, 0.56);
        if (!this.silentGlobal) window.KuroSound.playMemeChime(memeId);
      } else if (memeId === 'enter_slam') {
        this.memeTimer = 0.75;
        this.enterShock = 1.0;
        this.bodyBounce.impulse(4.2);
        this.headPitch.impulse(2.0);
        this.ahogeBounce.impulse(6.0);
      }
    }

    onMouseMoveScreen(sx, sy, wx, wy, ww, wh, vx, vy, vw, vh) {
      const normX = clamp((sx - vx) / Math.max(1, vw), 0, 1);
      const normY = clamp((sy - vy) / Math.max(1, vh), 0, 1);
      const moved = Math.hypot(normX - this.cursorNormX, normY - this.cursorNormY);

      this.cursorScreenX = sx;
      this.cursorScreenY = sy;
      this.cursorNormX = normX;
      this.cursorNormY = normY;

      if (moved > 0.002) {
        const wasAsleep = this.mood === 'sleep' || this.mood === 'yawn';
        this.idleTime = 0;
        this.timeSinceMouseMove = 0;
        this.hasYawnedThisIdle = false;
        this.yawnProgress = 0;
        this.yawnOpen.target = 0;
        if (wasAsleep) this.triggerWake();
      }

      // Compute TRUE Screen-Space Vector from Character's Eyes -> Mouse Cursor!
      const anchor = this.getEyeAnchor();
      const eyeScreenX = wx + anchor.x * ww;
      const eyeScreenY = wy + anchor.y * wh;
      const dx = sx - eyeScreenX;
      const dy = sy - eyeScreenY;
      const dist = Math.hypot(dx, dy);

      this.hasRealScreenVec = true;
      this.cursorDistPx = dist;
      this.targetLookX = Math.tanh(dx / Math.max(130, ww * 0.52));
      this.targetLookY = Math.tanh(dy / Math.max(120, wh * 0.52));

      const near = this.cfg.eyeProximityFX ? clamp(1.0 - dist / Math.max(220, ww * 0.65), 0, 1) : 0;
      this.nearness.target = near;
      this.eyeConverge.target = this.cfg.eyeProximityFX ? clamp(1.0 - dist / 150, 0, 1) : 0;

      // Rapid circling around face -> adorable dizzy spiral eyes!
      if (this.cfg.eyeProximityFX && dist > 18 && dist < 210) {
        const ang = Math.atan2(dy, dx);
        if (this.prevCursorAngle !== null) {
          let delta = ang - this.prevCursorAngle;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          if (Math.abs(delta) < 1.3) {
            this.circleAccum += delta;
            if (Math.abs(this.circleAccum) > Math.PI * 4.2) {
              this.circleAccum = 0;
              this.dizzyTimer = 2.0;
              this.ahogeBounce.impulse(8.5);
              this.spawnParticle('star', 0.42, 0.16);
              this.spawnParticle('star', 0.54, 0.18);
            }
          }
        }
        this.prevCursorAngle = ang;
      } else {
        this.prevCursorAngle = null;
      }

      // Local normalized coordinates inside pet window for head-pat detection
      this.prevLocalX = this.localX;
      this.prevLocalY = this.localY;
      const lx = (sx - wx) / Math.max(1, ww);
      const ly = (sy - wy) / Math.max(1, wh);
      this.localX = (lx >= 0 && lx <= 1 && ly >= 0 && ly <= 1) ? lx : -1;
      this.localY = this.localX >= 0 ? ly : -1;

      if (this.cfg.petting && this.localX >= 0.24 && this.localX <= 0.68 && this.localY >= 0.08 && this.localY <= 0.42) {
        if (this.prevLocalX >= 0) {
          const stroke = Math.hypot(this.localX - this.prevLocalX, this.localY - this.prevLocalY);
          if (stroke > 0.004 && stroke < 0.22) {
            this.petHeat = clamp(this.petHeat + stroke * 4.2, 0, 1.3);
            this.petLeanX.target = clamp((this.localX - 0.46) * 2.2, -0.7, 0.7);
            if (this.petHeat > 0.35 && !this.silentGlobal) window.KuroSound.playPurrPulse();
          }
        }
      }
    }

    onMouseButton(btn, isDown, tc) {
      if (typeof tc === 'number') this.cfg.todayClicks = tc;
      if (isDown) {
        const wasAsleep = this.mood === 'sleep' || this.mood === 'yawn';
        this.idleTime = 0;
        this.timeSinceMouseMove = 0;
        this.hasYawnedThisIdle = false;
        this.yawnProgress = 0;
        this.yawnOpen.target = 0;
        if (wasAsleep) this.triggerWake();
        if (typeof tc !== 'number') this.cfg.todayClicks++;

        this.mouseClickFlash = 1.0;
        this.bodyBounce.impulse(0.9);
        this.ahogeBounce.impulse(2.2);
        this.earR.impulse(0.7);
        if (!this.silentGlobal) window.KuroSound.playMouseClick(btn);
      }

      if (btn === 0) { this.mouseL.target = isDown ? 1 : 0; if (isDown) this.mouseL.impulse(4.2); }
      else if (btn === 1) { this.mouseR.target = isDown ? 1 : 0; if (isDown) this.mouseR.impulse(4.2); }
      else if (btn === 2) { this.mouseM.target = isDown ? 1 : 0; }
    }

    onMouseWheel(delta) {
      this.idleTime = 0;
      this.timeSinceMouseMove = 0;
      const dir = delta > 0 ? 1 : -1;
      this.scrollVel += dir * 12.0;
      this.earR.impulse(dir * 0.45);
    }

    onAudioData(lvl, bass, beat, playing) {
      this.audioLevel = lvl || 0;
      this.audioBass = bass || 0;
      this.audioBeat = beat || 0;
      this.audioPlaying = !!playing;
      if (this.cfg.audioReactive && beat > 0.45) {
        this.musicNod.impulse(beat * 3.8);
        this.hairSway.impulse((Math.sin(this.time * 4.5) >= 0 ? 1 : -1) * beat * 1.1);
        this.ahogeBounce.impulse(beat * 4.5);
      }
    }

    onContextData(cat, proc, night, ar, ag, ab, alum) {
      this.appCategory = cat || 'general';
      this.activeProc = proc || '';
      this.isLateNight = !!night;
      if (this.ambientOverride) {
        this.ambientRgb = [this.ambientOverride[0], this.ambientOverride[1], this.ambientOverride[2]];
        this.ambientLum = this.ambientOverride[3];
      } else if (typeof ar === 'number') {
        this.ambientRgb = [ar, ag, ab];
        this.ambientLum = typeof alum === 'number' ? alum : 0.25;
      }
    }

    setAmbientOverride(overrideArr) {
      this.ambientOverride = overrideArr || null;
      if (this.ambientOverride) {
        this.ambientRgb = [this.ambientOverride[0], this.ambientOverride[1], this.ambientOverride[2]];
        this.ambientLum = this.ambientOverride[3];
      }
    }

    triggerWake() {
      this.alertPop.impulse(9.5);
      this.browLift.impulse(3.2);
      this.earL.impulse(2.6);
      this.earR.impulse(-2.6);
      this.ahogeBounce.impulse(7.0);
      this.pupilSize.impulse(3.2);
      this.spawnParticle('alert', 0.58, 0.14);
    }

    triggerDemo(action) {
      if (action === 'type') {
        const seq = [[1, 2, 0, 0], [2, 7, 1, 0], [1, 4, 0, 0], [3, 3, 0, 0], [4, 3, 0, 2], [2, 10, 1, 1]];
        seq.forEach((s, idx) => {
          setTimeout(() => {
            this.onKeyEvent(s[0], s[1], s[2], s[3], true);
            setTimeout(() => this.onKeyEvent(s[0], s[1], s[2], s[3], false), 90);
          }, idx * 75);
        });
      } else if (action === 'undo_panic' || action === 'save_zen' || action === 'cv_flurry' || action === 'enter_slam') {
        this.onShortcutMeme(action);
      } else if (action === 'pet') {
        this.petHeat = 1.25;
        this.petLeanX.target = 0.35;
        if (!this.silentGlobal) window.KuroSound.playPurrPulse();
      } else if (action === 'dizzy') {
        this.dizzyTimer = 2.2;
        this.ahogeBounce.impulse(8.0);
        this.spawnParticle('star', 0.40, 0.16);
        this.spawnParticle('star', 0.56, 0.18);
      } else if (action === 'turbo') {
        const now = this.time;
        for (let i = 0; i < 14; i++) this.keyTimestamps.push(now - i * 0.08);
        this.onKeyEvent(1, 3, 0, 0, true);
        this.onKeyEvent(2, 8, 1, 0, true);
      } else if (action === 'sleep') {
        this.idleTime = 30;
        this.hasYawnedThisIdle = true;
      } else if (action === 'yawn') {
        this.idleTime = 24.1;
        this.hasYawnedThisIdle = false;
        this.yawnProgress = 0.05;
      } else if (action === 'music') {
        this.onAudioData(0.75, 0.82, 0.9, true);
        this.spawnParticle('note', 0.62, 0.22);
      } else if (action === 'wake') {
        this.idleTime = 0;
        this.petHeat = 0;
        this.dizzyTimer = 0;
        this.memeTimer = 0;
        this.triggerWake();
      }
    }

    spawnParticle(type, nx, ny) {
      if (this.particles.length > 30) this.particles.shift();
      this.particles.push({
        type,
        x: nx,
        y: ny,
        vx: (Math.random() - 0.5) * 0.045,
        vy: type === 'sweat' ? 0.085 : (type === 'zzz' ? -0.05 : -0.07 - Math.random() * 0.03),
        life: 0,
        maxLife: type === 'zzz' ? 1.8 : (type === 'sweat' ? 0.95 : (type === 'alert' ? 0.68 : 1.15)),
        size: type === 'zzz' ? 12 + Math.random() * 4 : 6 + Math.random() * 4,
        rot: (Math.random() - 0.5) * 0.35,
      });
    }

    update(rawDt) {
      const dt = clamp(rawDt, 0.001, 0.05);
      this.time += dt;
      this.idleTime += dt;
      this.timeSinceMouseMove += dt;
      this.timeSinceRightKb += dt;

      // Decay dizzy, manual expression, active keys, meme, save wave, circle accumulator
      if (this.dizzyTimer > 0) this.dizzyTimer = Math.max(0, this.dizzyTimer - dt);
      if (this.manualExpressionTimer > 0) {
        this.manualExpressionTimer = Math.max(0, this.manualExpressionTimer - dt);
        if (this.manualExpressionTimer <= 0) this.manualExpression = '';
      }
      if (this.activeKeyMap.size > 0) {
        for (const [k, exp] of this.activeKeyMap.entries()) {
          if (exp <= this.time) this.activeKeyMap.delete(k);
        }
      }
      if (this.memeTimer > 0) {
        this.memeTimer = Math.max(0, this.memeTimer - dt);
        if (this.memeTimer <= 0) this.memeId = '';
      }
      if (this.saveWave > 0) this.saveWave = Math.max(0, this.saveWave - dt * 1.45);
      if (this.enterShock > 0) this.enterShock = Math.max(0, this.enterShock - dt * 2.6);
      this.circleAccum *= Math.exp(-dt * 2.6);

      // CPS & Turbo calculation
      const cutoff = this.time - 1.4;
      while (this.keyTimestamps.length > 0 && this.keyTimestamps[0] < cutoff) this.keyTimestamps.shift();
      const instCps = this.keyTimestamps.length / 1.4;
      this.cps = lerp(this.cps, instCps, 1 - Math.exp(-dt * 6));
      this.turboLevel = lerp(this.turboLevel, clamp((this.cps - 4.8) / 4.2, 0, 1), 1 - Math.exp(-dt * 4.5));

      // Petting decay
      this.petHeat = Math.max(0, this.petHeat - dt * 0.62);
      this.petBlend.target = clamp((this.petHeat - 0.12) * 1.4, 0, 1);
      if (this.petBlend.target < 0.05) this.petLeanX.target = 0;

      // Mood Priority State Machine
      if (this.dizzyTimer > 0) {
        this.mood = 'dizzy';
      } else if (this.memeTimer > 0 && (this.memeId === 'undo_panic' || this.memeId === 'cv_flurry' || this.memeId === 'save_zen')) {
        this.mood = 'meme';
      } else if (this.petBlend.value > 0.28) {
        this.mood = 'pet';
      } else if (this.turboLevel > 0.35) {
        this.mood = 'turbo';
      } else if (this.idleTime >= 26.2) {
        this.mood = 'sleep';
      } else if (this.idleTime >= 23.8 && !this.hasYawnedThisIdle) {
        this.mood = 'yawn';
        this.yawnProgress += dt / 2.25;
        if (this.yawnProgress >= 1.0) {
          this.yawnProgress = 0;
          this.hasYawnedThisIdle = true;
          this.mood = 'sleep';
        }
      } else if (this.idleTime >= 13.0) {
        this.mood = 'idle';
      } else {
        this.mood = 'active';
      }

      this.sleepBlend.target = this.mood === 'sleep' ? 1.0 : 0.0;
      const yawnCurve = this.mood === 'yawn' ? Math.sin(clamp(this.yawnProgress, 0, 1) * Math.PI) : 0;
      this.yawnOpen.target = yawnCurve;

      // Blinking
      if (this.mood === 'sleep' || this.mood === 'pet' || this.mood === 'yawn' || this.mood === 'dizzy') {
        this.blinkActive = false;
        this.blinkPhase = 0;
      } else {
        this.blinkTimer -= dt;
        if (!this.blinkActive && this.blinkTimer <= 0) {
          this.blinkActive = true;
          this.blinkClock = 0;
          this.blinkDur = this.mood === 'idle' ? 0.22 : 0.14;
        }
        if (this.blinkActive) {
          this.blinkClock += dt;
          const p = this.blinkClock / this.blinkDur;
          if (p >= 1) {
            this.blinkActive = false;
            this.blinkPhase = 0;
            this.blinkTimer = 2.4 + Math.random() * 3.8;
          } else {
            this.blinkPhase = Math.sin(p * Math.PI);
          }
        }
      }

      // Independent ear micro-twitch
      this.earTwitchTimer -= dt;
      if (this.earTwitchTimer <= 0 && this.mood !== 'sleep') {
        this.earTwitchTimer = 3.6 + Math.random() * 5.0;
        if (Math.random() < 0.5) this.earL.impulse(2.4 + Math.random() * 1.2);
        else this.earR.impulse(-2.4 - Math.random() * 1.2);
      }

      // True Screen-Space Eye & Head Gaze Targets!
      const lx = this.cfg.eyeTrackCursor ? this.targetLookX : 0;
      const ly = this.cfg.eyeTrackCursor ? this.targetLookY : 0;
      const near = this.nearness.value;
      const musicRhythm = this.cfg.audioReactive && this.audioPlaying
        ? Math.sin(this.time * 5.6) * (0.04 + this.audioBass * 0.09)
        : 0;

      if (this.mood === 'sleep') {
        this.headYaw.target = -0.06;
        this.headPitch.target = 0.50;
        this.headRoll.target = -0.14;
        this.eyeX.target = 0;
        this.eyeY.target = 0.35;
        this.browLift.target = -0.2;
      } else if (this.mood === 'pet') {
        this.headYaw.target = this.petLeanX.value * 0.45;
        this.headPitch.target = -0.14;
        this.headRoll.target = this.petLeanX.value * 0.24 + Math.sin(this.time * 5.2) * 0.04;
        this.eyeX.target = this.petLeanX.value * 0.35;
        this.eyeY.target = -0.1;
        this.browLift.target = 0.35;
      } else if (this.mood === 'yawn') {
        this.headYaw.target = 0;
        this.headPitch.target = -0.34 * yawnCurve;
        this.headRoll.target = 0.09 * yawnCurve;
        this.eyeX.target = 0;
        this.eyeY.target = -0.15;
        this.browLift.target = 0.45 * yawnCurve;
      } else if (this.mood === 'dizzy') {
        this.headYaw.target = Math.sin(this.time * 10) * 0.25;
        this.headPitch.target = Math.cos(this.time * 10) * 0.14;
        this.headRoll.target = Math.sin(this.time * 8) * 0.22;
        this.eyeX.target = Math.cos(this.time * 14) * 0.35;
        this.eyeY.target = Math.sin(this.time * 14) * 0.35;
        this.browLift.target = 0.6;
      } else {
        // Active / Idle / Turbo / Meme — genuine cursor-vector lock + proximity curiosity!
        const idleSway = Math.sin(this.time * 0.72) * 0.05;
        const headFollow = 0.58 + near * 0.36; // stronger head turn when cursor comes close!
        const curiousTilt = near * lx * 0.16;
        const turboJit = this.turboLevel * Math.sin(this.time * 28) * 0.03;

        this.headYaw.target = clamp(lx * headFollow + idleSway, -1, 1);
        this.headPitch.target = clamp(ly * (0.45 + near * 0.32) + this.turboLevel * 0.14 + this.musicNod.value * 0.08, -0.78, 0.85);
        this.headRoll.target = clamp(lx * 0.10 + curiousTilt + musicRhythm + turboJit, -0.26, 0.26);
        this.eyeX.target = clamp(lx * 1.0, -1, 1);
        this.eyeY.target = clamp(ly * 0.92, -0.95, 0.95);

        if (this.memeId === 'undo_panic') this.browLift.target = 0.85;
        else if (this.turboLevel > 0.35 || this.appCategory === 'gaming') this.browLift.target = -0.45;
        else this.browLift.target = near * 0.42;
      }

      // Ears & secondary hair lag
      const airplane = this.turboLevel * 0.44 + (this.memeId === 'undo_panic' ? 0.35 : 0);
      const fold = this.sleepBlend.value * 0.26 + this.petBlend.value * 0.22 + yawnCurve * 0.38;
      const inertia = clamp(-this.headYaw.velocity * 0.05, -0.22, 0.22);
      this.earL.target = -(airplane + fold) + inertia;
      this.earR.target = (airplane + fold) + inertia;

      this.hairSway.target = clamp(-this.headYaw.velocity * 0.09 - this.headRoll.value * 0.8 + musicRhythm * 2.2, -1, 1);
      this.ahogeBounce.target = clamp(this.nearness.value * 0.25 + (this.memeId === 'undo_panic' ? 0.5 : 0), -0.6, 0.8);

      // Pupil dilation (expands on proximity curiosity, turbo, pet, gaming focus; relaxes in idle)
      if (this.memeId === 'undo_panic') this.pupilSize.target = 0.30; // comic tiny shocked pupil!
      else if (this.mood === 'turbo') this.pupilSize.target = 0.80;
      else if (this.mood === 'pet') this.pupilSize.target = 0.76;
      else if (this.mood === 'idle') this.pupilSize.target = 0.36;
      else this.pupilSize.target = clamp(0.54 + near * 0.22 + this.mouseClickFlash * 0.14, 0.3, 0.84);

      this.bodyLean.target = this.turboLevel * 0.32 - this.sleepBlend.value * 0.22 - yawnCurve * 0.15 + near * 0.12;

      // Paw holds & right-paw smart return
      if (this.leftPawHold > 0) {
        this.leftPawHold -= dt;
        if (this.leftPawHold <= 0) this.leftPawDown.target = 0;
      }
      if (this.rightPawHold > 0) {
        this.rightPawHold -= dt;
        if (this.rightPawHold <= 0) this.rightPawDown.target = 0;
      }
      if (this.timeSinceRightKb > 0.72 || this.timeSinceMouseMove < 0.2 || this.getEffectiveGear() === 'gamepad-pro') {
        this.rightPawMode.target = this.getEffectiveGear() === 'none' ? 1.0 : 0.0;
      }

      // Mouse pad position & scroll wheel
      this.mouseX.target = this.cursorNormX;
      this.mouseY.target = this.cursorNormY;
      this.scrollAngle += this.scrollVel * dt;
      this.scrollVel *= Math.exp(-dt * 11);
      this.mouseClickFlash = Math.max(0, this.mouseClickFlash - dt * 4.5);

      // Step all springs
      this.nearness.step(dt);
      this.eyeConverge.step(dt);
      this.headYaw.step(dt);
      this.headPitch.step(dt);
      this.headRoll.step(dt);
      this.eyeX.step(dt);
      this.eyeY.step(dt);
      this.pupilSize.step(dt);
      this.browLift.step(dt);
      this.earL.step(dt);
      this.earR.step(dt);
      this.hairSway.step(dt);
      this.ahogeBounce.step(dt);
      this.bodyBounce.step(dt);
      this.bodyLean.step(dt);
      this.musicNod.step(dt);
      this.sleepBlend.step(dt);
      this.yawnOpen.step(dt);
      this.alertPop.step(dt);
      this.petBlend.step(dt);
      this.petLeanX.step(dt);
      this.mouseX.step(dt);
      this.mouseY.step(dt);
      this.mouseL.step(dt);
      this.mouseR.step(dt);
      this.mouseM.step(dt);
      this.leftPawU.step(dt);
      this.leftPawV.step(dt);
      this.leftPawDown.step(dt);
      this.rightPawMode.step(dt);
      this.rightPawU.step(dt);
      this.rightPawV.step(dt);
      this.rightPawDown.step(dt);
      this.orbitYaw.step(dt);
      this.orbitPitch.step(dt);

      // Keycaps + Ctrl+S shimmer wave
      for (let i = 0; i < this.keys.length; i++) {
        const k = this.keys[i];
        const km = window.KuroKeymap.keys[i];
        if (k.holdTimer > 0) k.holdTimer -= dt;
        k.press.target = (k.down || k.holdTimer > 0) ? 1.0 : 0.0;
        k.press.step(dt);
        if (this.saveWave > 0.01) {
          const waveFront = 1.0 - this.saveWave;
          const d = Math.abs(km.uc - waveFront);
          if (d < 0.16) k.glow = Math.max(k.glow, (1 - d / 0.16) * 0.9);
        }
        if (k.glow > 0) k.glow = Math.max(0, k.glow - dt * 2.4);
      }

      // Ambient mood & audio particles
      if (this.mood === 'pet') {
        this.petParticleTimer -= dt;
        if (this.petParticleTimer <= 0) {
          this.petParticleTimer = 0.26 + Math.random() * 0.16;
          this.spawnParticle(Math.random() < 0.5 ? 'heart' : 'sparkle', 0.34 + Math.random() * 0.26, 0.14 + Math.random() * 0.12);
        }
      } else if (this.mood === 'sleep') {
        this.zzzTimer -= dt;
        if (this.zzzTimer <= 0) {
          this.zzzTimer = 1.2;
          this.spawnParticle('zzz', 0.56 + Math.random() * 0.04, 0.28);
        }
      } else if (this.mood === 'turbo') {
        this.turboSparkTimer -= dt;
        if (this.turboSparkTimer <= 0) {
          this.turboSparkTimer = 0.16;
          this.spawnParticle('sparkle', 0.22 + Math.random() * 0.54, 0.56 + Math.random() * 0.16);
        }
      } else if (this.cfg.audioReactive && this.audioPlaying && this.audioLevel > 0.12) {
        this.musicNoteTimer -= dt;
        if (this.musicNoteTimer <= 0) {
          this.musicNoteTimer = 1.3 + Math.random() * 1.1;
          this.spawnParticle('note', 0.58 + Math.random() * 0.08, 0.18 + Math.random() * 0.08);
        }
      }

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life += dt;
        if (p.life >= p.maxLife) {
          this.particles.splice(i, 1);
        } else {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.type === 'zzz' || p.type === 'note') {
            p.x += Math.sin(this.time * 2.6 + i) * 0.014 * dt;
          }
        }
      }
    }
  }

  return { CompanionState, Spring };
})();
