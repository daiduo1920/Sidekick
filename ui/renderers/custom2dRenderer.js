window.KuroCustom2DRenderer = (function () {
  const imgCache = new Map();

  function loadImg(url) {
    if (!url) return null;
    let rec = imgCache.get(url);
    if (!rec) {
      rec = { img: new Image(), loaded: false, failed: false };
      rec.img.crossOrigin = 'anonymous';
      rec.img.onload = () => { rec.loaded = true; };
      rec.img.onerror = () => { rec.failed = true; };
      rec.img.src = url;
      imgCache.set(url, rec);
    }
    return rec.loaded ? rec.img : null;
  }

  function render(ctx, vw, vh, state, avatar, isPeek) {
    const asset = avatar.customAsset;
    if (!asset || !asset.entryUrl) return;
    const img = loadImg(asset.previewUrl || asset.entryUrl);
    if (!img) return;

    const sc = Math.max(0.45, Math.min(2.0, state.cfg.customScale || 1.0));
    const maxDim = (isPeek ? 175 : 310) * sc;
    const ratio = Math.min(maxDim / Math.max(1, img.width), maxDim / Math.max(1, img.height));
    const dw = img.width * ratio;
    const dh = img.height * ratio;

    const t = state.time;
    const sleep = state.sleepBlend.value;
    const cx = vw * 0.5 + state.headYaw.value * 8;
    const cy = vh * 0.5 + (state.cfg.customOffsetY || 0)
      + Math.sin(t * 2.1) * 2.2
      + state.bodyBounce.value * 3.0
      + state.musicNod.value * 3.5
      + sleep * 14;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(state.headRoll.value * 0.55);
    ctx.scale(1 + Math.sin(t * 2.1) * 0.008, 1 - Math.sin(t * 2.1) * 0.008);
    ctx.drawImage(img, -dw * 0.5, -dh * 0.5, dw, dh);
    ctx.restore();
  }

  return { render };
})();
