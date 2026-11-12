// 画面の組み立てと状態管理
(function () {
  'use strict';
  const { VOWELS, VOICES, RANGE, target, judge } = window.VowelData;
  const synth = new window.Formant.Synth();
  const $ = (s) => document.querySelector(s);

  const state = {
    voice: 'male',
    f0: 120, f1: 800, f2: 1200, f3: 2500, f3on: false,
    playing: false, held: false,
    selected: 'a',
    mode: 'free',
  };
  // 描画の切り替え（ゲームの難易度で変える）
  const view = { regions: true, planeHidden: false, judge: true, ghost: true };

  const SLIDERS = [
    { key: 'f0', name: 'F0', title: '声の高さ', hint: '声帯が1秒に震える回数' },
    { key: 'f1', name: 'F1', title: '第1フォルマント', hint: '口の開き（大きいほど開く）' },
    { key: 'f2', name: 'F2', title: '第2フォルマント', hint: '舌の前後（大きいほど前）' },
    { key: 'f3', name: 'F3', title: '第3フォルマント', hint: '声の明るさ・個人差', optional: true },
  ];

  function params() {
    const k = VOICES[state.voice].k;
    return { f0: state.f0, f1: state.f1, f2: state.f2, f3: state.f3, f3on: state.f3on, f4: Math.round(3500 * k), f5: Math.round(4500 * k) };
  }

  // ---------- 操作パネル ----------
  const rows = {};
  function buildSliders() {
    const box = $('#sliders');
    for (const s of SLIDERS) {
      const [lo, hi] = RANGE[s.key];
      const row = document.createElement('div');
      row.className = 'slider-row'; row.dataset.key = s.key;
      row.innerHTML = `
        <label class="s-label" for="rng-${s.key}"><b>${s.name}</b><span>${s.title}</span><small>${s.hint}</small></label>
        <input id="rng-${s.key}" type="range" min="${Math.log(lo)}" max="${Math.log(hi)}" step="0.001" aria-label="${s.name}">
        <span class="s-num"><input id="num-${s.key}" type="number" min="${lo}" max="${hi}" step="1" inputmode="numeric" aria-label="${s.name}（Hz）"><i>Hz</i></span>
        ${s.optional ? '<button type="button" class="s-remove" id="rm-f3" aria-label="F3を外す">外す</button>' : ''}`;
      box.appendChild(row);
      const rng = row.querySelector('input[type=range]'), num = row.querySelector('input[type=number]');
      rng.addEventListener('input', () => { setValue(s.key, Math.round(Math.exp(+rng.value)), 'range'); });
      num.addEventListener('change', () => {
        const v = Math.min(hi, Math.max(lo, Math.round(+num.value || lo)));
        setValue(s.key, v);
      });
      rows[s.key] = { row, rng, num };
    }
    const add = document.createElement('button');
    add.type = 'button'; add.id = 'add-f3'; add.className = 'add-f3';
    add.innerHTML = '<span aria-hidden="true">＋</span> F3（第3フォルマント）を追加';
    box.appendChild(add);
    add.addEventListener('click', () => { state.f3on = true; state.f3 = selectedTarget().f3; refresh(); });
    $('#rm-f3').addEventListener('click', () => { state.f3on = false; refresh(); });
  }

  function selectedTarget() {
    const v = VOWELS.find((x) => x.id === state.selected) || VOWELS[0];
    return target(v, state.voice);
  }

  function setValue(key, v, from) {
    state[key] = v;
    refresh(from === 'range' ? key : null);
  }

  // ---------- 状態を画面と音に反映 ----------
  let dirty = true;
  function refresh(skipRange) {
    for (const s of SLIDERS) {
      const r = rows[s.key];
      if (skipRange !== s.key) r.rng.value = Math.log(state[s.key]);
      if (document.activeElement !== r.num) r.num.value = state[s.key];
    }
    rows.f3.row.hidden = !state.f3on;
    $('#add-f3').hidden = state.f3on;
    document.querySelectorAll('.vowel-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === state.selected)));
    document.querySelectorAll('.voice-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === state.voice)));
    synth.set(params());
    updateJudge();
    dirty = true;
  }

  function updateJudge() {
    const j = judge(state.f1, state.f2, state.voice);
    state.judge = j;
    const el = $('#judge');
    el.style.setProperty('--jc', `var(--v-${j.vowel.id})`);
    $('#judge-kana').textContent = j.vowel.kana;
    const pct = Math.round(j.closeness * 100);
    $('#judge-meter').style.setProperty('--p', pct + '%');
    $('#judge-text').textContent = pct >= 60 ? `「${j.vowel.kana}」に聞こえそう` : pct >= 25 ? `「${j.vowel.kana}」っぽいかも` : 'どの母音ともいえない音';
    $('#judge-pct').textContent = pct + '%';
  }

  // ---------- なめらかに移動 ----------
  let tween = null;
  function glideTo(to, ms = 220) {
    const from = {}; for (const k in to) from[k] = state[k];
    const t0 = performance.now();
    tween = (now) => {
      const u = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - u, 3);
      for (const k in to) state[k] = Math.round(from[k] + (to[k] - from[k]) * e);
      refresh();
      if (u >= 1) tween = null;
    };
  }

  function selectVowel(id) {
    const v = VOWELS.find((x) => x.id === id);
    const t = target(v, state.voice);
    state.selected = id;
    if (state.playing) {
      // 鳴らし続けている間は、なめらかに移っていく
      glideTo({ f1: t.f1, f2: t.f2, f3: t.f3 });
    } else {
      // 止まっているときは、その母音からいきなり鳴らす
      tween = null;
      Object.assign(state, { f1: t.f1, f2: t.f2, f3: t.f3 });
      refresh();
      pulse();
    }
  }

  // 停止中にボタンを押したら短く鳴らす
  let pulseTimer = null;
  async function pulse() {
    clearTimeout(pulseTimer);
    await synth.startFresh(params());
    pulseTimer = setTimeout(() => { if (!state.playing && !state.held) synth.stop(); }, 650);
  }

  async function togglePlay(force) {
    const on = typeof force === 'boolean' ? force : !state.playing;
    state.playing = on;
    const b = $('#play');
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.play-label').textContent = on ? '止める' : '鳴らす';
    if (on) { clearTimeout(pulseTimer); await synth.startFresh(params()); } else if (!state.held) synth.stop();
  }

  // ---------- 組み立て ----------
  function buildVowels() {
    const box = $('#vowels');
    for (const v of VOWELS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'vowel-btn'; b.dataset.id = v.id;
      b.style.setProperty('--vc', `var(--v-${v.id})`);
      b.innerHTML = `<span class="vk">${v.kana}</span><span class="vr">${v.id.toUpperCase()}</span>`;
      b.title = `「${v.kana}」の代表値（キーボード: ${v.id.toUpperCase()}）`;
      b.addEventListener('click', () => selectVowel(v.id));
      box.appendChild(b);
    }
  }

  function buildVoices() {
    const box = $('#voices');
    for (const id in VOICES) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'voice-btn'; b.dataset.id = id; b.setAttribute('role', 'radio');
      b.innerHTML = `${VOICES[id].label}<small>${VOICES[id].f0}Hz</small>`;
      b.addEventListener('click', () => {
        const r = VOICES[id].k / VOICES[state.voice].k;
        state.voice = id;
        const to = { f0: VOICES[id].f0, f1: Math.round(state.f1 * r), f2: Math.round(state.f2 * r), f3: Math.round(state.f3 * r) };
        glideTo(to, 260);
      });
      box.appendChild(b);
    }
  }

  function init() {
    buildVowels(); buildVoices(); buildSliders();

    const hold = { onDragStart: () => { state.held = true; if (!state.playing) { clearTimeout(pulseTimer); synth.startFresh(params()); } }, onDragEnd: () => { state.held = false; if (!state.playing) synth.stop(); } };
    const plane = new window.Plots.PlaneView($('#plane'), Object.assign({
      canDrag: () => !view.planeHidden,
      onMove: ({ f1, f2 }) => { state.f1 = f1; state.f2 = f2; refresh(); },
    }, hold));
    const spec = new window.Plots.SpectrumView($('#spectrum'), Object.assign({
      onMove: (key, f) => { const [lo, hi] = RANGE[key]; state[key] = Math.min(hi, Math.max(lo, f)); refresh(); },
    }, hold));
    plane.onResize = spec.onResize = () => { dirty = true; };

    $('#play').addEventListener('click', () => togglePlay());

    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (state.mode !== 'free') {
        if (k === 'enter' && e.target.matches('button')) return;
        if (window.Game && window.Game.onKey(k, e)) { e.preventDefault(); return; }
        if (k === ' ' && !e.target.matches('button')) { togglePlay(); e.preventDefault(); }
        return;
      }
      if (VOWELS.some((v) => v.id === k)) { selectVowel(k); e.preventDefault(); }
      else if (k === ' ' && !e.target.matches('button')) { togglePlay(); e.preventDefault(); }
    });

    // テーマ変更時に再描画
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { dirty = true; });
    new MutationObserver(() => { dirty = true; }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const t = target(VOWELS[0], state.voice);
    Object.assign(state, { f1: t.f1, f2: t.f2, f3: t.f3 });
    refresh();

    const loop = (now) => {
      if (tween) tween(now);
      if (dirty || state.playing || state.held || plane.trail.length) {
        const free = state.mode === 'free';
        const v = {
          ...state, params: params(), regions: view.regions, planeHidden: view.planeHidden, spectrumHidden: view.spectrumHidden, hiddenMsg: view.hiddenMsg, pointColored: view.pointColored,
          highlight: view.highlight !== undefined && !free ? view.highlight : !free ? null : state.selected || (state.judge && state.judge.closeness > 0.6 ? state.judge.vowel.id : null),
          ghost: free && state.selected ? selectedTarget() : null, ghostId: state.selected,
        };
        plane.draw(v); spec.draw(v);
        if (!state.playing && !state.held && !dirty && plane.trail.length) plane.trail.shift();
        dirty = false;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // 値をまとめて置き換える（ゲームのお題の開始位置など）。鳴っていればその値から鳴り直す
  function setValues(vals) {
    tween = null;
    Object.assign(state, vals);
    refresh();
    if (state.playing) synth.startFresh(params());
  }
  function markDirty() { dirty = true; }

  window.App = { state, view, refresh, selectVowel, togglePlay, synth, params, pulse, setValues, markDirty };
  document.addEventListener('DOMContentLoaded', init);
})();
