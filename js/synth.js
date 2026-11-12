// 音声合成エンジン（ソース・フィルタ方式）
// 声帯音源（声門パルス）を、フォルマント共振器を直列につないだフィルタに通して母音を作る。
(function () {
  'use strict';

  // ---- 合成の中身。1サンプルずつ計算する（AudioWorklet と予備の ScriptProcessor の両方で使う） ----
  const TWO_PI = Math.PI * 2;
  const NF = 5;

class VoiceCore {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.t = { f0: 120, f: [800, 1200, 2500, 3500, 4500], bw: [80, 100, 140, 200, 260], on: [1, 1, 0, 1, 1], oq: 0.6, vib: 1 };
    this.c = { f0: 120, f: [800, 1200, 2500, 3500, 4500] };
    this.phase = 0; this.vphase = 0;
    this.y1 = new Float64Array(NF); this.y2 = new Float64Array(NF);
    this.A = new Float64Array(NF); this.B = new Float64Array(NF); this.C = new Float64Array(NF);
    this.ms = 1e-3;
    this.coef();
  }
  set(d) { for (const k in d) this.t[k] = d[k]; }
  coef() {
    const sampleRate = this.sr;
    const T = 1 / sampleRate;
    for (let i = 0; i < NF; i++) {
      const F = Math.min(this.c.f[i], sampleRate * 0.45), B = this.t.bw[i];
      const r = Math.exp(-Math.PI * B * T);
      this.C[i] = -r * r;
      this.B[i] = 2 * r * Math.cos(TWO_PI * F * T);
      this.A[i] = 1 - this.B[i] - this.C[i];
    }
  }
  render(out) {
    const sampleRate = this.sr;
    const t = this.t, c = this.c;
    const a = 1 - Math.exp(-16 / (0.02 * sampleRate));
    const vstep = TWO_PI * 5.2 / sampleRate;
    for (let s = 0; s < out.length; s++) {
      if ((s & 15) === 0) {
        c.f0 += (t.f0 - c.f0) * a;
        for (let i = 0; i < NF; i++) c.f[i] += (t.f[i] - c.f[i]) * a;
        this.coef();
      }
      this.vphase += vstep; if (this.vphase > TWO_PI) this.vphase -= TWO_PI;
      const f = c.f0 * (1 + 0.006 * t.vib * Math.sin(this.vphase));
      this.phase += f / sampleRate; if (this.phase >= 1) this.phase -= 1;
      // 声門体積流の微分（KLGLOTT88型）。開いている間だけ流れ、閉じる瞬間に鋭く落ちる
      let x = 0;
      if (this.phase < t.oq) { const u = this.phase / t.oq; x = 2 * u - 3 * u * u; }
      x += (Math.random() - 0.5) * 0.004;
      for (let i = 0; i < NF; i++) {
        if (!t.on[i]) continue;
        const y = this.A[i] * x + this.B[i] * this.y1[i] + this.C[i] * this.y2[i];
        this.y2[i] = this.y1[i]; this.y1[i] = y; x = y;
      }
      // 自動音量調整（母音ごとの音量差をならす）
      this.ms += (x * x - this.ms) * 0.0003;
      const g = Math.min(60, 0.16 / Math.sqrt(this.ms + 1e-9));
      out[s] = Math.tanh(x * g);
    }
  }
}

  const CORE_SRC = 'const TWO_PI = Math.PI * 2; const NF = 5;\n' + VoiceCore.toString();
  const WORKLET_SRC = CORE_SRC + `
class FormantVoice extends AudioWorkletProcessor {
  constructor() { super(); this.core = new VoiceCore(sampleRate); this.port.onmessage = (e) => this.core.set(e.data); }
  process(inputs, outputs) { const out = outputs[0] && outputs[0][0]; if (out) this.core.render(out); return true; }
}
registerProcessor('formant-voice', FormantVoice);
`;

  const BW = [80, 100, 140, 200, 260];
  const OQ = 0.6;

  class Synth {
    constructor() { this.ctx = null; this.node = null; this.master = null; this.ready = null; this.playing = false; }

    init() {
      if (this.ready) return this.ready;
      this.ready = (async () => {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        try {
          // 通常は AudioWorklet（別スレッド）で合成する
          const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
          await this.ctx.audioWorklet.addModule(url);
          this.node = new AudioWorkletNode(this.ctx, 'formant-voice', { numberOfInputs: 0, outputChannelCount: [1] });
          this.post = (m) => this.node.port.postMessage(m);
        } catch (err) {
          // ファイルを直接開いた場合など AudioWorklet が使えないときの予備（ScriptProcessor）
          const core = new VoiceCore(this.ctx.sampleRate);
          this.node = this.ctx.createScriptProcessor(1024, 0, 1);
          this.node.onaudioprocess = (e) => core.render(e.outputBuffer.getChannelData(0));
          this.post = (m) => core.set(m);
          this.fallback = true;
        }
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        this.node.connect(this.master).connect(this.ctx.destination);
        if (this.pending) this.post(this.pending);
      })();
      return this.ready;
    }

    // params: { f0, f1, f2, f3, f3on, f4, f5 }
    set(p) {
      const msg = { f0: p.f0, f: [p.f1, p.f2, p.f3, p.f4, p.f5], on: [1, 1, p.f3on ? 1 : 0, 1, 1], bw: BW, oq: OQ };
      this.pending = msg;
      if (this.post) this.post(msg);
    }

    async start() {
      await this.init();
      if (this.ctx.state !== 'running') await this.ctx.resume();
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(0.7, now, 0.02);
      this.playing = true;
    }

    stop() {
      this.playing = false;
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(0, now, 0.03);
    }
  }

  // ---- 表示用の計算（スペクトルを数式から求める） ----

  // 声門パルス1周期のフーリエ係数 |c_k|（k=1..K）。形は F0 に依存しないので一度だけ計算する
  const SRC_MAG = (() => {
    const N = 1024, K = 120, mags = new Float64Array(K + 1);
    const g = new Float64Array(N);
    for (let n = 0; n < N; n++) { const ph = n / N; if (ph < OQ) { const u = ph / OQ; g[n] = 2 * u - 3 * u * u; } }
    for (let k = 1; k <= K; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) { const w = 2 * Math.PI * k * n / N; re += g[n] * Math.cos(w); im -= g[n] * Math.sin(w); }
      mags[k] = Math.hypot(re, im) / N;
    }
    return mags;
  })();

  function srcMag(k) {
    if (k < 1) k = 1;
    const K = SRC_MAG.length - 1;
    if (k >= K) return SRC_MAG[K] * K / k;
    const lo = Math.floor(k), hi = Math.min(K, lo + 1), fr = k - lo;
    const a = Math.log(SRC_MAG[lo] + 1e-9), b = Math.log(SRC_MAG[hi] + 1e-9);
    return Math.exp(a + (b - a) * fr);
  }

  // 共振器1つの周波数特性の大きさ（Klatt型2次共振器）
  function resMag(f, F, B, fs) {
    const T = 1 / fs, r = Math.exp(-Math.PI * B * T);
    const Cc = -r * r, Bc = 2 * r * Math.cos(2 * Math.PI * F * T), Ac = 1 - Bc - Cc;
    const w = 2 * Math.PI * f * T;
    const re = 1 - Bc * Math.cos(w) - Cc * Math.cos(2 * w);
    const im = Bc * Math.sin(w) + Cc * Math.sin(2 * w);
    return Math.abs(Ac) / Math.hypot(re, im);
  }

  function filterMag(f, p, fs) {
    const F = [p.f1, p.f2, p.f3, p.f4, p.f5], on = [1, 1, p.f3on ? 1 : 0, 1, 1];
    let m = 1;
    for (let i = 0; i < 5; i++) if (on[i]) m *= resMag(f, F[i], BW[i], fs);
    return m;
  }

  // 包絡線（声道フィルタ×音源の傾き）の dB 値
  function envelopeDb(f, p, fs = 48000) {
    return 20 * Math.log10(filterMag(f, p, fs) * srcMag(f / p.f0) + 1e-12);
  }

  // 倍音 k の dB 値
  function harmonicDb(k, p, fs = 48000) {
    return 20 * Math.log10(filterMag(k * p.f0, p, fs) * SRC_MAG[Math.min(k, SRC_MAG.length - 1)] + 1e-12);
  }

  window.Formant = { Synth, envelopeDb, harmonicDb, BW };
})();
