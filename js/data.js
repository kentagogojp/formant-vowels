// 母音と声のタイプの代表値
(function () {
  'use strict';

  // 日本語5母音の成人男性の代表的なフォルマント（Hz、おおよその値）
  const VOWELS = [
    { id: 'a', kana: 'あ', f1: 800, f2: 1200, f3: 2500 },
    { id: 'i', kana: 'い', f1: 300, f2: 2300, f3: 3000 },
    { id: 'u', kana: 'う', f1: 330, f2: 1350, f3: 2400 },
    { id: 'e', kana: 'え', f1: 500, f2: 1900, f3: 2500 },
    { id: 'o', kana: 'お', f1: 500, f2: 850, f3: 2500 },
  ];

  // 声のタイプ。k は声道が短いほど上がるフォルマントの倍率
  const VOICES = {
    male: { label: '男性', f0: 120, k: 1.0 },
    female: { label: '女性', f0: 220, k: 1.17 },
    child: { label: '子ども', f0: 290, k: 1.3 },
  };

  const RANGE = {
    f0: [60, 500],
    f1: [150, 1300],
    f2: [400, 3600],
    f3: [1500, 4500],
  };

  function target(vowel, voiceId) {
    const k = VOICES[voiceId].k;
    return { f1: Math.round(vowel.f1 * k), f2: Math.round(vowel.f2 * k), f3: Math.round(vowel.f3 * k) };
  }

  // いまの F1・F2 にいちばん近い母音と、その近さ（0〜1）
  function judge(f1, f2, voiceId) {
    let best = null;
    for (const v of VOWELS) {
      const t = target(v, voiceId);
      const d1 = Math.log(f1 / t.f1) / 0.22, d2 = Math.log(f2 / t.f2) / 0.18;
      const d = Math.hypot(d1, d2);
      if (!best || d < best.d) best = { vowel: v, d };
    }
    best.closeness = Math.exp(-best.d * best.d / 2);
    return best;
  }

  window.VowelData = { VOWELS, VOICES, RANGE, target, judge };
})();
