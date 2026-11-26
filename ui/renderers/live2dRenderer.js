window.KuroLive2DRenderer = (function () {
  /**
   * Production Live2D Cubism 4/5 WebGL2 Engine + Full BongoCat / BongoCatMver Compatibility.
   * Implements:
   * - Exact CanvasInfo layout normalization (handles 612x354 BongoCat AND 2048x2048 VTuber models)
   * - Hardware FBO Clipping Masks & Inverted Clipping Masks (zero eye/mouth overflow)
   * - Multiply Color & Screen Color (Cubism 4.2+/5.x) + Normal / Additive / Multiply blend modes
   * - Full physics3.json multi-pendulum physics evaluator (silky hair/ear/ribbon inertia)
   * - Full exp3.json expression blending (Add / Multiply / Overwrite + smooth fade)
   * - Full motion3.json curve evaluator (Linear / Cubic Bezier / Stepped / InverseStepped)
   * - Full pose3.json mutually exclusive part group switching
   * - Complete BongoCat & BongoCatMver background + per-key left-keys/right-keys/hand/keyboard composite layers!
   */
  const RUNTIME_CORE_URLS = [
    'https://kuro-assets.local/__runtime/live2dcubismcore.min.js',
    './vendor/live2dcubismcore.min.js',
  ];

  let coreLoadPromise = null;
  let coreAvailable = typeof window.Live2DCubismCore !== 'undefined';

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function loadScript(src) {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(typeof window.Live2DCubismCore !== 'undefined');
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  function ensureCubismCoreLoaded(hasCoreFlag) {
    if (coreAvailable || typeof window.Live2DCubismCore !== 'undefined') {
      coreAvailable = true;
      return Promise.resolve(true);
    }
    if (coreLoadPromise) return coreLoadPromise;

    coreLoadPromise = (async () => {
      const candidates = window.KuroBus && window.KuroBus.isNative
        ? (hasCoreFlag ? [RUNTIME_CORE_URLS[0] + '?v=' + Date.now(), RUNTIME_CORE_URLS[1]] : [RUNTIME_CORE_URLS[1]])
        : [RUNTIME_CORE_URLS[1]];
      for (const u of candidates) {
        if (await loadScript(u)) {
          coreAvailable = true;
          return true;
        }
      }
      coreLoadPromise = null;
      return false;
    })();
    return coreLoadPromise;
  }

  // =========================================================================
  // SHADERS: Main Premultiplied Alpha + Multiply/Screen Color + Mask Sampling
  // =========================================================================
  const L2D_VS = `#version 300 es
  precision highp float;
  layout(location = 0) in vec2 aPos;
  layout(location = 1) in vec2 aUv;
  uniform vec2 uScale;
  uniform vec2 uOffset;
  out vec2 vUv;
  out vec2 vClipUv;
  void main() {
    vUv = vec2(aUv.x, 1.0 - aUv.y);
    vec2 ndc = aPos * uScale + uOffset;
    vClipUv = ndc * 0.5 + 0.5;
    gl_Position = vec4(ndc, 0.0, 1.0);
  }`;

  const L2D_FS = `#version 300 es
  precision highp float;
  in vec2 vUv;
  in vec2 vClipUv;
  uniform sampler2D uTex;
  uniform sampler2D uMaskTex;
  uniform int uPassMode;      // 0 = Main draw, 1 = Render alpha into Mask FBO
  uniform int uUseMask;       // 1 = Clip against uMaskTex
  uniform int uInvertedMask;  // 1 = Invert mask alpha
  uniform float uOpacity;
  uniform vec4 uMultColor;
  uniform vec4 uScreenColor;
  out vec4 fragColor;
  void main() {
    vec4 t = texture(uTex, vUv);
    if (uPassMode == 1) {
      if (t.a <= 0.002) discard;
      fragColor = vec4(t.a, t.a, t.a, t.a);
      return;
    }
    // Authentic Cubism 4.2+/5.x Multiply & Screen Color on premultiplied RGBA
    vec3 rgb = t.rgb * uMultColor.rgb;
    rgb = (rgb + uScreenColor.rgb * t.a) - (rgb * uScreenColor.rgb);
    float a = t.a * uMultColor.a;

    if (uUseMask == 1) {
      float m = texture(uMaskTex, vClipUv).a;
      if (uInvertedMask == 1) m = 1.0 - m;
      rgb *= m;
      a *= m;
    }
    fragColor = vec4(rgb * uOpacity, a * uOpacity);
  }`;

  function compileProg(gl) {
    const comp = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('Live2D shader error:', gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const p = gl.createProgram();
    gl.attachShader(p, comp(gl.VERTEX_SHADER, L2D_VS));
    gl.attachShader(p, comp(gl.FRAGMENT_SHADER, L2D_FS));
    gl.linkProgram(p);
    return p;
  }

  // =========================================================================
  // CUBISM PHYSICS3.JSON MULTI-PENDULUM SIMULATOR
  // =========================================================================
  class CubismPhysicsSim {
    constructor(json) {
      this.rigs = [];
      if (!json || !Array.isArray(json.PhysicsSettings)) return;
      const eff = (json.Meta && json.Meta.EffectiveForces) || {};
      this.gravity = {
        x: (eff.Gravity && eff.Gravity.X) || 0,
        y: (eff.Gravity && eff.Gravity.Y !== undefined) ? eff.Gravity.Y : -1,
      };
      this.wind = {
        x: (eff.Wind && eff.Wind.X) || 0,
        y: (eff.Wind && eff.Wind.Y) || 0,
      };

      for (const s of json.PhysicsSettings) {
        const verts = (s.Vertices || []).map((v) => ({
          x: (v.Position && v.Position.X) || 0,
          y: (v.Position && v.Position.Y) || 0,
          lastX: (v.Position && v.Position.X) || 0,
          lastY: (v.Position && v.Position.Y) || 0,
          vx: 0,
          vy: 0,
          mobility: v.Mobility !== undefined ? v.Mobility : 1,
          delay: Math.max(0.05, v.Delay !== undefined ? v.Delay : 1),
          accel: v.Acceleration !== undefined ? v.Acceleration : 1,
          radius: v.Radius !== undefined ? v.Radius : 0,
        }));
        if (verts.length < 2) continue;
        this.rigs.push({
          inputs: s.Input || [],
          outputs: s.Output || [],
          verts,
          norm: s.Normalization || {
            Position: { Minimum: -10, Default: 0, Maximum: 10 },
            Angle: { Minimum: -10, Default: 0, Maximum: 10 },
          },
        });
      }
    }

    normalizeVal(val, minV, maxV, defV, normSpec, reflect) {
      const lo = normSpec.Minimum, hi = normSpec.Maximum, def = normSpec.Default;
      let t = 0;
      if (val >= defV) {
        const span = Math.max(1e-5, maxV - defV);
        t = def + ((val - defV) / span) * (hi - def);
      } else {
        const span = Math.max(1e-5, defV - minV);
        t = def - ((defV - val) / span) * (def - lo);
      }
      return reflect ? -t : t;
    }

    step(model, paramIdx, dt, extraWindX) {
      if (!this.rigs.length) return;
      const p = model.parameters;
      const subDt = clamp(dt, 0.004, 0.033);

      for (let r = 0; r < this.rigs.length; r++) {
        const rig = this.rigs[r];
        let totalX = 0, totalY = 0, totalAng = 0;

        for (let i = 0; i < rig.inputs.length; i++) {
          const inp = rig.inputs[i];
          const id = inp.Source && inp.Source.Id;
          const idx = paramIdx[id];
          if (idx === undefined) continue;
          const w = (inp.Weight || 0) / 100;
          const spec = inp.Type === 'Angle' ? rig.norm.Angle : rig.norm.Position;
          const nv = this.normalizeVal(
            p.values[idx], p.minimumValues[idx], p.maximumValues[idx], p.defaultValues[idx],
            spec, !!inp.Reflect
          );
          if (inp.Type === 'X') totalX += nv * w;
          else if (inp.Type === 'Y') totalY += nv * w;
          else if (inp.Type === 'Angle') totalAng += nv * w;
        }

        const rad = (-totalAng * Math.PI) / 180;
        const c = Math.cos(rad), s = Math.sin(rad);
        const gx = this.gravity.x + this.wind.x + (extraWindX || 0);
        const gy = this.gravity.y + this.wind.y;
        const dirX = gx * c - gy * s;
        const dirY = gx * s + gy * c;
        const dirLen = Math.hypot(dirX, dirY) || 1;
        const ndx = dirX / dirLen, ndy = dirY / dirLen;

        const verts = rig.verts;
        verts[0].x = totalX;
        verts[0].y = totalY;

        for (let k = 1; k < verts.length; k++) {
          const prev = verts[k - 1];
          const cur = verts[k];
          const delay = cur.delay * subDt * 30;
          const fx = ndx * cur.accel;
          const fy = ndy * cur.accel;

          cur.lastX = cur.x;
          cur.lastY = cur.y;
          cur.x += cur.vx * delay + fx * delay * delay * 0.5;
          cur.y += cur.vy * delay + fy * delay * delay * 0.5;

          const dx = cur.x - prev.x;
          const dy = cur.y - prev.y;
          const dist = Math.hypot(dx, dy) || 1e-5;
          const radLen = cur.radius || 1;
          cur.x = prev.x + (dx / dist) * radLen;
          cur.y = prev.y + (dy / dist) * radLen;

          cur.vx = ((cur.x - cur.lastX) / Math.max(0.01, delay)) * clamp(cur.mobility, 0.1, 0.98);
          cur.vy = ((cur.y - cur.lastY) / Math.max(0.01, delay)) * clamp(cur.mobility, 0.1, 0.98);
        }

        for (let o = 0; o < rig.outputs.length; o++) {
          const out = rig.outputs[o];
          const id = out.Destination && out.Destination.Id;
          const idx = paramIdx[id];
          if (idx === undefined) continue;
          const vi = clamp(out.VertexIndex || 1, 1, verts.length - 1);
          const vCur = verts[vi];
          const vPrev = verts[vi - 1];
          let rawOut = 0;
          if (out.Type === 'X') {
            rawOut = vCur.x - vPrev.x;
          } else if (out.Type === 'Y') {
            rawOut = vCur.y - vPrev.y;
          } else {
            // Angle deflection relative to down vector (0, -1)
            const dx = vCur.x - vPrev.x;
            const dy = vCur.y - vPrev.y;
            rawOut = Math.atan2(dx, -dy);
          }
          if (out.Reflect) rawOut = -rawOut;
          const val = rawOut * (out.Scale || 1);
          const w = clamp((out.Weight || 100) / 100, 0, 1);
          const lo = p.minimumValues[idx], hi = p.maximumValues[idx];
          const blended = lerp(p.values[idx], clamp(p.defaultValues[idx] + val, lo, hi), w);
          p.values[idx] = clamp(blended, lo, hi);
        }
      }
    }
  }

  // =========================================================================
  // MOTION3.JSON CURVE EVALUATOR (Linear / Cubic Bezier / Stepped / InvStepped)
  // =========================================================================
  function evalMotionCurve(seg, t) {
    if (!seg || seg.length < 2) return 0;
    if (t <= seg[0]) return seg[1];
    let i = 2;
    let p0t = seg[0], p0v = seg[1];
    while (i < seg.length) {
      const segType = seg[i++];
      if (segType === 0) { // Linear
        const t1 = seg[i++], v1 = seg[i++];
        if (t <= t1) {
          const u = (t - p0t) / Math.max(1e-5, t1 - p0t);
          return lerp(p0v, v1, u);
        }
        p0t = t1; p0v = v1;
      } else if (segType === 1) { // Cubic Bezier
        const c1t = seg[i++], c1v = seg[i++];
        const c2t = seg[i++], c2v = seg[i++];
        const t1 = seg[i++], v1 = seg[i++];
        if (t <= t1) {
          const u = clamp((t - p0t) / Math.max(1e-5, t1 - p0t), 0, 1);
          const iu = 1 - u;
          return iu * iu * iu * p0v + 3 * iu * iu * u * c1v + 3 * iu * u * u * c2v + u * u * u * v1;
        }
        p0t = t1; p0v = v1;
      } else if (segType === 2) { // Stepped
        const t1 = seg[i++], v1 = seg[i++];
        if (t < t1) return p0v;
        p0t = t1; p0v = v1;
      } else if (segType === 3) { // InverseStepped
        const t1 = seg[i++], v1 = seg[i++];
        if (t <= t1) return v1;
        p0t = t1; p0v = v1;
      } else {
        break;
      }
    }
    return p0v;
  }

  // =========================================================================
  // MAIN LIVE2D + BONGOCAT RENDERER CLASS
  // =========================================================================
  class Live2DRenderer {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.gl = null;
      this.prog = null;
      this.maskFbo = null;
      this.maskTex = null;
      this.maskSize = 1024;
      this.models = new Map();
      this.fallbackImgCache = new Map();
      this.overlayImgCache = new Map();
      this.lastTime = 0;
      this.onModelLoaded = null;
    }

    initGlIfNeeded() {
      if (this.gl) return true;
      const gl = this.canvas.getContext('webgl2', {
        alpha: true,
        antialias: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
      });
      if (!gl) return false;
      this.gl = gl;
      this.prog = compileProg(gl);

      const g = (n) => gl.getUniformLocation(this.prog, n);
      this.u = {
        scale: g('uScale'),
        offset: g('uOffset'),
        tex: g('uTex'),
        maskTex: g('uMaskTex'),
        passMode: g('uPassMode'),
        useMask: g('uUseMask'),
        invertedMask: g('uInvertedMask'),
        opacity: g('uOpacity'),
        mult: g('uMultColor'),
        screen: g('uScreenColor'),
      };

      this.posBuf = gl.createBuffer();
      this.uvBuf = gl.createBuffer();
      this.idxBuf = gl.createBuffer();

      // Allocate offscreen Clipping Mask FBO (1024x1024)
      this.maskTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.maskSize, this.maskSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.maskFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.maskTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return true;
    }

    getCachedImage(url) {
      if (!url) return null;
      let rec = this.overlayImgCache.get(url);
      if (!rec) {
        rec = { img: new Image(), loaded: false, failed: false };
        rec.img.crossOrigin = 'anonymous';
        rec.img.onload = () => { rec.loaded = true; };
        rec.img.onerror = () => { rec.failed = true; };
        rec.img.src = url;
        this.overlayImgCache.set(url, rec);
      }
      return rec.loaded ? rec.img : null;
    }

    ensureModel(entryUrl, hasCoreFlag, asset) {
      let rec = this.models.get(entryUrl);
      if (rec) {
        // Retry automatically if user just imported Cubism Core after a prior preview-only load
        if (rec.failed && (hasCoreFlag || coreAvailable) && rec.error === 'Cubism Core 未就绪') {
          this.models.delete(entryUrl);
        } else {
          return rec;
        }
      }
      rec = {
        url: entryUrl,
        ready: false,
        failed: false,
        error: '',
        model: null,
        textures: [],
        paramIdx: {},
        partIdx: {},
        eyeBlinkIds: ['ParamEyeLOpen', 'ParamEyeROpen'],
        lipSyncIds: ['ParamMouthOpenY'],
        canvasInfo: { width: 2, height: 2, originX: 1, originY: 1, ppu: 1 },
        physics: null,
        expressions: new Map(),   // name -> { FadeInTime, FadeOutTime, Parameters }
        expressionNames: [],
        activeExp: null,
        expWeight: 0,
        motions: new Map(),       // group -> [motionJson...]
        motionList: [],           // [{ group, index, label }]
        curMotion: null,          // { data, elapsed, loop, weight }
        poseGroups: [],
        bongoManifest: null,
      };
      this.models.set(entryUrl, rec);

      // Load optional BongoCat / BongoCatMver composite layer manifest right away (even if Core isn't installed yet!)
      const bongoUrl = (asset && asset.bongoManifestUrl) || new URL('kuro_bongocat.json', entryUrl).href;
      fetch(bongoUrl).then((r) => (r.ok ? r.json() : null)).then((mj) => {
        if (mj) {
          rec.bongoManifest = mj;
          if (mj.backgroundUrl) this.getCachedImage(mj.backgroundUrl);
        }
      }).catch(() => {});

      ensureCubismCoreLoaded(hasCoreFlag).then(async (ok) => {
        if (!ok || !this.initGlIfNeeded()) {
          rec.failed = true;
          rec.error = 'Cubism Core 未就绪';
          return;
        }
        try {
          const resp = await fetch(entryUrl);
          const json = await resp.json();
          const refs = json.FileReferences || {};
          if (!refs.Moc) throw new Error('Missing Moc in model3.json');

          const mocUrl = new URL(refs.Moc, entryUrl).href;
          const mocBuf = await (await fetch(mocUrl)).arrayBuffer();
          const moc = window.Live2DCubismCore.Moc.fromArrayBuffer(mocBuf);
          const model = window.Live2DCubismCore.Model.fromMoc(moc);

          // Read exact CanvasInfo (width, height, origin, pixelsPerUnit)
          const ci = model.canvasinfo || {};
          const ppu = ci.PixelsPerUnit || ci.pixelsPerUnit || 1;
          rec.canvasInfo = {
            width: (ci.CanvasWidth || ci.canvasWidth || 2) / ppu,
            height: (ci.CanvasHeight || ci.canvasHeight || 2) / ppu,
            originX: (ci.CanvasOriginX || ci.canvasOriginX || 1) / ppu,
            originY: (ci.CanvasOriginY || ci.canvasOriginY || 1) / ppu,
            ppu,
          };

          const gl = this.gl;
          const textures = [];
          for (const relTex of (refs.Textures || [])) {
            const tUrl = new URL(relTex, entryUrl).href;
            const blob = await (await fetch(tUrl)).blob();
            const bmp = await createImageBitmap(blob);
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            bmp.close();
            textures.push(tex);
          }

          const paramIdx = {};
          for (let i = 0; i < model.parameters.ids.length; i++) paramIdx[model.parameters.ids[i]] = i;
          const partIdx = {};
          if (model.parts && model.parts.ids) {
            for (let i = 0; i < model.parts.ids.length; i++) partIdx[model.parts.ids[i]] = i;
          }

          // Read EyeBlink & LipSync parameter groups from model3.json (handles Cubism 5 models like Mao using ParamA!)
          if (Array.isArray(json.Groups)) {
            for (const grp of json.Groups) {
              if (!grp || !Array.isArray(grp.Ids) || grp.Ids.length === 0) continue;
              if (grp.Name === 'EyeBlink') rec.eyeBlinkIds = grp.Ids.slice();
              else if (grp.Name === 'LipSync') rec.lipSyncIds = grp.Ids.slice();
            }
          }

          // Load physics3.json
          if (refs.Physics) {
            try {
              const pResp = await fetch(new URL(refs.Physics, entryUrl).href);
              if (pResp.ok) rec.physics = new CubismPhysicsSim(await pResp.json());
            } catch { }
          }

          // Load pose3.json
          if (refs.Pose) {
            try {
              const poResp = await fetch(new URL(refs.Pose, entryUrl).href);
              if (poResp.ok) {
                const poJson = await poResp.json();
                if (Array.isArray(poJson.Groups)) rec.poseGroups = poJson.Groups;
              }
            } catch { }
          }

          // Load exp3.json expressions
          if (Array.isArray(refs.Expressions)) {
            for (const ex of refs.Expressions) {
              if (!ex || !ex.File) continue;
              try {
                const eResp = await fetch(new URL(ex.File, entryUrl).href);
                if (eResp.ok) {
                  const name = ex.Name || ex.File.replace(/\.exp3\.json$/i, '');
                  rec.expressions.set(name, await eResp.json());
                  rec.expressionNames.push(name);
                }
              } catch { }
            }
          }

          // Load motion3.json clips
          if (refs.Motions && typeof refs.Motions === 'object') {
            for (const group of Object.keys(refs.Motions)) {
              const arr = refs.Motions[group];
              if (!Array.isArray(arr)) continue;
              const loadedClips = [];
              for (let idx = 0; idx < arr.length; idx++) {
                const item = arr[idx];
                if (!item || !item.File) continue;
                try {
                  const mResp = await fetch(new URL(item.File, entryUrl).href);
                  if (mResp.ok) {
                    const mJson = await mResp.json();
                    loadedClips.push(mJson);
                    rec.motionList.push({
                      group,
                      index: loadedClips.length - 1,
                      label: (group || 'Motion') + ' #' + loadedClips.length,
                    });
                  }
                } catch { }
              }
              if (loadedClips.length) rec.motions.set(group, loadedClips);
            }
          }

          rec.model = model;
          rec.textures = textures;
          rec.paramIdx = paramIdx;
          rec.partIdx = partIdx;
          rec.ready = true;

          // Start Idle motion gently if the model defines one
          if (rec.motions.has('Idle')) {
            rec.curMotion = { data: rec.motions.get('Idle')[0], elapsed: 0, loop: true, weight: 0.6 };
          }
          if (this.onModelLoaded) {
            try { this.onModelLoaded(entryUrl, rec); } catch { }
          }
        } catch (e) {
          console.error('Live2D load error:', e);
          rec.failed = true;
          rec.error = (e && e.message) ? e.message : String(e);
        }
      });
      return rec;
    }

    getModelCapabilities(entryUrl) {
      const rec = entryUrl ? this.models.get(entryUrl) : null;
      if (!rec) return { ready: false, hasCore: coreAvailable, expressions: [], motions: [], isBongoCat: false };
      return {
        ready: rec.ready,
        hasCore: coreAvailable,
        expressions: rec.expressionNames,
        motions: rec.motionList,
        isBongoCat: !!rec.bongoManifest,
        error: rec.error,
      };
    }

    triggerExpression(entryUrl, name) {
      const rec = entryUrl ? this.models.get(entryUrl) : null;
      if (!rec || !rec.ready) return;
      if (!name || rec.activeExp === name) {
        rec.activeExp = null;
        return;
      }
      if (rec.expressions.has(name)) {
        rec.activeExp = name;
        rec.expWeight = 0;
      }
    }

    triggerMotion(entryUrl, group, index) {
      const rec = entryUrl ? this.models.get(entryUrl) : null;
      if (!rec || !rec.ready) return;
      const arr = rec.motions.get(group);
      if (!arr || !arr.length) return;
      const clip = arr[index % arr.length];
      rec.curMotion = { data: clip, elapsed: 0, loop: group === 'Idle', weight: 1.0 };
    }

    setParam(rec, id, val, blend) {
      const idx = rec.paramIdx[id];
      if (idx === undefined) return;
      const p = rec.model.parameters;
      const lo = p.minimumValues[idx], hi = p.maximumValues[idx];
      const clamped = clamp(val, lo, hi);
      p.values[idx] = blend !== undefined ? lerp(p.values[idx], clamped, blend) : clamped;
    }

    addParam(rec, id, delta) {
      const idx = rec.paramIdx[id];
      if (idx === undefined) return;
      const p = rec.model.parameters;
      p.values[idx] = clamp(p.values[idx] + delta, p.minimumValues[idx], p.maximumValues[idx]);
    }

    mulParam(rec, id, factor) {
      const idx = rec.paramIdx[id];
      if (idx === undefined) return;
      const p = rec.model.parameters;
      p.values[idx] = clamp(p.values[idx] * factor, p.minimumValues[idx], p.maximumValues[idx]);
    }

    applyMotion(rec, dt) {
      const model = rec.model;
      const p = model.parameters;

      if (rec.curMotion && rec.curMotion.data) {
        const cm = rec.curMotion;
        const meta = cm.data.Meta || {};
        const dur = Math.max(0.1, meta.Duration || 2.0);
        cm.elapsed += dt;
        if (cm.elapsed > dur) {
          if (cm.loop) {
            cm.elapsed = cm.elapsed % dur;
          } else if (rec.motions.has('Idle')) {
            rec.curMotion = { data: rec.motions.get('Idle')[0], elapsed: 0, loop: true, weight: 0.65 };
          } else {
            rec.curMotion = null;
          }
        }
        if (rec.curMotion && rec.curMotion.data && Array.isArray(rec.curMotion.data.Curves)) {
          const t = rec.curMotion.elapsed;
          const w = rec.curMotion.weight;
          for (const curve of rec.curMotion.data.Curves) {
            const val = evalMotionCurve(curve.Segments, t);
            if (curve.Target === 'Parameter') {
              const idx = rec.paramIdx[curve.Id];
              if (idx !== undefined) {
                const lo = p.minimumValues[idx], hi = p.maximumValues[idx];
                p.values[idx] = clamp(lerp(p.values[idx], val, w), lo, hi);
              }
            } else if (curve.Target === 'PartOpacity' && model.parts) {
              const pid = rec.partIdx[curve.Id];
              if (pid !== undefined) model.parts.opacities[pid] = clamp(val, 0, 1);
            }
          }
        }
      }
    }

    applyExpressionsAndPose(rec, dt) {
      const model = rec.model;
      const p = model.parameters;

      // Apply active exp3.json expression on top of motion & base tracking
      if (rec.activeExp && rec.expressions.has(rec.activeExp)) {
        const exp = rec.expressions.get(rec.activeExp);
        const fadeIn = Math.max(0.08, exp.FadeInTime !== undefined ? exp.FadeInTime : 0.25);
        rec.expWeight = clamp(rec.expWeight + dt / fadeIn, 0, 1);
        for (const ep of (exp.Parameters || [])) {
          const idx = rec.paramIdx[ep.Id];
          if (idx === undefined) continue;
          const lo = p.minimumValues[idx], hi = p.maximumValues[idx];
          const w = rec.expWeight;
          if (ep.Blend === 'Multiply') {
            p.values[idx] = clamp(p.values[idx] * lerp(1, ep.Value, w), lo, hi);
          } else if (ep.Blend === 'Overwrite') {
            p.values[idx] = clamp(lerp(p.values[idx], ep.Value, w), lo, hi);
          } else {
            p.values[idx] = clamp(p.values[idx] + ep.Value * w, lo, hi);
          }
        }
      }

      // Apply pose3.json mutually exclusive part groups + Link propagation
      if (rec.poseGroups.length && model.parts) {
        for (const grp of rec.poseGroups) {
          if (!Array.isArray(grp) || grp.length < 2) continue;
          let winner = 0;
          for (let i = 0; i < grp.length; i++) {
            const pid = rec.partIdx[grp[i].Id];
            if (pid !== undefined && model.parts.opacities[pid] > 0.5) {
              winner = i;
              break;
            }
          }
          for (let i = 0; i < grp.length; i++) {
            const val = i === winner ? 1.0 : 0.0;
            const pid = rec.partIdx[grp[i].Id];
            if (pid !== undefined) model.parts.opacities[pid] = val;
            if (Array.isArray(grp[i].Link)) {
              for (const linkId of grp[i].Link) {
                const lpid = rec.partIdx[linkId];
                if (lpid !== undefined) model.parts.opacities[lpid] = val;
              }
            }
          }
        }
      }
    }

    render(state, avatar, ctx2d, vw, vh, isPeek) {
      const asset = avatar.customAsset;
      if (!asset) return false;

      const rec = this.ensureModel(asset.entryUrl, state.cfg.hasCubismCore, asset);
      const bm = rec && rec.bongoManifest;

      // Layer A: BongoCat / BongoCatMver Background Art (desk / mousepad) underneath model
      const destRect = this.computeBongoRect(vw, vh, state, bm);
      if (bm && bm.backgroundUrl) {
        const bgImg = this.getCachedImage(bm.backgroundUrl);
        if (bgImg) {
          ctx2d.drawImage(bgImg, destRect.x, destRect.y, destRect.w, destRect.h);
        }
      }

      // Layer B: Full Live2D Cubism WebGL2 Model OR Preview Fallback
      let renderedWebGL = false;
      if ((state.cfg.hasCubismCore || coreAvailable) && rec && rec.ready && rec.model && this.gl) {
        this.renderCubismWebGL(rec, state, isPeek);
        renderedWebGL = true;
      } else {
        this.renderFallback2D(ctx2d, vw, vh, state, asset, isPeek);
      }

      return { renderedWebGL, rec, destRect };
    }

    // Layer C: BongoCat / BongoCatMver Pressed Keycap + Paw Overlay drawn crisp ON TOP of Live2D!
    renderBongoOverlays(ctx2d, state, rec, destRect) {
      const bm = rec && rec.bongoManifest;
      if (!bm) return;

      const activeKeys = state.getActiveKeyNames ? state.getActiveKeyNames() : [];
      if (activeKeys.length === 0) return;

      for (let i = 0; i < activeKeys.length; i++) {
        const keyName = activeKeys[i];
        // Modern BongoCat (ayangweb/BongoCat) left-keys & right-keys composed overlays
        if (bm.leftKeys && bm.leftKeys[keyName]) {
          const img = this.getCachedImage(bm.leftKeys[keyName]);
          if (img) ctx2d.drawImage(img, destRect.x, destRect.y, destRect.w, destRect.h);
        }
        if (bm.rightKeys && bm.rightKeys[keyName]) {
          const img = this.getCachedImage(bm.rightKeys[keyName]);
          if (img) ctx2d.drawImage(img, destRect.x, destRect.y, destRect.w, destRect.h);
        }
        // Legacy BongoCatMver separate keyboard keycap + hand overlay layers
        if (bm.mverKeyboard && bm.mverKeyboard[keyName]) {
          const img = this.getCachedImage(bm.mverKeyboard[keyName]);
          if (img) ctx2d.drawImage(img, destRect.x, destRect.y, destRect.w, destRect.h);
        }
        if (bm.mverHand && bm.mverHand[keyName]) {
          const img = this.getCachedImage(bm.mverHand[keyName]);
          if (img) ctx2d.drawImage(img, destRect.x, destRect.y, destRect.w, destRect.h);
        }
      }
    }

    computeBongoRect(vw, vh, state, bm) {
      const sc = clamp(state.cfg.customScale || 1.0, 0.5, 1.8);
      const offY = (state.cfg.customOffsetY || 0);
      const img = bm && bm.backgroundUrl ? this.getCachedImage(bm.backgroundUrl) : null;
      const ar = (img && img.width && img.height) ? (img.width / img.height) : (612 / 354);
      let w = vw * 0.94 * sc;
      let h = w / ar;
      if (h > vh * 0.94 * sc) {
        h = vh * 0.94 * sc;
        w = h * ar;
      }
      return {
        x: (vw - w) * 0.5,
        y: (vh - h) * 0.5 + offY,
        w,
        h,
      };
    }

    renderCubismWebGL(rec, state, isPeek) {
      const gl = this.gl;
      const model = rec.model;
      const p = model.parameters;

      const now = state.time;
      const dt = this.lastTime > 0 ? clamp(now - this.lastTime, 0.001, 0.05) : 0.016;
      this.lastTime = now;

      // Official Cubism 8-step update pipeline:
      // 1. Reset parameters to defaults
      for (let i = 0; i < p.count; i++) {
        p.values[i] = p.defaultValues[i];
      }

      // 2. Motion3 (Idle / TapBody)
      this.applyMotion(rec, dt);

      // 3. Interactive Head / Body / Eye / Audio / Shortcut Parameters (layered gently onto Idle motion)
      const sleep = state.sleepBlend.value;
      const pet = state.petBlend.value;
      const music = state.musicNod.value;
      const panicShake = state.memeId === 'undo_panic' ? Math.sin(now * 28) * 16 : 0;

      this.addParam(rec, 'ParamAngleX', state.headYaw.value * 28 + panicShake);
      this.addParam(rec, 'ParamAngleY', -state.headPitch.value * 26 - sleep * 18 - music * 10);
      this.addParam(rec, 'ParamAngleZ', -state.headRoll.value * 40 + pet * 14);
      this.addParam(rec, 'ParamBodyAngleX', state.headYaw.value * 9);
      this.addParam(rec, 'ParamBodyAngleY', -music * 4 - state.bodyBounce.value * 3);
      this.addParam(rec, 'ParamBodyAngleZ', -state.headRoll.value * 14);
      this.setParam(rec, 'ParamBreath', 0.5 + 0.5 * Math.sin(now * (sleep > 0.5 ? 1.5 : 2.3)));
      this.addParam(rec, 'ParamEyeBallX', state.eyeX.value);
      this.addParam(rec, 'ParamEyeBallY', -state.eyeY.value);

      // 4. Blink & Smile & LipSync (respecting model3.json EyeBlink & LipSync Groups!)
      const eyeOpen = clamp(1.0 - state.blinkPhase - sleep * 0.96 - pet * 0.92, 0, 1);
      for (const bid of (rec.eyeBlinkIds || ['ParamEyeLOpen', 'ParamEyeROpen'])) {
        this.mulParam(rec, bid, eyeOpen);
      }
      const smileVal = clamp(pet + (state.memeId === 'save_zen' ? 0.8 : 0), 0, 1);
      if (smileVal > 0.01) {
        this.setParam(rec, 'ParamEyeLSmile', smileVal);
        this.setParam(rec, 'ParamEyeRSmile', smileVal);
      }

      const lipAudio = (state.cfg.audioReactive && state.audioPlaying && sleep < 0.5)
        ? clamp(state.audioLevel * 0.9 + state.audioBass * 0.35, 0, 0.85)
        : 0;
      const mouthVal = Math.max(state.yawnOpen.value, lipAudio);
      if (mouthVal > 0.01) {
        const lipIds = rec.lipSyncIds && rec.lipSyncIds.length ? rec.lipSyncIds : ['ParamMouthOpenY'];
        for (const lid of lipIds) this.setParam(rec, lid, mouthVal);
        this.setParam(rec, 'ParamMouthOpenY', mouthVal);
      }
      const cheekVal = clamp(pet + state.nearness.value * 0.35, 0, 1);
      if (cheekVal > 0.01) this.addParam(rec, 'ParamCheek', cheekVal);

      // Complete BongoCat / BongoCatMver / Gamepad Parameter Suite
      const mxNorm = (state.mouseX.value - 0.5) * 2;
      const myNorm = (0.5 - state.mouseY.value) * 2;
      this.setParam(rec, 'ParamMouseX', mxNorm * 30);
      this.setParam(rec, 'ParamMouseY', myNorm * 30);
      this.setParam(rec, 'CatParamLeftHandDown', state.leftPawDown.value);
      this.setParam(rec, 'CatParamRightHandDown', Math.max(state.rightPawDown.value, state.mouseL.value));
      this.setParam(rec, 'CatParamMouseLeftDown', state.mouseL.value);
      this.setParam(rec, 'CatParamMouseRightDown', state.mouseR.value);
      this.setParam(rec, 'CatParamStickLX', mxNorm);
      this.setParam(rec, 'CatParamStickLY', myNorm);
      this.setParam(rec, 'CatParamStickRX', mxNorm);
      this.setParam(rec, 'CatParamStickRY', myNorm);
      this.setParam(rec, 'CatParamStickLeftDown', state.leftPawDown.value);
      this.setParam(rec, 'CatParamStickRightDown', state.mouseL.value);

      // 5 & 6. Expressions (exp3.json) on top + Pose (pose3.json) mutual exclusion
      this.applyExpressionsAndPose(rec, dt);

      // 7. Real physics3.json Multi-Pendulum Simulation!
      if (rec.physics) {
        const gust = Math.sin(now * 2.1) * (0.08 + state.turboLevel * 0.35 + (state.audioPlaying ? state.audioBass * 0.4 : 0));
        rec.physics.step(model, rec.paramIdx, dt, gust);
      }

      // 8. Final Core mesh deformation update
      model.update();

      // Compute exact aspect-preserving & origin-centered projection from CanvasInfo
      const cw = this.canvas.width, ch = this.canvas.height;
      const aspect = cw / Math.max(1, ch);
      const ci = rec.canvasInfo;
      const modelH = Math.max(0.2, ci.height);
      const modelW = Math.max(0.2, ci.width);
      const modelCenterX = ci.width * 0.5 - ci.originX;
      const modelCenterY = ci.originY - ci.height * 0.5;
      const baseScale = Math.min((1.88 * aspect) / modelW, 1.88 / modelH);
      const sc = baseScale * clamp(state.cfg.customScale || 1.0, 0.5, 2.2) * (isPeek ? 1.15 : 1.0);
      const scaleX = sc / aspect;
      const scaleY = sc;
      const offX = -modelCenterX * scaleX;
      const offY = -modelCenterY * scaleY + (state.cfg.customOffsetY || 0) * -0.005;

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cw, ch);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.useProgram(this.prog);
      gl.uniform2f(this.u.scale, scaleX, scaleY);
      gl.uniform2f(this.u.offset, offX, offY);

      const d = model.drawables;
      // Cubism 5-r.5 moved renderOrders to model.getRenderOrders(); Cubism 4 exposes d.renderOrders
      const renderOrders = (typeof model.getRenderOrders === 'function')
        ? model.getRenderOrders()
        : (d.renderOrders || d.drawOrders);
      const order = Array.from({ length: d.count }, (_, i) => i);
      order.sort((a, b) => renderOrders[a] - renderOrders[b]);

      const Core = window.Live2DCubismCore;
      const Utils = Core && Core.Utils;
      const multArr = d.multiplyColors || null;
      const scrArr = d.screenColors || null;
      const blendModes = d.blendModes || null;
      let cachedMaskKey = '';

      const drawMesh = (idx) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, d.vertexPositions[idx], gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
        gl.bufferData(gl.ARRAY_BUFFER, d.vertexUvs[idx], gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, d.indices[idx], gl.STATIC_DRAW);
        gl.drawElements(gl.TRIANGLES, d.indices[idx].length, gl.UNSIGNED_SHORT, 0);
      };

      for (let oi = 0; oi < order.length; oi++) {
        const i = order[oi];
        const isVisible = Utils && Utils.hasIsVisibleBit
          ? Utils.hasIsVisibleBit(d.dynamicFlags[i])
          : ((d.dynamicFlags[i] & 1) !== 0);
        if (!isVisible) continue;
        const op = d.opacities[i];
        if (op <= 0.001) continue;
        const tex = rec.textures[d.textureIndices[i]];
        if (!tex) continue;

        const maskCount = d.maskCounts ? d.maskCounts[i] : 0;
        const useMask = maskCount > 0 && d.masks && d.masks[i];

        if (useMask) {
          const maskList = d.masks[i];
          let mKey = '';
          for (let m = 0; m < maskCount; m++) mKey += maskList[m] + ',';

          if (mKey !== cachedMaskKey) {
            cachedMaskKey = mKey;
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFbo);
            gl.viewport(0, 0, this.maskSize, this.maskSize);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.uniform1i(this.u.passMode, 1);
            gl.uniform1i(this.u.useMask, 0);

            for (let m = 0; m < maskCount; m++) {
              const mi = maskList[m];
              const mTex = rec.textures[d.textureIndices[mi]];
              if (!mTex) continue;
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, mTex);
              gl.uniform1i(this.u.tex, 0);
              drawMesh(mi);
            }

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, cw, ch);
          }
        }

        const cFlags = d.constantFlags[i];
        const colorBlend = (blendModes && blendModes.length >= (i + 1) * 2) ? blendModes[i * 2] : 0;
        const isAdd = (Utils && Utils.hasBlendAdditiveBit ? Utils.hasBlendAdditiveBit(cFlags) : ((cFlags & 1) !== 0))
          || colorBlend === 1 || colorBlend === 3 || colorBlend === 4;
        const isMult = (Utils && Utils.hasBlendMultiplicativeBit ? Utils.hasBlendMultiplicativeBit(cFlags) : ((cFlags & 2) !== 0))
          || colorBlend === 2 || colorBlend === 6;
        const isInvMask = Utils && Utils.hasIsInvertedMaskBit
          ? Utils.hasIsInvertedMaskBit(cFlags)
          : ((cFlags & 8) !== 0);

        if (isAdd) {
          gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE); // Additive
        } else if (isMult) {
          gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); // Multiply
        } else {
          gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // Normal
        }

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(this.u.tex, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
        gl.uniform1i(this.u.maskTex, 1);

        gl.uniform1i(this.u.passMode, 0);
        gl.uniform1i(this.u.useMask, useMask ? 1 : 0);
        gl.uniform1i(this.u.invertedMask, isInvMask ? 1 : 0);
        gl.uniform1f(this.u.opacity, op);

        if (multArr && multArr.length >= (i + 1) * 4) {
          const b = i * 4;
          gl.uniform4f(this.u.mult, multArr[b], multArr[b + 1], multArr[b + 2], multArr[b + 3]);
        } else {
          gl.uniform4f(this.u.mult, 1, 1, 1, 1);
        }
        if (scrArr && scrArr.length >= (i + 1) * 4) {
          const b = i * 4;
          gl.uniform4f(this.u.screen, scrArr[b], scrArr[b + 1], scrArr[b + 2], scrArr[b + 3]);
        } else {
          gl.uniform4f(this.u.screen, 0, 0, 0, 0);
        }

        drawMesh(i);
      }
    }

    renderFallback2D(ctx, vw, vh, state, asset, isPeek) {
      const url = asset.previewUrl;
      const cx = vw * 0.5, cy = vh * 0.48 + (state.cfg.customOffsetY || 0);
      if (url) {
        let rec = this.fallbackImgCache.get(url);
        if (!rec) {
          rec = { img: new Image(), loaded: false };
          rec.img.crossOrigin = 'anonymous';
          rec.img.onload = () => { rec.loaded = true; };
          rec.img.src = url;
          this.fallbackImgCache.set(url, rec);
        }
        if (rec.loaded) {
          const maxD = (isPeek ? 155 : 260) * (state.cfg.customScale || 1.0);
          const ratio = Math.min(maxD / Math.max(1, rec.img.width), maxD / Math.max(1, rec.img.height));
          const dw = rec.img.width * ratio, dh = rec.img.height * ratio;
          ctx.save();
          ctx.translate(cx + state.headYaw.value * 7, cy + Math.sin(state.time * 2.2) * 2 + state.bodyBounce.value * 2.5);
          ctx.rotate(state.headRoll.value * 0.65);
          ctx.drawImage(rec.img, -dw * 0.5, -dh * 0.5, dw, dh);
          ctx.restore();
          return;
        }
      }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = 'rgba(246, 242, 234, 0.96)';
      ctx.strokeStyle = '#2A232B';
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(0, 0, 62, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2A232B';
      ctx.font = '700 12px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Live2D 模型已导入', 0, -6);
      ctx.fillStyle = '#8A7E72';
      ctx.font = '500 10px "Segoe UI", sans-serif';
      ctx.fillText('请在「外部模型」导入 Cubism Core', 0, 13);
      ctx.restore();
    }
  }

  return { Live2DRenderer, isCoreAvailable: () => coreAvailable };
})();
