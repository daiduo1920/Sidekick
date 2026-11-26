window.KuroFxLayer = (function () {
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function render(ctx, vw, vh, state, palette, avatar, skipParticles) {
    // 0. Live Eye-Anchor Calibration Reticle (visible while dragging custom anchor sliders in KuroStudio)
    if (state.showCalibrationCrosshair) {
      const anchor = state.getEyeAnchor();
      const ax = anchor.x * vw;
      const ay = anchor.y * vh;
      ctx.save();
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(ax - 24, ay); ctx.lineTo(ax + 24, ay);
      ctx.moveTo(ax, ay - 24); ctx.lineTo(ax, ay + 24);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(ax, ay, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.arc(ax, ay, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '700 10.5px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#241F29';
      ctx.fillText('眼神锚点', ax + 14, ay - 8);
      ctx.restore();
    }

    if (skipParticles) return;

    if (state.particles.length === 0 && state.turboLevel < 0.25 && state.memeTimer <= 0) return;

    const ink = (avatar && avatar.style && avatar.style.ink) || '#29232B';
    const isLineless = avatar && avatar.renderer === 'riso';

    // 1. Hand-inked anime speed lines on turbo typing (clean crisp strokes, zero neon blur!)
    if (state.turboLevel > 0.25) {
      ctx.save();
      ctx.strokeStyle = isLineless ? palette.accent : ink;
      ctx.lineCap = 'round';
      const alpha = (state.turboLevel - 0.25) * 0.65;
      for (let i = 0; i < 4; i++) {
        const side = i < 2 ? -1 : 1;
        const ph = ((state.time * 4.8 + i * 0.37) % 1);
        const x = vw * 0.46 + side * (86 + i * 10 + ph * 18);
        const y = vh * 0.26 + (i % 2) * 34 - ph * 15;
        ctx.globalAlpha = Math.sin(ph * Math.PI) * alpha;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + side * 14, y - 9);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2. Crisp Hand-Inked / Editorial Cel Expression Particles
    for (let i = 0; i < state.particles.length; i++) {
      const p = state.particles[i];
      const prog = clamp(p.life / p.maxLife, 0, 1);
      const alpha = Math.sin(prog * Math.PI);
      const px = p.x * vw;
      const py = p.y * vh;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(p.rot);
      ctx.globalAlpha = alpha * 0.96;

      if (p.type === 'sparkle' || p.type === 'star') {
        const r = p.size * (0.72 + 0.28 * alpha);
        ctx.fillStyle = p.type === 'star' ? '#E8A838' : palette.particle;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.quadraticCurveTo(r * 0.2, -r * 0.2, r, 0);
        ctx.quadraticCurveTo(r * 0.2, r * 0.2, 0, r);
        ctx.quadraticCurveTo(-r * 0.2, r * 0.2, -r, 0);
        ctx.quadraticCurveTo(-r * 0.2, -r * 0.2, 0, -r);
        ctx.closePath();
        ctx.fill();
        if (!isLineless) {
          ctx.strokeStyle = ink;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
      } else if (p.type === 'heart') {
        const s = p.size * 0.85 * (0.75 + 0.25 * alpha);
        ctx.fillStyle = palette.heart;
        ctx.beginPath();
        ctx.moveTo(0, s * 0.85);
        ctx.bezierCurveTo(-s * 1.3, 0, -s * 0.9, -s * 1.15, 0, -s * 0.32);
        ctx.bezierCurveTo(s * 0.9, -s * 1.15, s * 1.3, 0, 0, s * 0.85);
        ctx.closePath();
        ctx.fill();
        if (!isLineless) {
          ctx.strokeStyle = ink;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      } else if (p.type === 'sweat') {
        const s = p.size * 1.08;
        ctx.fillStyle = '#8CC2E8';
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.bezierCurveTo(s * 0.72, -s * 0.1, s * 0.75, s * 0.85, 0, s * 0.85);
        ctx.bezierCurveTo(-s * 0.75, s * 0.85, -s * 0.72, -s * 0.1, 0, -s);
        ctx.closePath();
        ctx.fill();
        if (!isLineless) {
          ctx.strokeStyle = ink;
          ctx.lineWidth = 1.7;
          ctx.stroke();
        }
        ctx.fillStyle = '#FFFDF8';
        ctx.beginPath();
        ctx.ellipse(-s * 0.22, s * 0.12, s * 0.16, s * 0.30, -0.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'note') {
        ctx.font = '800 ' + Math.round(p.size + 8) + 'px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = palette.accent;
        if (!isLineless) {
          ctx.strokeStyle = ink;
          ctx.lineWidth = 2.6;
          ctx.strokeText('♪', 0, 0);
        }
        ctx.fillText('♪', 0, 0);
      } else if (p.type === 'zzz') {
        ctx.font = '800 ' + Math.round(p.size + 1) + 'px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = '#F7F1E5';
        if (!isLineless) {
          ctx.strokeStyle = ink;
          ctx.lineWidth = 2.8;
          ctx.strokeText('z', 0, 0);
        }
        ctx.fillText('z', 0, 0);
      } else if (p.type === 'alert') {
        ctx.font = '900 18px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = palette.accent;
        if (!isLineless) {
          ctx.strokeStyle = ink;
          ctx.lineWidth = 3.0;
          ctx.strokeText('!', 0, 0);
        }
        ctx.fillText('!', 0, 0);
      }
      ctx.restore();
    }
  }

  return { render };
})();
