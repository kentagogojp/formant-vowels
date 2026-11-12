// F1-F2平面とスペクトル表示（canvas描画とドラッグ操作）
(function () {
  'use strict';
  const { VOWELS, RANGE, target } = window.VowelData;
  const { envelopeDb, harmonicDb } = window.Formant;

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function vowelColor(id) { return css('--v-' + id); }
  function alpha(color, a) {
    // #rrggbb を rgba に
    const m = /^#([0-9a-f]{6})$/i.exec(color);
    if (!m) return color;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }

  class CanvasView {
    constructor(canvas) {
      this.cv = canvas; this.g = canvas.getContext('2d');
      this.w = 0; this.h = 0;
      new ResizeObserver(() => this.resize()).observe(canvas);
      this.resize();
    }
    resize() {
      const r = this.cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      this.w = r.width; this.h = r.height;
      this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.onResize && this.onResize();
    }
    pos(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  }

  // ---------- F1-F2平面 ----------
  // 横軸F2（左が高い）、縦軸F1（下が高い）。音声学の母音図と同じ向きで、口の中の舌の位置に近い配置になる
  class PlaneView extends CanvasView {
    constructor(canvas, handlers) {
      super(canvas);
      this.h_ = handlers; this.trail = [];
      this.pad = { l: 60, r: 14, t: 26, b: 34 };
      canvas.addEventListener('pointerdown', (e) => {
        if (this.h_.canDrag && !this.h_.canDrag()) return;
        canvas.setPointerCapture(e.pointerId); this.dragging = true;
        this.emit(e); this.h_.onDragStart && this.h_.onDragStart();
      });
      canvas.addEventListener('pointermove', (e) => { if (this.dragging) this.emit(e); });
      const end = () => { if (!this.dragging) return; this.dragging = false; this.h_.onDragEnd && this.h_.onDragEnd(); };
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
    }
    lx(f2) { const [a, b] = RANGE.f2; return this.pad.l + (Math.log(b) - Math.log(f2)) / (Math.log(b) - Math.log(a)) * (this.w - this.pad.l - this.pad.r); }
    ly(f1) { const [a, b] = RANGE.f1; return this.pad.t + (Math.log(f1) - Math.log(a)) / (Math.log(b) - Math.log(a)) * (this.h - this.pad.t - this.pad.b); }
    inv(x, y) {
      const [a2, b2] = RANGE.f2, [a1, b1] = RANGE.f1;
      const fx = (x - this.pad.l) / (this.w - this.pad.l - this.pad.r);
      const fy = (y - this.pad.t) / (this.h - this.pad.t - this.pad.b);
      const f2 = Math.exp(Math.log(b2) - fx * (Math.log(b2) - Math.log(a2)));
      const f1 = Math.exp(Math.log(a1) + fy * (Math.log(b1) - Math.log(a1)));
      return { f1: Math.round(Math.min(b1, Math.max(a1, f1))), f2: Math.round(Math.min(b2, Math.max(a2, f2))) };
    }
    emit(e) { const p = this.pos(e); this.h_.onMove(this.inv(p.x, p.y)); }

    draw(st) {
      const g = this.g, W = this.w, H = this.h, P = this.pad;
      if (!W) return;
      g.clearRect(0, 0, W, H);
      const ink = css('--ink'), muted = css('--muted'), grid = css('--grid'), mono = css('--f-mono');
      // グリッド
      g.font = `11px ${mono}`; g.fillStyle = muted; g.strokeStyle = grid; g.lineWidth = 1;
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (const f of [500, 700, 1000, 1500, 2000, 3000]) {
        const x = Math.round(this.lx(f)) + 0.5;
        g.beginPath(); g.moveTo(x, P.t); g.lineTo(x, H - P.b); g.stroke();
        g.fillText(f >= 1000 ? (f / 1000) + 'k' : f, x, H - P.b + 6);
      }
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (const f of [200, 300, 500, 700, 1000]) {
        const y = Math.round(this.ly(f)) + 0.5;
        g.beginPath(); g.moveTo(P.l, y); g.lineTo(W - P.r, y); g.stroke();
        g.fillText(f, P.l - 6, y);
      }
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillText('← F2 (Hz) 舌が前', P.l, P.t - 9);
      g.save(); g.translate(12, H - P.b); g.rotate(-Math.PI / 2); g.fillText('F1 (Hz) 口が開く →', 0, 0); g.restore();

      if (st.planeHidden) {
        this.trail = [];
        g.fillStyle = muted; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `700 15px ${css('--f-display')}`;
        g.fillText('むずかしいモードでは母音図は見えません', (P.l + W - P.r) / 2, (P.t + H - P.b) / 2 - 12);
        g.font = `13px ${css('--f-body')}`;
        g.fillText('スペクトルとスライダー、そして耳で作ろう', (P.l + W - P.r) / 2, (P.t + H - P.b) / 2 + 14);
        return;
      }

      // 母音の領域（楕円）
      const [a2, b2] = RANGE.f2, [a1, b1] = RANGE.f1;
      const sx = (W - P.l - P.r) / (Math.log(b2) - Math.log(a2));
      const sy = (H - P.t - P.b) / (Math.log(b1) - Math.log(a1));
      const R = 1.15;
      for (const v of (st.regions === false ? [] : VOWELS)) {
        const t = target(v, st.voice), c = vowelColor(v.id);
        const cx = this.lx(t.f2), cy = this.ly(t.f1);
        const hi = st.highlight === v.id;
        g.beginPath(); g.ellipse(cx, cy, 0.18 * R * sx, 0.22 * R * sy, 0, 0, Math.PI * 2);
        g.fillStyle = alpha(c, hi ? 0.28 : 0.14); g.fill();
        g.strokeStyle = alpha(c, hi ? 0.9 : 0.45); g.lineWidth = hi ? 2 : 1.25; g.stroke();
        g.fillStyle = c; g.font = `700 ${Math.max(18, Math.min(30, W / 18))}px ${css('--f-display')}`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(v.kana, cx, cy);
      }

      // 軌跡
      const px = this.lx(st.f2), py = this.ly(st.f1), last = this.trail[this.trail.length - 1];
      if (!last || Math.abs(last.x - px) + Math.abs(last.y - py) > 0.5) this.trail.push({ x: px, y: py });
      if (this.trail.length > 36) this.trail.shift();
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1], b = this.trail[i];
        g.strokeStyle = alpha(css('--ink'), i / this.trail.length * 0.35);
        g.lineWidth = 2; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }

      // 現在の点
      const x = this.lx(st.f2), y = this.ly(st.f1);
      const jc = st.judge && st.mode === 'free' ? vowelColor(st.judge.vowel.id) : ink;
      if (st.playing) {
        const r = 14 + 4 * Math.sin(performance.now() / 130);
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.strokeStyle = alpha(jc, 0.5); g.lineWidth = 2; g.stroke();
      }
      g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fillStyle = jc; g.fill();
      g.lineWidth = 2.5; g.strokeStyle = css('--surface'); g.stroke();
    }
  }

  // ---------- スペクトル表示 ----------
  // 横軸は周波数（0〜5kHz）、縦軸は強さ（dB）。縦線は倍音、曲線は包絡（フォルマントの山）
  class SpectrumView extends CanvasView {
    constructor(canvas, handlers) {
      super(canvas);
      this.h_ = handlers; this.fmax = 5000; this.dbRange = 60; this.dbTop = 8;
      this.pad = { l: 40, r: 14, t: 30, b: 34 };
      this.handles = [];
      canvas.addEventListener('pointerdown', (e) => {
        const p = this.pos(e);
        let best = null;
        for (const h of this.handles) {
          const d = Math.abs(h.x - p.x) + Math.abs(h.y - p.y) * 0.3;
          if (!best || d < best.d) best = { h, d };
        }
        if (!best || best.d > 60) return;
        canvas.setPointerCapture(e.pointerId);
        this.drag = best.h.key; this.h_.onDragStart && this.h_.onDragStart(this.drag);
        this.emit(e);
      });
      canvas.addEventListener('pointermove', (e) => {
        if (this.drag) { this.emit(e); return; }
        const p = this.pos(e);
        const near = this.handles.some((h) => Math.hypot(h.x - p.x, h.y - p.y) < 24);
        canvas.style.cursor = near ? 'ew-resize' : 'default';
      });
      const end = () => { if (!this.drag) return; this.drag = null; this.h_.onDragEnd && this.h_.onDragEnd(); };
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
    }
    fx(f) { return this.pad.l + f / this.fmax * (this.w - this.pad.l - this.pad.r); }
    fy(db) { return this.pad.t + ((this.dbTop - db) / (this.dbRange + this.dbTop)) * (this.h - this.pad.t - this.pad.b); }
    emit(e) {
      const p = this.pos(e);
      const f = (p.x - this.pad.l) / (this.w - this.pad.l - this.pad.r) * this.fmax;
      this.h_.onMove(this.drag, Math.round(f));
    }

    draw(st) {
      const g = this.g, W = this.w, H = this.h, P = this.pad;
      if (!W) return;
      g.clearRect(0, 0, W, H);
      const ink = css('--ink'), muted = css('--muted'), grid = css('--grid'), mono = css('--f-mono');
      const p = st.params;

      // 正規化の基準（包絡の最大値を 0dB にする）
      let ref = -Infinity;
      for (let f = 50; f <= this.fmax; f += 10) ref = Math.max(ref, envelopeDb(f, p));

      // グリッド
      g.font = `11px ${mono}`; g.fillStyle = muted; g.strokeStyle = grid; g.lineWidth = 1;
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (let f = 0; f <= this.fmax; f += 1000) {
        const x = Math.round(this.fx(f)) + 0.5;
        g.beginPath(); g.moveTo(x, P.t); g.lineTo(x, H - P.b); g.stroke();
        g.fillText(f === 0 ? '0' : (f / 1000) + 'k', x, H - P.b + 6);
      }
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (let db = 0; db >= -this.dbRange; db -= 20) {
        const y = Math.round(this.fy(db)) + 0.5;
        g.beginPath(); g.moveTo(P.l, y); g.lineTo(W - P.r, y); g.stroke();
        g.fillText(db, P.l - 6, y);
      }
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillText('強さ (dB)　縦線＝倍音（F0の整数倍）', P.l, P.t - 14);
      g.textAlign = 'right'; g.fillText('周波数 (Hz)', W - P.r, H - 4);

      // 選んだ母音のお手本（点線）
      if (st.ghost) {
        const gp = Object.assign({}, p, st.ghost);
        let gref = -Infinity;
        for (let f = 50; f <= this.fmax; f += 10) gref = Math.max(gref, envelopeDb(f, gp));
        g.setLineDash([5, 5]); g.strokeStyle = alpha(vowelColor(st.ghostId), 0.85); g.lineWidth = 1.5;
        g.beginPath();
        for (let f = 20; f <= this.fmax; f += 10) {
          const y = this.fy(Math.max(-this.dbRange, envelopeDb(f, gp) - gref));
          f === 20 ? g.moveTo(this.fx(f), y) : g.lineTo(this.fx(f), y);
        }
        g.stroke(); g.setLineDash([]);
      }

      // 倍音
      g.strokeStyle = alpha(css('--ink'), 0.32); g.lineWidth = Math.max(1, Math.min(3, (this.fx(p.f0) - this.fx(0)) * 0.35));
      for (let k = 1; k * p.f0 <= this.fmax; k++) {
        const db = Math.max(-this.dbRange, harmonicDb(k, p) - ref);
        const x = this.fx(k * p.f0);
        g.beginPath(); g.moveTo(x, this.fy(-this.dbRange)); g.lineTo(x, this.fy(db)); g.stroke();
      }

      // 包絡
      g.strokeStyle = ink; g.lineWidth = 2.5; g.lineJoin = 'round';
      g.beginPath();
      for (let f = 20; f <= this.fmax; f += 8) {
        const y = this.fy(Math.max(-this.dbRange, envelopeDb(f, p) - ref));
        f === 20 ? g.moveTo(this.fx(f), y) : g.lineTo(this.fx(f), y);
      }
      g.stroke();

      // フォルマントのつまみ
      const list = [
        { key: 'f1', label: 'F1', f: p.f1, color: ink },
        { key: 'f2', label: 'F2', f: p.f2, color: ink },
      ];
      if (p.f3on) list.push({ key: 'f3', label: 'F3', f: p.f3, color: ink });
      this.handles = [];
      g.font = `11px ${mono}`; g.fillStyle = muted; g.textAlign = 'center'; g.textBaseline = 'bottom';
      for (const [f, l] of [[p.f4, 'F4'], [p.f5, 'F5']]) {
        if (f > this.fmax) continue;
        g.fillText(l, this.fx(f), this.fy(Math.max(-this.dbRange, envelopeDb(f, p) - ref)) - 8);
      }
      for (const h of list) {
        const x = this.fx(h.f), y = this.fy(Math.max(-this.dbRange, envelopeDb(h.f, p) - ref));
        this.handles.push({ key: h.key, x, y });
        g.strokeStyle = alpha(h.color, 0.5); g.lineWidth = 1; g.setLineDash([2, 3]);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x, H - P.b); g.stroke(); g.setLineDash([]);
        const active = this.drag === h.key;
        g.beginPath(); g.arc(x, y, active ? 11 : 9, 0, Math.PI * 2);
        g.fillStyle = h.color; g.fill(); g.lineWidth = 2.5; g.strokeStyle = css('--surface'); g.stroke();
        g.fillStyle = h.color; g.font = `700 12px ${mono}`; g.textBaseline = 'bottom';
        g.fillText(h.label, x, y - 14);
      }
    }
  }

  window.Plots = { PlaneView, SpectrumView };
})();
