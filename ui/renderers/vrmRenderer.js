window.KuroVrmRenderer = (function () {
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  class VrmRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.available = true;
      this.initialized = false;
      this.renderer = null;
      this.scene = null;
      this.camera = null;
      this.keyLight = null;
      this.rimLight = null;
      this.hemiLight = null;
      this.lookAtTarget = null;
      this.loader = null;

      this.cache = new Map();
      this.activeUrl = null;
      this.lastTime = 0;
      this.onModelLoaded = null;
    }

    ensureThreeInit() {
      if (this.initialized) return true;
      const lib = window.KuroVrmLib;
      if (!lib || !lib.THREE) return false;

      const { THREE, GLTFLoader, VRMLoaderPlugin, VRMAnimationLoaderPlugin } = lib;
      try {
        this.renderer = new THREE.WebGLRenderer({
          canvas: this.canvas,
          alpha: true,
          antialias: true,
          premultipliedAlpha: true,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: true,
        });
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NoToneMapping;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(26, 1, 0.08, 30);
        this.camera.position.set(0, 1.35, 2.2);

        this.keyLight = new THREE.DirectionalLight(0xfffaf2, 2.1);
        this.keyLight.position.set(-1.1, 1.8, 2.4);
        this.scene.add(this.keyLight);

        this.hemiLight = new THREE.HemisphereLight(0xfffaf5, 0x7b7e96, 0.95);
        this.scene.add(this.hemiLight);

        this.rimLight = new THREE.DirectionalLight(0xffeedd, 0.85);
        this.rimLight.position.set(1.5, 1.6, -2.0);
        this.scene.add(this.rimLight);

        this.lookAtTarget = new THREE.Object3D();
        this.lookAtTarget.position.set(0, 1.4, 2.2);
        this.scene.add(this.lookAtTarget);

        this.loader = new GLTFLoader();
        this.loader.crossOrigin = 'anonymous';
        this.loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: true }));
        if (VRMAnimationLoaderPlugin) {
          this.loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
        }

        this.initialized = true;
        this.available = true;
        return true;
      } catch (e) {
        console.error('KuroVrmRenderer init failed:', e);
        this.available = false;
        return false;
      }
    }

    ensureLoaded(url) {
      if (!url || !this.ensureThreeInit()) return null;
      let rec = this.cache.get(url);
      if (rec) return rec;

      const { THREE, VRMUtils, VRMLookAtQuaternionProxy } = window.KuroVrmLib;
      rec = {
        url,
        vrm: null,
        plainScene: null,
        loading: true,
        failed: false,
        error: '',
        metrics: { hipsY: 0.9, chestY: 1.25, headY: 1.48, topY: 1.68, minY: 0.0, height: 1.68 },
        mixer: null,
        animAction: null,
        animUrl: '',
        expressions: [],
        thumbDataUrl: '',
        metaTitle: '',
        metaAuthor: '',
      };
      this.cache.set(url, rec);

      this.loader.load(
        url,
        (gltf) => {
          const vrm = gltf.userData && gltf.userData.vrm;
          if (!vrm) {
            const root = gltf.scene;
            const box = new THREE.Box3().setFromObject(root);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z, 0.01);
            root.position.sub(center);
            root.position.y += size.y * 0.5;
            rec.plainScene = root;
            rec.metrics = {
              hipsY: size.y * 0.5,
              chestY: size.y * 0.65,
              headY: size.y * 0.8,
              topY: size.y,
              minY: 0,
              height: maxDim,
            };
            rec.loading = false;
            if (this.onModelLoaded) try { this.onModelLoaded(url, rec); } catch { }
            return;
          }

          try {
            VRMUtils.removeUnnecessaryVertices(gltf.scene);
            if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(gltf.scene);
          } catch { }

          // Rotate VRM 0.x so both VRM 0.x and VRM 1.0 face +Z cleanly
          if (VRMUtils.rotateVRM0) {
            VRMUtils.rotateVRM0(vrm);
          }

          vrm.scene.traverse((obj) => {
            obj.frustumCulled = false;
          });

          if (vrm.lookAt) {
            vrm.lookAt.target = this.lookAtTarget;
            if (VRMLookAtQuaternionProxy) {
              const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
              proxy.name = 'lookAtQuaternionProxy';
              vrm.scene.add(proxy);
            }
          }

          // Compute exact anatomical heights for auto-framing bust & window-sit modes
          vrm.scene.updateMatrixWorld(true);
          const wp = (name, fallback) => {
            const node = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode(name);
            if (!node) return fallback;
            const v = new THREE.Vector3();
            node.getWorldPosition(v);
            return v.y;
          };
          const box = new THREE.Box3().setFromObject(vrm.scene);
          const minY = isFinite(box.min.y) ? box.min.y : 0;
          const topY = isFinite(box.max.y) ? box.max.y : 1.65;
          const height = Math.max(0.4, topY - minY);
          const hipsY = wp('hips', minY + height * 0.52);
          const chestY = wp('chest', minY + height * 0.72);
          const headY = wp('head', minY + height * 0.86);

          rec.vrm = vrm;
          rec.metrics = { hipsY, chestY, headY, topY, minY, height };
          rec.mixer = new THREE.AnimationMixer(vrm.scene);
          if (vrm.expressionManager && vrm.expressionManager.expressions) {
            rec.expressions = vrm.expressionManager.expressions.map((e) => e.expressionName);
          }
          if (vrm.meta) {
            rec.metaTitle = vrm.meta.name || vrm.meta.title || '';
            rec.metaAuthor = Array.isArray(vrm.meta.authors) ? vrm.meta.authors.join(', ') : (vrm.meta.author || '');
            if (vrm.meta.thumbnailImage && vrm.meta.thumbnailImage.src) {
              rec.thumbDataUrl = vrm.meta.thumbnailImage.src;
            }
          }

          rec.loading = false;
          if (this.onModelLoaded) {
            try { this.onModelLoaded(url, rec); } catch { }
          }
        },
        undefined,
        (err) => {
          console.error('VRM load failed:', url, err);
          rec.failed = true;
          rec.error = (err && err.message) ? err.message : String(err);
          rec.loading = false;
        }
      );

      return rec;
    }

    loadVrmaAnimation(rec, vrmaUrl) {
      if (!rec || !rec.vrm || !vrmaUrl || rec.animUrl === vrmaUrl) return;
      const { createVRMAnimationClip } = window.KuroVrmLib || {};
      if (!createVRMAnimationClip) return;
      rec.animUrl = vrmaUrl;

      this.loader.load(
        vrmaUrl,
        (gltf) => {
          const anims = gltf.userData && gltf.userData.vrmAnimations;
          if (!anims || !anims.length || !rec.vrm) return;
          const clip = createVRMAnimationClip(anims[0], rec.vrm);
          if (rec.animAction) rec.animAction.stop();
          rec.animAction = rec.mixer.clipAction(clip);
          rec.animAction.play();
        },
        undefined,
        (err) => { console.warn('VRMA load failed:', err); }
      );
    }

    clearVrmaAnimation(rec) {
      if (!rec) return;
      if (rec.animAction) {
        rec.animAction.stop();
        rec.animAction = null;
      }
      rec.animUrl = '';
    }

    setActiveRecord(rec) {
      const targetUrl = rec ? rec.url : null;
      if (this.activeUrl === targetUrl) return;
      if (this.activeUrl && this.cache.has(this.activeUrl)) {
        const oldRec = this.cache.get(this.activeUrl);
        if (oldRec.vrm) this.scene.remove(oldRec.vrm.scene);
        if (oldRec.plainScene) this.scene.remove(oldRec.plainScene);
      }
      this.activeUrl = targetUrl;
      if (rec) {
        if (rec.vrm) this.scene.add(rec.vrm.scene);
        else if (rec.plainScene) this.scene.add(rec.plainScene);
      }
    }

    pruneCache(customAssets, builtInUrls) {
      const valid = new Set(builtInUrls || []);
      if (Array.isArray(customAssets)) {
        for (const a of customAssets) {
          if (a.kind === 'avatar3d' && a.entryUrl) valid.add(a.entryUrl);
        }
      }
      const { VRMUtils } = window.KuroVrmLib || {};
      for (const [url, rec] of this.cache.entries()) {
        if (!valid.has(url)) {
          if (this.activeUrl === url) this.setActiveRecord(null);
          if (rec.vrm && VRMUtils && VRMUtils.deepDispose) {
            try { VRMUtils.deepDispose(rec.vrm.scene); } catch { }
          }
          this.cache.delete(url);
        }
      }
    }

    getActiveCapabilities() {
      const rec = this.activeUrl ? this.cache.get(this.activeUrl) : null;
      if (!rec || !rec.vrm) return { ready: false, expressions: [] };
      return {
        ready: true,
        title: rec.metaTitle,
        author: rec.metaAuthor,
        expressions: rec.expressions || [],
      };
    }

    applyProceduralPose(vrm, state, isPeek) {
      const h = vrm.humanoid;
      if (!h) return;
      const bone = (n) => h.getNormalizedBoneNode(n);

      // VRMUtils.rotateVRM0 rotates vrm.scene by PI around Y, flipping normalized X & Z axes relative to VRM 1.0
      const isVrm0 = String(vrm.meta && vrm.meta.metaVersion) === '0';
      const s = isVrm0 ? -1 : 1;

      const t = state.time;
      const sleep = state.sleepBlend.value;
      const pet = state.petBlend.value;
      const bounce = state.bodyBounce.value;
      const music = state.musicNod.value;
      const turbo = state.turboLevel;
      const breath = Math.sin(t * (sleep > 0.5 ? 1.45 : 2.15));
      const yaw = state.headYaw.value;
      const pitch = state.headPitch.value;
      const roll = state.headRoll.value;

      vrm.scene.position.set(0, 0, 0);

      // Canonical VRM 1.0 pose setter (automatically mirrors X & Z for VRM 0.x!)
      const setPose = (name, rx, ry, rz) => {
        const b = bone(name);
        if (b) b.rotation.set(rx * s, ry, rz * s);
      };

      // --- 1. Spine / Chest / Neck / Head (Organic Breathing + True Cursor Tracking!) ---
      const panicShake = state.memeId === 'undo_panic' ? Math.sin(t * 28) * 0.14 : 0;
      const dizzyRoll = state.mood === 'dizzy' ? Math.sin(t * 7.5) * 0.22 : 0;
      const dizzyYaw = state.mood === 'dizzy' ? Math.cos(t * 7.5) * 0.22 : 0;
      const petTilt = pet * 0.16;

      setPose('spine',
        breath * 0.02 + sleep * 0.12 + music * 0.03 + (isPeek ? -0.05 : 0),
        yaw * 0.08 + Math.sin(t * 0.65) * 0.018,
        -roll * 0.08 + Math.sin(t * 0.85) * 0.014
      );
      setPose('chest',
        breath * 0.025 + sleep * 0.10 + bounce * 0.02 + music * 0.04,
        yaw * 0.10,
        -roll * 0.10
      );
      setPose('neck',
        clamp(pitch * 0.16 + sleep * 0.18 + music * 0.05 - pet * 0.05, -0.35, 0.45),
        clamp(yaw * 0.20 + panicShake * 0.5 + dizzyYaw * 0.5, -0.5, 0.5),
        clamp(-roll * 0.22 + petTilt * 0.4 + dizzyRoll * 0.5, -0.4, 0.4)
      );
      setPose('head',
        clamp(pitch * 0.26 + sleep * 0.22 + music * 0.08 + bounce * 0.03 - pet * 0.08, -0.42, 0.50),
        clamp(yaw * 0.32 + panicShake + dizzyYaw, -0.60, 0.60),
        clamp(-roll * 0.38 + petTilt + dizzyRoll, -0.46, 0.46)
      );

      // --- 2. Arms & Legs (Natural Relaxed Companion Pose vs Desktop-Mate Window-Sit!) ---
      const lTap = state.leftPawDown.value;
      const rTap = Math.max(state.rightPawDown.value, state.mouseL.value);
      const typingEnergy = clamp(turbo * 0.8 + (lTap + rTap) * 0.35, 0, 1);

      if (isPeek) {
        // Desktop Mate Signature: Sitting comfortably on top bar of active window with dangling legs!
        setPose('leftShoulder', 0, 0, -0.04);
        setPose('rightShoulder', 0, 0, 0.04);
        // Arms relaxed down & slightly back, palms resting on window edge beside hips
        setPose('leftUpperArm', 0.14 - lTap * 0.10, 0.06, -1.16);
        setPose('rightUpperArm', 0.14 - rTap * 0.10, -0.06, 1.16);
        setPose('leftLowerArm', 0.0, 0.16, -0.08);
        setPose('rightLowerArm', 0.0, -0.16, 0.08);
        setPose('leftHand', 0.0, 0.0, 0.42);
        setPose('rightHand', 0.0, 0.0, -0.42);

        // Seated Thighs Forward (-82 deg in VRM 1.0) & Dangling Swinging Lower Legs!
        const kickSpd = 2.1 + typingEnergy * 2.4 + (state.audioPlaying ? state.audioBass * 2.5 : 0);
        const kickAmp = (sleep > 0.6 ? 0.03 : 0.16) + typingEnergy * 0.12 + (state.audioPlaying ? state.audioBass * 0.14 : 0);
        const legSwingL = Math.sin(t * kickSpd) * kickAmp;
        const legSwingR = Math.sin(t * kickSpd + Math.PI) * kickAmp;

        setPose('hips', -0.06, 0, 0);
        setPose('leftUpperLeg', -1.42, 0.06, -0.04);
        setPose('rightUpperLeg', -1.42, -0.06, 0.04);
        setPose('leftLowerLeg', 1.32 + legSwingL, 0, 0);
        setPose('rightLowerLeg', 1.32 + legSwingR, 0, 0);
        setPose('leftFoot', 0.18 + legSwingL * 0.35, 0, 0);
        setPose('rightFoot', 0.18 + legSwingR * 0.35, 0, 0);
      } else {
        // Natural Anime Companion Standing/Bust Pose (Arms gracefully relaxed down, lively reaction to keys/pet/panic!)
        const idleWave = Math.sin(t * 1.45) * 0.025;
        const panicRaise = state.memeId === 'undo_panic' ? 0.55 : 0;
        const happyLift = (pet > 0.35 || state.memeId === 'cv_flurry') ? 0.24 : 0;

        setPose('leftShoulder', 0, 0, -0.05 - lTap * 0.03);
        setPose('rightShoulder', 0, 0, 0.05 + rTap * 0.03);

        // Relaxed arms lowered cleanly (~72 deg down from T-pose), subtly lifting on typing/happy/panic
        setPose('leftUpperArm',
          -0.08 - lTap * 0.12 - panicRaise * 0.55 - happyLift * 0.35 + idleWave,
          0.08,
          -1.26 + panicRaise * 0.45 + happyLift * 0.22 + lTap * 0.08
        );
        setPose('rightUpperArm',
          -0.08 - rTap * 0.12 - panicRaise * 0.55 - happyLift * 0.35 - idleWave,
          -0.08,
          1.26 - panicRaise * 0.45 - happyLift * 0.22 - rTap * 0.08
        );

        // Natural soft elbow bend inward/forward
        setPose('leftLowerArm', 0, 0.26 + lTap * 0.18 + panicRaise * 0.75 + happyLift * 0.35, -0.10);
        setPose('rightLowerArm', 0, -0.26 - rTap * 0.18 - panicRaise * 0.75 - happyLift * 0.35, 0.10);
        setPose('leftHand', 0.05, 0.0, -0.08);
        setPose('rightHand', 0.05, 0.0, 0.08);

        // Natural relaxed standing legs (for Full-Body framing option)
        setPose('hips', 0, yaw * 0.06, Math.sin(t * 0.8) * 0.012);
        setPose('leftUpperLeg', -0.03, 0.05, -0.04);
        setPose('rightUpperLeg', 0.02, -0.05, 0.04);
        setPose('leftLowerLeg', 0.05, 0, 0);
        setPose('rightLowerLeg', 0.04, 0, 0);
        setPose('leftFoot', -0.02, 0, 0);
        setPose('rightFoot', -0.02, 0, 0);
      }

      // Gently curl fingers so hands look organic and graceful
      const curl = 0.24;
      for (const side of ['left', 'right']) {
        const fs = side === 'left' ? -1 : 1;
        for (const f of ['Index', 'Middle', 'Ring', 'Little']) {
          setPose(side + f + 'Proximal', 0, 0, fs * curl);
          setPose(side + f + 'Intermediate', 0, 0, fs * curl * 1.15);
          setPose(side + f + 'Distal', 0, 0, fs * curl * 0.8);
        }
      }
    }

    applyExpressionsAndLookAt(vrm, state, metrics) {
      const em = vrm.expressionManager;
      if (em) {
        const setExpr = (name, val) => {
          try { em.setValue(name, clamp(val, 0, 1)); } catch { }
        };

        const sleep = state.sleepBlend.value;
        const pet = state.petBlend.value;
        const yawn = state.yawnOpen.value;
        const isPanic = state.memeId === 'undo_panic';
        const isZen = state.memeId === 'save_zen';
        const isCv = state.memeId === 'cv_flurry';
        const isDizzy = state.mood === 'dizzy';

        setExpr('happy', 0);
        setExpr('angry', 0);
        setExpr('sad', 0);
        setExpr('relaxed', 0);
        setExpr('surprised', 0);
        setExpr('aa', 0);
        setExpr('oh', 0);
        setExpr('ee', 0);

        let blinkVal = clamp(Math.max(state.blinkPhase, sleep * 0.96), 0, 1);

        if (state.manualExpression && state.manualExpressionTimer > 0) {
          setExpr(state.manualExpression, 0.95);
          if (state.manualExpression === 'happy' || state.manualExpression === 'relaxed') blinkVal = 0;
        } else if (pet > 0.35) {
          setExpr('happy', clamp(pet * 0.95, 0, 1));
          blinkVal = 0;
        } else if (isPanic) {
          setExpr('surprised', 0.78);
          setExpr('sad', 0.35);
          blinkVal = 0;
        } else if (isZen) {
          setExpr('relaxed', 0.85);
          setExpr('happy', 0.35);
        } else if (isCv) {
          setExpr('happy', 0.82);
          setExpr('surprised', 0.25);
        } else if (isDizzy) {
          setExpr('surprised', 0.65);
          setExpr('sad', 0.25);
        } else if (sleep > 0.5) {
          setExpr('relaxed', 0.45);
        } else if (state.turboLevel > 0.45) {
          setExpr('happy', 0.28);
        }

        setExpr('blink', blinkVal);

        if (yawn > 0.08) {
          setExpr('oh', clamp(yawn * 0.92, 0, 1));
        } else if (state.cfg.audioReactive && state.audioPlaying && state.audioLevel > 0.06 && sleep < 0.5) {
          const lip = clamp(state.audioLevel * 0.95 + state.audioBass * 0.4, 0, 0.78);
          setExpr('aa', lip * 0.65);
          setExpr('oh', lip * 0.35);
        }
      }

      if (this.lookAtTarget && vrm.lookAt) {
        const lx = clamp(state.eyeX.value, -1, 1) * 1.45;
        const ly = metrics.headY - clamp(state.eyeY.value, -1, 1) * 0.85;
        this.lookAtTarget.position.set(lx, ly, 2.35);
      }
    }

    updateCameraAndLighting(state, metrics, palette, cw, ch, isPeek) {
      const aspect = cw / Math.max(1, ch);
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();

      const h = metrics.height;
      const headY = metrics.headY;
      const chestY = metrics.chestY;
      const hipsY = metrics.hipsY;
      const topY = metrics.topY;

      const userScale = clamp(state.cfg.customScale || 1.0, 0.55, 1.8);
      const userOffY = (state.cfg.customOffsetY || 0) * 0.004;
      const modeFull = isPeek || state.cfg.vrmCamera === 'full';

      let targetY, dist;
      if (isPeek) {
        // Seated window-edge framing: crown down to dangling boots with generous hero scale!
        targetY = lerp(hipsY - h * 0.14, headY, 0.50) + userOffY;
        dist = (h * 1.24) / userScale;
      } else if (modeFull) {
        targetY = lerp(metrics.minY + h * 0.50, chestY, 0.25) + userOffY;
        dist = (h * 2.10) / userScale;
      } else {
        const bustSpan = Math.max(0.32, (topY - chestY) + h * 0.14);
        targetY = lerp(chestY, topY, 0.45) + userOffY;
        dist = (bustSpan * 2.45) / userScale;
      }

      const oYaw = state.orbitYaw.value;
      const oPitch = clamp(state.orbitPitch.value, -0.45, 0.45);
      const cx = Math.sin(oYaw) * Math.cos(oPitch) * dist;
      const cy = targetY + Math.sin(oPitch) * dist * 0.75 + 0.04;
      const cz = Math.cos(oYaw) * Math.cos(oPitch) * dist;

      this.camera.position.set(cx, cy, cz);
      this.camera.lookAt(0, targetY, 0);

      if (state.cfg.ambientFusion && state.ambientRgb) {
        const r = clamp((state.ambientRgb[0] / 255) * 0.55 + 0.45, 0.35, 1);
        const g = clamp((state.ambientRgb[1] / 255) * 0.55 + 0.45, 0.35, 1);
        const b = clamp((state.ambientRgb[2] / 255) * 0.55 + 0.45, 0.35, 1);
        this.rimLight.color.setRGB(r, g, b);
      } else {
        this.rimLight.color.setHex(0xfff1e0);
      }

      if (state.cfg.shader3d === 'pbr') {
        this.keyLight.intensity = 2.65;
        this.hemiLight.intensity = 0.72;
        this.rimLight.intensity = 1.25;
      } else {
        this.keyLight.intensity = 2.05;
        this.hemiLight.intensity = 1.02;
        this.rimLight.intensity = 0.85;
      }
    }

    render(state, avatar, palette, isPeek) {
      if (!this.available) return;
      if (!this.ensureThreeInit()) return;

      const url = (avatar.customAsset && avatar.customAsset.entryUrl) || avatar.vrmUrl;
      if (!url) return;

      const cw = this.canvas.width, ch = this.canvas.height;
      if (cw <= 1 || ch <= 1) return;
      if (this.renderer.domElement.width !== cw || this.renderer.domElement.height !== ch) {
        this.renderer.setSize(cw, ch, false);
      } else {
        this.renderer.setViewport(0, 0, cw, ch);
      }

      const rec = this.ensureLoaded(url);
      if (!rec || rec.loading || rec.failed) {
        this.renderer.clear();
        return;
      }

      this.setActiveRecord(rec);

      const now = state.time;
      const dt = this.lastTime > 0 ? clamp(now - this.lastTime, 0.001, 0.05) : 0.016;
      this.lastTime = now;

      if (rec.vrm) {
        const vrm = rec.vrm;
        if (state.cfg.vrmaUrl && state.cfg.vrmaUrl !== rec.animUrl) {
          this.loadVrmaAnimation(rec, state.cfg.vrmaUrl);
        } else if (!state.cfg.vrmaUrl && rec.animUrl) {
          this.clearVrmaAnimation(rec);
        }

        if (rec.animAction && rec.mixer) {
          rec.mixer.update(dt);
        } else {
          this.applyProceduralPose(vrm, state, isPeek);
        }

        this.applyExpressionsAndLookAt(vrm, state, rec.metrics);

        if (vrm.springBoneManager) {
          const gust = state.turboLevel * 0.16 + (state.audioPlaying ? state.audioBass * 0.22 : 0);
          vrm.scene.position.x = Math.sin(now * 2.4) * (0.004 + gust * 0.012);
          vrm.scene.position.y = -state.bodyBounce.value * 0.014 - state.musicNod.value * 0.016;
        }

        vrm.update(dt);
      } else if (rec.plainScene) {
        rec.plainScene.rotation.y = state.orbitYaw.value + state.headYaw.value * 0.35;
        rec.plainScene.rotation.x = state.orbitPitch.value + state.headPitch.value * 0.18;
      }

      this.updateCameraAndLighting(state, rec.metrics, palette, cw, ch, isPeek);
      this.renderer.render(this.scene, this.camera);
    }
  }

  return { VrmRenderer };
})();
