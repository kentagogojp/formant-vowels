// ゲームモード「聞き取りクイズ」
// 合成した音を聞いて、何の母音に聞こえたかを答える。全10問
(function () {
  'use strict';
  const { VOWELS, VOICES, target, judge } = window.VowelData;
  const $ = (s) => document.querySelector(s);

  const COUNT = 10;
  const PLAY_MS = 1100;

  const LEVELS = {
    clear: { label: 'はっきり', desc: '母音の中心に近い、聞き取りやすい音' },
    voices: { label: 'いろんな声', desc: '男性・女性・子ども、声の高さもばらばら' },
    border: { label: 'まぎらわしい', desc: '2つの母音の境目あたりの音。2番目に近い母音でも半分の点' },
  };

  // 境目の問題に使う、となり合う母音の組
  const PAIRS = [['a', 'o'], ['a', 'e'], ['i', 'e'], ['u', 'o'], ['u', 'i'], ['e', 'u'], ['o', 'e']];

  const q = {
    level: 'clear', n: 0, score: 0, correct: 0, answered: false,
    cur: null, saved: null, playTimer: null,
  };

  function bestKey(l) { return 'boin-kobo-quiz-best-' + l; }
  function loadBest(l) { try { return +localStorage.getItem(bestKey(l)) || 0; } catch (e) { return 0; } }
  function saveBest(l, v) { try { localStorage.setItem(bestKey(l), String(v)); } catch (e) { /* 保存できなくても続ける */ } }

  function show(part) {
    $('#q-ready').hidden = part !== 'ready';
    $('#q-play').hidden = part !== 'play';
    $('#q-result').hidden = part !== 'result';
  }

  // 答えるまで、母音図・スペクトル・スライダーを隠す
  function setAsking(on) {
    const App = window.App;
    Object.assign(App.view, on
      ? { planeHidden: true, spectrumHidden: true, regions: true, highlight: null, hiddenMsg: ['耳だけで答えよう', '答えると、この音の位置が表示されます'], pointColored: false }
      : { planeHidden: false, spectrumHidden: false, regions: true, pointColored: true });
    document.body.classList.toggle('q-asking', on);
    App.markDirty();
  }

  function enter() {
    const s = window.App.state;
    q.saved = { voice: s.voice, f0: s.f0, f1: s.f1, f2: s.f2, f3: s.f3 };
    window.App.togglePlay(false);
    show('ready'); renderReady();
    setAsking(false);
  }

  function leave() {
    clearTimeout(q.playTimer);
    document.body.classList.remove('q-asking');
    if (q.saved) window.App.setValues(q.saved);
  }

  function renderReady() {
    document.querySelectorAll('#q-levels .lv-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.level === q.level)));
    const best = loadBest(q.level);
    $('#q-best').textContent = best ? `${LEVELS[q.level].label}の自己ベスト ${best}点` : `${LEVELS[q.level].label}はまだ記録なし`;
  }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function gauss() { return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()); }

  // 近い順に並べた母音
  function ranking(f1, f2, voice) {
    return VOWELS.map((v) => {
      const t = target(v, voice);
      const d = Math.hypot(Math.log(f1 / t.f1) / 0.22, Math.log(f2 / t.f2) / 0.18);
      return { vowel: v, closeness: Math.exp(-d * d / 2) };
    }).sort((a, b) => b.closeness - a.closeness);
  }

  function makeQuestion() {
    let voice = window.App.state.voice, f0 = VOICES[voice].f0;
    if (q.level === 'voices') {
      const ids = Object.keys(VOICES);
      voice = ids[Math.floor(Math.random() * ids.length)];
      f0 = Math.round(VOICES[voice].f0 * rand(0.85, 1.2));
    }
    let f1, f2, f3, rank;
    for (let i = 0; i < 50; i++) {
      if (q.level === 'border') {
        const [a, b] = PAIRS[Math.floor(Math.random() * PAIRS.length)];
        const ta = target(VOWELS.find((v) => v.id === a), voice), tb = target(VOWELS.find((v) => v.id === b), voice);
        const t = rand(0.35, 0.65);
        f1 = Math.round(Math.exp(Math.log(ta.f1) * (1 - t) + Math.log(tb.f1) * t));
        f2 = Math.round(Math.exp(Math.log(ta.f2) * (1 - t) + Math.log(tb.f2) * t));
        f3 = Math.round((ta.f3 + tb.f3) / 2);
        rank = ranking(f1, f2, voice);
        if (rank[1].closeness > 0.15) break;
      } else {
        const v = VOWELS[Math.floor(Math.random() * VOWELS.length)], t = target(v, voice);
        f1 = Math.round(t.f1 * Math.exp(gauss() * 0.22 * 0.45));
        f2 = Math.round(t.f2 * Math.exp(gauss() * 0.18 * 0.45));
        f3 = t.f3;
        rank = ranking(f1, f2, voice);
        if (rank[0].vowel.id === v.id && rank[0].closeness >= 0.6 && (!q.cur || q.cur.rank[0].vowel.id !== v.id || i > 10)) break;
      }
    }
    return { voice, f0, f1, f2, f3, rank };
  }

  function start() {
    Object.assign(q, { n: 0, score: 0, correct: 0, cur: null });
    show('play');
    next();
  }

  function next() {
    q.n += 1;
    if (q.n > COUNT) { finish(); return; }
    q.answered = false;
    q.cur = makeQuestion();
    const c = q.cur;
    window.App.setValues({ voice: c.voice, f0: c.f0, f1: c.f1, f2: c.f2, f3: c.f3, selected: null });
    setAsking(true);
    $('#q-num').textContent = q.n;
    $('#q-score').textContent = q.score;
    $('#q-voice').textContent = q.level === 'voices' ? `${VOICES[c.voice].label}の声` : '';
    $('#q-msg').textContent = 'どの母音に聞こえる？';
    $('#q-msg').dataset.kind = '';
    $('#q-next').hidden = true;
    document.querySelectorAll('.q-ans').forEach((b) => { b.disabled = false; b.dataset.state = ''; });
    play();
  }

  async function play() {
    const App = window.App;
    clearTimeout(q.playTimer);
    await App.synth.startFresh(App.params());
    q.playTimer = setTimeout(() => { if (!App.state.playing && !App.state.held) App.synth.stop(); }, PLAY_MS);
    const btn = $('#q-replay');
    btn.classList.remove('ring'); void btn.offsetWidth; btn.classList.add('ring');
  }

  function answer(id) {
    if (q.answered || !q.cur) return;
    q.answered = true;
    const r = q.cur.rank, top = r[0], second = r[1];
    const v = VOWELS.find((x) => x.id === id);
    let pts = 0, kind = 'ng', text;
    const pct = (x) => Math.round(x.closeness * 100);
    if (id === top.vowel.id) {
      pts = 10; kind = 'ok'; q.correct += 1;
      text = `正解！ 計算上も「${top.vowel.kana}」にいちばん近い音でした（近さ ${pct(top)}%）`;
    } else if (q.level === 'border' && id === second.vowel.id) {
      pts = 5; kind = 'half';
      text = `おしい！ 「${v.kana}」は2番目に近い母音です。いちばん近いのは「${top.vowel.kana}」（${pct(top)}%、「${v.kana}」は${pct(second)}%）`;
    } else {
      text = `ざんねん。この音は「${top.vowel.kana}」にいちばん近い音でした（近さ ${pct(top)}%）`;
    }
    q.score += pts;
    $('#q-score').textContent = q.score;
    const m = $('#q-msg'); m.textContent = text; m.dataset.kind = kind;
    document.querySelectorAll('.q-ans').forEach((b) => {
      b.disabled = true;
      b.dataset.state = b.dataset.id === top.vowel.id ? 'answer' : b.dataset.id === id ? 'chosen' : '';
    });
    window.App.view.highlight = top.vowel.id;
    setAsking(false);
    $('#q-next').hidden = false;
    $('#q-next').textContent = q.n >= COUNT ? '結果を見る' : '次の問題';
    $('#q-next').focus();
  }

  function finish() {
    const App = window.App;
    const best = loadBest(q.level), isBest = q.score > best;
    if (isBest) saveBest(q.level, q.score);
    $('#qr-score').textContent = q.score;
    $('#qr-detail').textContent = `${LEVELS[q.level].label}　${COUNT}問中 ${q.correct}問正解`;
    $('#qr-best').textContent = isBest ? '自己ベスト更新！' : `自己ベスト ${best}点`;
    $('#qr-best').dataset.new = String(isBest);
    setAsking(false);
    App.view.highlight = undefined;
    show('result');
    $('#qr-again').focus();
  }

  function onKey(k, e) {
    if (!$('#q-play').hidden) {
      const v = VOWELS.find((x) => x.id === k);
      if (v && !q.answered) { answer(v.id); return true; }
      if (k === 'r') { play(); return true; }
      if (k === 'enter' && q.answered) { next(); return true; }
      if (k === ' ') { play(); return true; }
    } else if (k === 'enter' && !$('#q-ready').hidden) { start(); return true; }
    return false;
  }

  function init() {
    const lv = $('#q-levels');
    for (const id in LEVELS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'lv-btn'; b.dataset.level = id; b.setAttribute('role', 'radio');
      b.innerHTML = `<b>${LEVELS[id].label}</b><small>${LEVELS[id].desc}</small>`;
      b.addEventListener('click', () => { q.level = id; renderReady(); });
      lv.appendChild(b);
    }
    const box = $('#q-answers');
    for (const v of VOWELS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'q-ans'; b.dataset.id = v.id;
      b.style.setProperty('--vc', `var(--v-${v.id})`);
      b.innerHTML = `<span class="vk">${v.kana}</span><span class="vr">${v.id.toUpperCase()}</span>`;
      b.addEventListener('click', () => answer(v.id));
      box.appendChild(b);
    }
    $('#q-start').addEventListener('click', start);
    $('#q-replay').addEventListener('click', play);
    $('#q-next').addEventListener('click', next);
    $('#q-quit').addEventListener('click', () => { clearTimeout(q.playTimer); window.App.synth.stop(); setAsking(false); window.App.view.highlight = undefined; show('ready'); renderReady(); });
    $('#qr-again').addEventListener('click', start);
    $('#qr-levels').addEventListener('click', () => { show('ready'); renderReady(); });
  }

  window.Quiz = { enter, leave, onKey };
  document.addEventListener('DOMContentLoaded', init);
})();
