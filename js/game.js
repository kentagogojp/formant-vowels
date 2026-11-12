// ゲームモード「母音メイカー」
// お題の母音を、F1・F2 を動かして作る。制限時間内に何問作れるかを競う
(function () {
  'use strict';
  const { VOWELS, VOICES, target, judge } = window.VowelData;
  const $ = (s) => document.querySelector(s);

  const TIME = 60;          // 制限時間（秒）
  const MISS_PENALTY = 3;   // まちがえたときに減る時間（秒）
  const PASS = 0.5;         // 正解とみなす近さ

  const LEVELS = {
    easy: { label: 'かんたん', desc: '母音図に5つの領域が見える（どれが何の母音かは自分で）', regions: 'gray', planeHidden: false },
    normal: { label: 'ふつう', desc: '領域は見えない。目盛りと耳がたより', regions: false, planeHidden: false },
    hard: { label: 'むずかしい', desc: '母音図も見えない。スペクトルと数値と耳で', regions: false, planeHidden: true },
  };

  const g = {
    level: 'easy', running: false, locked: false,
    endAt: 0, score: 0, correct: 0, streak: 0, best: 0,
    prompt: null, hinted: false, timer: null,
  };

  function bestKey(level) { return 'boin-kobo-maker-best-' + level; }
  function loadBest(level) { try { return +localStorage.getItem(bestKey(level)) || 0; } catch (e) { return 0; } }
  function saveBest(level, v) { try { localStorage.setItem(bestKey(level), String(v)); } catch (e) { /* 保存できなくても続ける */ } }

  // ---------- 画面の切り替え ----------
  function show(part) {
    $('#g-ready').hidden = part !== 'ready';
    $('#g-play').hidden = part !== 'play';
    $('#g-result').hidden = part !== 'result';
  }

  function setMode(mode) {
    const App = window.App;
    if (mode === App.state.mode) return;
    stopGame();
    if (App.state.mode === 'quiz' && window.Quiz) window.Quiz.leave();
    App.state.mode = mode;
    document.body.dataset.mode = mode;
    document.querySelectorAll('.mode-btn').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    Object.assign(App.view, { regions: true, planeHidden: false, spectrumHidden: false, highlight: undefined, hiddenMsg: undefined, pointColored: false });
    document.body.classList.remove('q-asking');
    if (mode === 'maker') {
      show('ready'); renderReady();
    } else if (mode === 'quiz' && window.Quiz) {
      window.Quiz.enter();
    }
    App.refresh(); App.markDirty();
  }

  function renderReady() {
    document.querySelectorAll('#g-levels .lv-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.level === g.level)));
    const best = loadBest(g.level);
    $('#g-best').textContent = best ? `${LEVELS[g.level].label}の自己ベスト ${best}点` : `${LEVELS[g.level].label}はまだ記録なし`;
    applyLevelView();
  }

  function applyLevelView() {
    const L = LEVELS[g.level];
    Object.assign(window.App.view, { regions: L.regions, planeHidden: L.planeHidden });
    window.App.markDirty();
  }

  // ---------- ゲームの進行 ----------
  function startGame() {
    const App = window.App;
    Object.assign(g, { running: true, locked: false, score: 0, correct: 0, streak: 0, prompt: null, best: loadBest(g.level) });
    g.endAt = performance.now() + TIME * 1000;
    applyLevelView();
    show('play');
    nextPrompt();
    App.togglePlay(true);
    clearInterval(g.timer);
    g.timer = setInterval(tick, 100);
    tick();
    $('#g-judge').focus();
  }

  function stopGame() {
    g.running = false;
    clearInterval(g.timer);
  }

  function tick() {
    if (!g.running) return;
    const left = Math.max(0, (g.endAt - performance.now()) / 1000);
    $('#g-time').textContent = left.toFixed(1);
    $('#g-timebar').style.setProperty('--p', (left / TIME * 100) + '%');
    $('#g-play').classList.toggle('hurry', left < 10);
    if (left <= 0) finish();
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  function nextPrompt() {
    const App = window.App, voice = App.state.voice, k = VOICES[voice].k;
    const choices = VOWELS.filter((v) => !g.prompt || v.id !== g.prompt.id);
    g.prompt = choices[Math.floor(Math.random() * choices.length)];
    g.hinted = false;
    // 開始位置は口の中ほど（あいまい母音のあたり）。最初からお題に近すぎない位置を選ぶ
    let f1, f2;
    for (let i = 0; i < 20; i++) {
      f1 = Math.round(500 * k * rand(0.82, 1.18));
      f2 = Math.round(1500 * k * rand(0.82, 1.18));
      const j = judge(f1, f2, voice);
      if (!(j.vowel.id === g.prompt.id && j.closeness >= 0.3)) break;
    }
    App.setValues({ f1, f2, f3: target(g.prompt, voice).f3, selected: null });
    const el = $('#g-kana');
    el.textContent = g.prompt.kana;
    $('#g-play').style.setProperty('--gc', `var(--v-${g.prompt.id})`);
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    renderStats();
  }

  function renderStats() {
    $('#g-score').textContent = g.score;
    $('#g-correct').textContent = g.correct;
    $('#g-streak').textContent = g.streak;
  }

  function message(text, kind) {
    const m = $('#g-msg');
    m.textContent = text; m.dataset.kind = kind || '';
    m.classList.remove('show'); void m.offsetWidth; m.classList.add('show');
  }

  function check() {
    if (!g.running || g.locked) return;
    const App = window.App, s = App.state;
    const j = judge(s.f1, s.f2, s.voice);
    // お題の母音との近さ
    const t = target(g.prompt, s.voice);
    const d = Math.hypot(Math.log(s.f1 / t.f1) / 0.22, Math.log(s.f2 / t.f2) / 0.18);
    const closeness = Math.exp(-d * d / 2);
    if (!App.state.playing) App.pulse();

    if (j.vowel.id === g.prompt.id && closeness >= PASS) {
      g.streak += 1; g.correct += 1;
      let pts = Math.round(closeness * 100);
      if (g.hinted) pts = Math.round(pts / 2);
      const bonus = Math.min(50, (g.streak - 1) * 10);
      g.score += pts + bonus;
      message(`正解！「${g.prompt.kana}」 +${pts}${bonus ? `　連続ボーナス +${bonus}` : ''}`, 'ok');
      flash('ok');
      renderStats();
      g.locked = true;
      setTimeout(() => { g.locked = false; if (g.running) nextPrompt(); }, 750);
    } else {
      g.streak = 0;
      g.endAt -= MISS_PENALTY * 1000;
      const heard = j.closeness >= 0.25 ? `いまは「${j.vowel.kana}」に聞こえます` : 'まだどの母音ともいえない音です';
      message(`${heard}（−${MISS_PENALTY}秒）`, 'ng');
      flash('ng');
      renderStats();
    }
  }

  function flash(kind) {
    const el = $('#g-play');
    el.classList.remove('flash-ok', 'flash-ng'); void el.offsetWidth;
    el.classList.add('flash-' + kind);
  }

  // お手本を短く聞かせて、プレイヤーの音に戻す
  let hintTimer = null;
  async function hint() {
    if (!g.running || g.locked) return;
    const App = window.App, s = App.state;
    const t = target(g.prompt, s.voice);
    g.hinted = true;
    message('お手本を聞きました（この問題の得点は半分）', '');
    const mine = App.params();
    const model = Object.assign({}, mine, { f1: t.f1, f2: t.f2, f3: t.f3 });
    clearTimeout(hintTimer);
    await App.synth.startFresh(model);
    hintTimer = setTimeout(() => {
      if (App.state.playing) App.synth.startFresh(App.params()); else App.synth.stop();
    }, 700);
  }

  function skip() {
    if (!g.running || g.locked) return;
    g.streak = 0;
    message(`「${g.prompt.kana}」をスキップしました`, '');
    nextPrompt();
  }

  function finish() {
    stopGame();
    const App = window.App;
    App.togglePlay(false);
    const isBest = g.score > g.best;
    if (isBest) saveBest(g.level, g.score);
    $('#r-score').textContent = g.score;
    $('#r-detail').textContent = `${LEVELS[g.level].label}　正解 ${g.correct}問`;
    $('#r-best').textContent = isBest ? '自己ベスト更新！' : `自己ベスト ${g.best}点`;
    $('#r-best').dataset.new = String(isBest);
    show('result');
    $('#r-again').focus();
  }

  // キーボード（ゲーム中）
  function onKey(k, e) {
    const App = window.App;
    if (App.state.mode === 'quiz') return window.Quiz ? window.Quiz.onKey(k, e) : false;
    if (App.state.mode !== 'maker') return false;
    if (g.running) {
      if (k === 'enter') { check(); return true; }
      if (k === 'h') { hint(); return true; }
      if (k === 's') { skip(); return true; }
    } else if (k === 'enter' && !$('#g-ready').hidden) { startGame(); return true; }
    return false;
  }

  function init() {
    document.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', () => { if (!b.disabled) location.hash = b.dataset.mode; }));
    const lv = $('#g-levels');
    for (const id in LEVELS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'lv-btn'; b.dataset.level = id; b.setAttribute('role', 'radio');
      b.innerHTML = `<b>${LEVELS[id].label}</b><small>${LEVELS[id].desc}</small>`;
      b.addEventListener('click', () => { g.level = id; renderReady(); });
      lv.appendChild(b);
    }
    $('#g-start').addEventListener('click', startGame);
    $('#g-judge').addEventListener('click', check);
    $('#g-hint').addEventListener('click', hint);
    $('#g-skip').addEventListener('click', skip);
    $('#g-quit').addEventListener('click', () => { stopGame(); window.App.togglePlay(false); show('ready'); renderReady(); });
    $('#r-again').addEventListener('click', startGame);
    $('#r-levels').addEventListener('click', () => { show('ready'); renderReady(); });
  }

  window.Game = { onKey, setMode };
  document.addEventListener('DOMContentLoaded', init);
})();
