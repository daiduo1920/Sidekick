window.KuroStagePipeline = (function () {
  /**
   * Unified Production Rendering Orchestrator (v5) for BOTH PetWindow (pet.html) and KuroStudio (studio.html).
   * Routes cleanly between:
   * - Real VRM 3D Engine (Three.js + @pixiv/three-vrm: MToon, SpringBone, Expressions, LookAt, VRMA, Window-Sit)
   * - Real Live2D Cubism 4/5 + BongoCat / BongoCatMver Engine (Clipping Masks, Physics3, Motion3, Exp3, Key Overlays)
   * - Custom 2.5D PNG / WebP / SVG Companion Layer
   */
  class StagePipeline {
    constructor(canvas2d, canvas3d, canvasFx) {
      this.c2d = canvas2d;
      this.ctx2d = canvas2d.getContext('2d', { alpha: true });
      this.c3d = canvas3d;
      this.vrm = new window.KuroVrmRenderer.VrmRenderer(canvas3d);
      this.live2d = new window.KuroLive2DRenderer.Live2DRenderer();
      this.cFx = canvasFx;
      this.ctxFx = canvasFx.getContext('2d', { alpha: true });
      this.lastRenderer = '';
    }

    syncCanvasSizes() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
      const rect = this.c2d.getBoundingClientRect();
      const cw = Math.max(1, Math.round(rect.width * dpr));
      const ch = Math.max(1, Math.round(rect.height * dpr));
      for (const c of [this.c2d, this.c3d, this.cFx]) {
        if (c.width !== cw || c.height !== ch) {
          c.width = cw;
          c.height = ch;
        }
      }
      return { cw, ch, dpr };
    }

    pruneUnusedAssets(customAssets) {
      if (this.vrm && this.vrm.pruneCache) {
        const builtIns = (window.KuroRegistry.avatars || []).map((a) => a.vrmUrl).filter(Boolean);
        this.vrm.pruneCache(customAssets, builtIns);
      }
    }

    getActiveCapabilities(state) {
      const avatar = window.KuroRegistry.getAvatar(state.cfg.avatar, state.cfg.customAssets);
      if (avatar.renderer === 'vrm3d') {
        const cap = this.vrm.getActiveCapabilities();
        return { kind: 'vrm3d', ...cap };
      }
      if (avatar.renderer === 'live2d' && avatar.customAsset) {
        const cap = this.live2d.getModelCapabilities(avatar.customAsset.entryUrl);
        return { kind: 'live2d', ...cap };
      }
      return { kind: avatar.renderer, ready: true, expressions: [], motions: [] };
    }

    triggerExpression(state, name) {
      const avatar = window.KuroRegistry.getAvatar(state.cfg.avatar, state.cfg.customAssets);
      if (avatar.renderer === 'live2d' && avatar.customAsset) {
        this.live2d.triggerExpression(avatar.customAsset.entryUrl, name);
      } else if (avatar.renderer === 'vrm3d') {
        state.setManualExpression && state.setManualExpression(name, 3.0);
      }
    }

    triggerMotion(state, group, index) {
      const avatar = window.KuroRegistry.getAvatar(state.cfg.avatar, state.cfg.customAssets);
      if (avatar.renderer === 'live2d' && avatar.customAsset) {
        this.live2d.triggerMotion(avatar.customAsset.entryUrl, group, index);
      }
    }

    render(state) {
      const { cw, ch } = this.syncCanvasSizes();
      const avatar = window.KuroRegistry.getAvatar(state.cfg.avatar, state.cfg.customAssets);
      const palette = window.KuroRegistry.getPalette(state.cfg.palette);
      const isPeek = state.cfg.dockMode === 'peek';

      const vw = isPeek ? 320 : 460;
      const vh = isPeek ? 260 : 420;
      const useVrm3D = (avatar.renderer === 'vrm3d' && this.vrm.available);

      if (useVrm3D !== (this.lastRenderer === '3d')) {
        this.lastRenderer = useVrm3D ? '3d' : '2d';
        this.c2d.classList.toggle('active', !useVrm3D);
        this.c3d.classList.toggle('active', useVrm3D);
      }

      if (useVrm3D) {
        this.ctx2d.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx2d.clearRect(0, 0, cw, ch);
        this.vrm.render(state, avatar, palette, isPeek);
      } else {
        const ctx = this.ctx2d;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        ctx.imageSmoothingEnabled = true;

        const scale = Math.min(cw / vw, ch / vh);
        const ox = (cw - vw * scale) * 0.5;
        const oy = (ch - vh * scale) * 0.5;

        if (avatar.renderer === 'live2d') {
          const lw = Math.max(1, Math.round(vw * scale));
          const lh = Math.max(1, Math.round(vh * scale));
          if (this.live2d.canvas.width !== lw || this.live2d.canvas.height !== lh) {
            this.live2d.canvas.width = lw;
            this.live2d.canvas.height = lh;
          }
          ctx.save();
          ctx.translate(ox, oy);
          ctx.scale(scale, scale);
          const res = this.live2d.render(state, avatar, ctx, vw, vh, isPeek);
          ctx.restore();

          if (res && res.renderedWebGL) {
            ctx.drawImage(this.live2d.canvas, ox, oy, vw * scale, vh * scale);
          }
          // Composite BongoCat / BongoCatMver active keycap & paw overlays cleanly ON TOP!
          if (res && res.rec && res.destRect) {
            ctx.save();
            ctx.translate(ox, oy);
            ctx.scale(scale, scale);
            this.live2d.renderBongoOverlays(ctx, state, res.rec, res.destRect);
            ctx.restore();
          }
        } else if (avatar.renderer === 'custom25d' && window.KuroCustom2DRenderer) {
          ctx.translate(ox, oy);
          ctx.scale(scale, scale);
          window.KuroCustom2DRenderer.render(ctx, vw, vh, state, avatar, isPeek);
        }
        ctx.restore();
      }

      // Layer 4: Subtle Interactive Mood FX Overlay (notes, hearts, Zzz, sweat, shortcut sparks)
      const fctx = this.ctxFx;
      fctx.save();
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.clearRect(0, 0, cw, ch);
      const scale = Math.min(cw / vw, ch / vh);
      fctx.translate((cw - vw * scale) * 0.5, (ch - vh * scale) * 0.5);
      fctx.scale(scale, scale);
      if (window.KuroFxLayer) {
        window.KuroFxLayer.render(fctx, vw, vh, state, palette, avatar, false);
      }
      fctx.restore();
    }
  }

  return { StagePipeline };
})();
