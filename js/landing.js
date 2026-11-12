// トップページ（説明・試聴・図）と、トップ⇔アプリ画面の切り替え
(function () {
  'use strict';
  const { VOWELS, target } = window.VowelData;
  const { envelopeDb, harmonicDb } = window.Formant;
  const $ = (s) => document.querySelector(s);
  const MODES = ['free', 'maker', 'quiz'];

  // ---------- 画面の切り替え（#free #maker #quiz ならアプリ、それ以外はトップ） ----------
  function route() {
    const h = location.hash.slice(1);
    const App = window.App;
    if (MODES.includes(h)) {
      const wasTop = document.body.dataset.view !== 'app';
      document.body.dataset.view = 'app';
      window.Game.setMode(h);
      App.markDirty();
      if (wasTop) window.scrollTo(0, 0);
    } else {
      document.body.dataset.view = 'top';
      if (App.state.playing) App.togglePlay(false);
      if (App.state.mode !== 'free') window.Game.setMode('free');
      window.scrollTo(0, 0);
    }
  }

  // ---------- 試聴ボタン ----------
  function buildListen() {
    const row = $('#listen-row');
    for (const v of VOWELS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'listen-btn';
      b.style.setProperty('--vc', `var(--v-${v.id})`);
      b.innerHTML = `<span>${v.kana}</span>`;
      b.setAttribute('aria-label', `「${v.kana}」を聞く`);
      b.addEventListener('click', () => {
        window.App.selectVowel(v.id);
        b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
      });
      row.appendChild(b);
    }
  }

  // ---------- 「声ができるまで」の図（実際の合成と同じ計算で描く） ----------
  const W = 240, H = 120, PAD = 8, FMAX = 4000, DB = 50;
  const fx = (f) => PAD + f / FMAX * (W - PAD * 2);
  const TOP = 18;
  const fy = (db) => TOP + Math.min(1, Math.max(0, -db / DB)) * (H - TOP - PAD - 14);

  function svgWrap(inner, label) {
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
      <line x1="${PAD}" y1="${H - PAD - 14}" x2="${W - PAD}" y2="${H - PAD - 14}" class="ax"/>
      ${[1000, 2000, 3000].map((f) => `<text x="${fx(f)}" y="${H - 4}" class="tk">${f / 1000}k</text>`).join('')}
      <text x="${W - PAD}" y="${H - 4}" class="tk end">Hz</text>
      ${inner}</svg>`;
  }

  function drawFigures() {
    const t = target(VOWELS[0], 'male');
    const p = { f0: 140, f1: t.f1, f2: t.f2, f3: t.f3, f3on: true, f4: 3500, f5: 4500 };
    const flat = { f0: 140, f1: 20000, f2: 20000, f3: 20000, f3on: false, f4: 20000, f5: 20000 };

    // 1. 音源：倍音（フィルタなし）
    let ref = harmonicDb(1, flat), bars = '';
    for (let k = 1; k * p.f0 <= FMAX; k++) {
      const x = fx(k * p.f0);
      bars += `<line x1="${x}" y1="${fy(-DB)}" x2="${x}" y2="${fy(harmonicDb(k, flat) - ref)}" class="hm"/>`;
    }
    $('#fig-source').innerHTML = svgWrap(bars + `<text x="${fx(p.f0) + 4}" y="${TOP - 6}" class="lb start">← F0</text>`, '倍音が並んだ音源のスペクトル');

    // 2. フィルタ：包絡（音源の傾きを除いた声道の特性）
    let fref = -Infinity;
    const fd = (f) => envelopeDb(f, p) - envelopeDb(f, flat);
    for (let f = 50; f <= FMAX; f += 20) fref = Math.max(fref, fd(f));
    let path = '';
    for (let f = 50; f <= FMAX; f += 20) path += (path ? 'L' : 'M') + fx(f).toFixed(1) + ' ' + fy(fd(f) - fref).toFixed(1);
    const peaks = [['F1', p.f1, -9], ['F2', p.f2, 9], ['F3', p.f3, 0]].map(([l, f, dx]) => `<text x="${fx(f) + dx}" y="${fy(fd(f) - fref) - 6}" class="lb">${l}</text>`).join('');
    $('#fig-filter').innerHTML = svgWrap(`<path d="${path}" class="env"/>` + peaks, 'フォルマントの山をもつ声道フィルタの特性');

    // 3. 出力：倍音×フィルタ
    let oref = -Infinity; bars = '';
    for (let k = 1; k * p.f0 <= FMAX; k++) oref = Math.max(oref, harmonicDb(k, p));
    for (let k = 1; k * p.f0 <= FMAX; k++) {
      const x = fx(k * p.f0);
      bars += `<line x1="${x}" y1="${fy(-DB)}" x2="${x}" y2="${fy(harmonicDb(k, p) - oref)}" class="hm out"/>`;
    }
    $('#fig-output').innerHTML = svgWrap(bars + `<text x="${W - PAD}" y="${PAD + 6}" class="lb end vowel">「あ」</text>`, 'フィルタを通ったあとの「あ」のスペクトル');
  }

  function init() {
    document.body.dataset.mode = window.App.state.mode;
    buildListen();
    drawFigures();
    window.addEventListener('hashchange', route);
    route();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
