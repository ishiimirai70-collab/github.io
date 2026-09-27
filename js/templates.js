/* おんがくメーカー: テンプレート曲
 * クラシック・童謡などは作曲者の死後70年以上たった「パブリックドメイン」の曲だけを収録。
 * アニメ・ゲーム風の曲は著作権のある既存曲の代わりに、このアプリ用に作ったオリジナル曲です。
 */
(function () {
  'use strict';
  const MM = window.MM;
  const tr = MM.transposeStr;

  // ---- 伴奏ジェネレーター ------------------------------------------------
  const ROOT = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const QUALITY = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dim: [0, 3, 6], sus4: [0, 5, 7], aug: [0, 4, 8] };
  const mod12 = (x) => ((x % 12) + 12) % 12;

  function chordTones(sym) {
    const m = /^([A-G][#b]?)(maj7|m7|m|7|dim|sus4|aug)?(?:\/([A-G][#b]?))?$/.exec(sym);
    if (!m) throw new Error('コード名エラー: ' + sym);
    const root = ROOT[m[1]];
    const iv = QUALITY[m[2] || ''];
    const R = 40 + mod12(root - 4); // 低音の根音 (E2〜D#3)
    const B = m[3] ? 40 + mod12(ROOT[m[3]] - 4) : R; // 分数コードのベース
    const U = 53 + mod12(root - 5); // 和音の根音 (F3〜E4)
    return {
      B: [B],
      R: [R],
      5: [R + iv[2]],
      8: [R + 12],
      10: [R + 12 + iv[1]],
      12: [R + 12 + iv[2]],
      C: iv.slice(0, 3).map((i) => U + i).concat(iv.length > 3 ? [U + iv[3]] : []),
    };
  }

  const PATTERNS = {
    pad: { period: 0, ev: [[0, 0, 'B'], [0, 0, 'C']] },
    block: { period: 0, ev: [[0, 0, 'C']] },
    bass: { period: 0, ev: [[0, 0, 'B']] },
    alberti: { period: 24, ev: [[0, 6, '8'], [6, 6, '12'], [12, 6, '10'], [18, 6, '12']] },
    arp8: { period: 48, ev: [[0, 6, 'B'], [6, 6, '5'], [12, 6, '8'], [18, 6, '10'], [24, 6, '8'], [30, 6, '5'], [36, 6, '8'], [42, 6, '5']] },
    waltz: { period: 36, ev: [[0, 12, 'B'], [12, 12, 'C'], [24, 12, 'C']] },
    oompah: { period: 48, ev: [[0, 12, 'B'], [12, 12, 'C'], [24, 12, '5'], [36, 12, 'C']] },
    pump8: { period: 6, ev: [[0, 6, 'B']] },
    six8: { period: 18, ev: [[0, 6, 'B'], [6, 6, 'C'], [12, 6, 'C']] },
    march: { period: 24, ev: [[0, 12, 'R'], [12, 12, 'C']] },
  };

  /** "C | G | Am F" のようなコード進行から伴奏ノートを作る */
  function accompany(chordStr, barT, patternName) {
    const pat = PATTERNS[patternName];
    const notes = [];
    chordStr.split('|').forEach((bar, bi) => {
      const syms = bar.trim().split(/\s+/).filter(Boolean);
      if (!syms.length) return;
      const len = barT / syms.length;
      syms.forEach((sym, si) => {
        if (sym === '-') return;
        const tones = chordTones(sym);
        const start = bi * barT + si * len;
        const period = pat.period || len;
        for (let k = 0; k * period < len; k++) {
          for (const [off, dur, kind] of pat.ev) {
            const o = k * period + off;
            if (o >= len) continue;
            const d = Math.min(dur || len, len - o);
            for (const p of tones[kind]) notes.push({ p, t: start + o, d });
          }
        }
      });
    });
    return notes;
  }

  // ---- 曲データ ------------------------------------------------------------
  const ELISE_A = 'E5s D#5s E5s B4s D5s C5s | A4e rs C4s E4s A4s | B4e rs E4s G#4s B4s | C5e rs E4s E5s D#5s | E5s D#5s E5s B4s D5s C5s | A4e rs C4s E4s A4s | B4e rs E4s C5s B4s';
  const ELISE_LA = 'A2s E3s A3s rs re', ELISE_LE = 'E2s E3s G#3s rs re', ELISE_R = 'rq.';
  const ELISE_LH_A = [ELISE_R, ELISE_LA, ELISE_LE, ELISE_LA, ELISE_R, ELISE_LA, ELISE_LE].join(' | ');

  const CANON_LINE =
    'F#5q E5q D5q C#5q | B4q A4q B4q C#5q | D5q C#5q B4q A4q | G4q F#4q G4q E4q | ' +
    'D4e F#4e A4e G4e F#4e D4e F#4e E4e | D4e B3e D4e A4e G4e B4e A4e G4e';
  const CANON_BASS = 'D3q A2q B2q F#2q | G2q D2q G2q A2q';

  const HALL = 'B3e C#4e D4e E4e F#4e D4e F#4q | F4e C#4e F4q E4e C4e E4q | B3e C#4e D4e E4e F#4e D4e F#4e B4e | A4e F#4e D4e F#4e A4h';

  const KAERU = 'C4q D4q E4q F4q | E4q D4q C4h | E4q F4q G4q A4q | G4q F4q E4h | C4q rq C4q rq | C4q rq C4q rq | C4e C4e D4e D4e E4e E4e F4e F4e | E4q D4q C4h';

  const rep = (s, n) => Array(n).fill(s).join(' | ');

  MM.TEMPLATE_CATEGORIES = [
    { id: 'classic', name: '🎻 クラシック' },
    { id: 'kids', name: '🎈 童謡・世界の民謡' },
    { id: 'season', name: '🎄 季節・イベント' },
    { id: 'anime', name: '✨ アニメ・ゲーム風（オリジナル）' },
  ];

  MM.TEMPLATES = [
    {
      id: 'ode', cat: 'classic', title: '歓喜の歌（交響曲第9番）', composer: 'ベートーヴェン', bpm: 112, ts: [4, 4], key: 0,
      tracks: [
        { name: 'メロディ', inst: 'piano', seq: 'E4q E4q F4q G4q | G4q F4q E4q D4q | C4q C4q D4q E4q | E4q. D4e D4h | E4q E4q F4q G4q | G4q F4q E4q D4q | C4q C4q D4q E4q | D4q. C4e C4h | D4q D4q E4q C4q | D4q E4e F4e E4q C4q | D4q E4e F4e E4q D4q | C4q D4q G3h | E4q E4q F4q G4q | G4q F4q E4q D4q | C4q C4q D4q E4q | D4q. C4e C4h' },
        { name: '伴奏', inst: 'piano', vol: 0.55, acc: ['C | G | C | G | C | G | C | G C | G C | G C | G | C G | C | G | C | G C', 'alberti'] },
      ],
    },
    {
      id: 'elise', cat: 'classic', title: 'エリーゼのために', composer: 'ベートーヴェン', bpm: 72, ts: [3, 8], key: 0,
      tracks: [
        { name: '右手', inst: 'piano', seq: 'rq E5s D#5s | ' + ELISE_A + ' | A4e re E5s D#5s | ' + ELISE_A + ' | A4q.' },
        { name: '左手', inst: 'piano', vol: 0.7, seq: ELISE_R + ' | ' + ELISE_LH_A + ' | ' + ELISE_LA + ' | ' + ELISE_LH_A + ' | ' + ELISE_LA },
      ],
    },
    {
      id: 'nacht', cat: 'classic', title: 'アイネ・クライネ・ナハトムジーク', composer: 'モーツァルト', bpm: 132, ts: [4, 4], key: 1,
      tracks: [
        { name: 'バイオリン', inst: 'strings', seq: 'G4q re D4e G4q re D4e | G4e D4e G4e B4e D5q rq | C5q re A4e C5q re A4e | C5e A4e F#4e A4e D4q rq | G4q re D4e G4q re D4e | G4e D4e G4e B4e D5q rq | C5q re A4e C5q re A4e | C5e A4e F#4e A4e D4q rq | G4+B4+G5h. rq' },
        { name: 'チェロ', inst: 'strings', vol: 0.7, seq: 'G2q re D2e G2q re D2e | G2e D2e G2e B2e D3q rq | C3q re A2e C3q re A2e | C3e A2e F#2e A2e D2q rq | G2q re D2e G2q re D2e | G2e D2e G2e B2e D3q rq | C3q re A2e C3q re A2e | C3e A2e F#2e A2e D2q rq | G2h. rq' },
      ],
    },
    {
      id: 'canon', cat: 'classic', title: 'カノン', composer: 'パッヘルベル', bpm: 66, ts: [4, 4], key: 2,
      tracks: [
        { name: 'バイオリン1', inst: 'strings', seq: 'rw | rw | ' + CANON_LINE + ' | F#5q E5q D5q C#5q | B4q A4q B4q C#5q | D5w' },
        { name: 'バイオリン2', inst: 'flute', vol: 0.6, seq: 'rw | rw | rw | rw | ' + CANON_LINE + ' | A4w' },
        { name: 'チェロ', inst: 'bass', vol: 0.8, seq: rep(CANON_BASS, 5) + ' | D2w' },
      ],
    },
    {
      id: 'minuet', cat: 'classic', title: 'メヌエット ト長調', composer: 'ペツォールト（伝バッハ）', bpm: 120, ts: [3, 4], key: 1,
      tracks: [
        { name: '右手', inst: 'piano', seq: 'D5q G4e A4e B4e C5e | D5q G4q G4q | E5q C5e D5e E5e F#5e | G5q G4q G4q | C5q D5e C5e B4e A4e | B4q C5e B4e A4e G4e | F#4q G4e A4e B4e G4e | A4h. | D5q G4e A4e B4e C5e | D5q G4q G4q | E5q C5e D5e E5e F#5e | G5q G4q G4q | C5q D5e C5e B4e A4e | B4q C5e B4e A4e G4e | A4q B4e A4e G4e F#4e | G4h.' },
        { name: '左手', inst: 'piano', vol: 0.7, seq: 'G3h A3q | B3h. | C4h. | B3h. | A3h. | G3h. | D4q B3q G3q | D4q D3e C4e B3e A3e | B3h A3q | G3q B3q G3q | C4h. | B3q C4e B3e A3e G3e | A3h F#3q | G3h B3q | C4q D4q D3q | G3h G2q' },
      ],
    },
    {
      id: 'brahms', cat: 'classic', title: 'ブラームスの子守歌', composer: 'ブラームス', bpm: 84, ts: [3, 4], key: 0,
      tracks: [
        { name: 'メロディ', inst: 'musicbox', seq: 'rh E4e E4e | G4q. E4e E4q | G4h E4e G4e | C5q B4q. A4e | A4q G4q D4e E4e | F4q D4q D4e E4e | F4h D4e F4e | B4e A4e G4q B4q | C5h C4e C4e | C5h A4e F4e | G4h E4e C4e | F4q G4q A4q | G4h C4e C4e | C5h A4e F4e | G4h E4e C4e | F4q E4q D4q | C4h.' },
        { name: '伴奏', inst: 'piano', vol: 0.45, acc: ['- | C | C | F | C | G7 | G7 | G7 | C | F | C | G7 | C | F | C | G7 | C', 'waltz'] },
      ],
    },
    {
      id: 'largo', cat: 'classic', title: '家路（新世界より）', composer: 'ドヴォルザーク', bpm: 60, ts: [4, 4], key: 0,
      tracks: [
        { name: 'メロディ', inst: 'flute', seq: 'E4q. G4e G4h | E4q. D4e C4h | D4q E4q G4q E4q | D4w | E4q. G4e G4h | E4q. D4e C4h | D4q E4q D4q. C4e | C4w' },
        { name: '伴奏', inst: 'strings', vol: 0.45, acc: ['C | C | G | G | C | C | G | C', 'pad'] },
      ],
    },
    {
      id: 'hall', cat: 'classic', title: '山の魔王の宮殿にて', composer: 'グリーグ', bpm: 126, ts: [4, 4], key: 2,
      tracks: [
        { name: 'メロディ', inst: 'strings', seq: HALL + ' | ' + HALL + ' | ' + tr(HALL, 12) + ' | ' + tr(HALL, 12) },
        { name: 'ベース', inst: 'bass', vol: 0.8, seq: rep('B1q rq F#2q rq', 16) },
      ],
    },
    {
      id: 'twinkle', cat: 'kids', title: 'きらきら星', composer: 'フランス民謡', bpm: 100, ts: [4, 4], key: 0,
      tracks: [
        { name: 'メロディ', inst: 'musicbox', seq: 'C5q C5q G5q G5q | A5q A5q G5h | F5q F5q E5q E5q | D5q D5q C5h | G5q G5q F5q F5q | E5q E5q D5h | G5q G5q F5q F5q | E5q E5q D5h | C5q C5q G5q G5q | A5q A5q G5h | F5q F5q E5q E5q | D5q D5q C5h' },
        { name: '伴奏', inst: 'piano', vol: 0.5, acc: ['C | F C | F C | G C | C G | C G | C G | C G | C | F C | F C | G C', 'alberti'] },
      ],
    },
    {
      id: 'sakura', cat: 'kids', title: 'さくらさくら', composer: '日本古謡', bpm: 72, ts: [4, 4], key: 0,
      tracks: [
        { name: 'メロディ', inst: 'koto', seq: 'A4q A4q B4h | A4q A4q B4h | A4q B4q C5q B4q | A4q B4e A4e F4h | E4q C4q E4q F4q | E4q E4e C4e B3h | A4q B4q C5q B4q | A4q B4e A4e F4h | E4q C4q E4q F4q | E4q E4e C4e B3h | A4q A4q B4h | A4q A4q B4h | E4q F4q B4e A4e F4q | E4w' },
        { name: '伴奏', inst: 'koto', vol: 0.5, seq: rep('A2+E3h A2+E3h', 14) },
      ],
    },
    {
      id: 'kaeru', cat: 'kids', title: 'かえるの合唱（輪唱）', composer: 'ドイツ民謡', bpm: 110, ts: [4, 4], key: 0,
      tracks: [
        { name: '1ばん', inst: 'flute', seq: tr(KAERU, 12) + ' | rw | rw' },
        { name: '2ばん（2小節おくれ）', inst: 'square', vol: 0.6, seq: 'rw | rw | ' + KAERU },
      ],
    },
    {
      id: 'jingle', cat: 'season', title: 'ジングルベル', composer: 'ピアポント', bpm: 140, ts: [4, 4], key: 0,
      tracks: [
        { name: 'メロディ', inst: 'musicbox', seq: 'E5q E5q E5h | E5q E5q E5h | E5q G5q C5q. D5e | E5w | F5q F5q F5q. F5e | F5q E5q E5q E5e E5e | E5q D5q D5q E5q | D5h G5h | E5q E5q E5h | E5q E5q E5h | E5q G5q C5q. D5e | E5w | F5q F5q F5q F5q | F5q E5q E5q E5e E5e | G5q G5q F5q D5q | C5w' },
        { name: '伴奏', inst: 'piano', vol: 0.5, acc: ['C | C | C | C | F | C | D7 | G7 | C | C | C | C | F | C | G7 | C', 'oompah'] },
      ],
    },
    {
      id: 'silent', cat: 'season', title: 'きよしこの夜', composer: 'グルーバー', bpm: 72, ts: [6, 8], key: 0,
      tracks: [
        { name: 'メロディ', inst: 'flute', seq: 'G4q. A4e G4q | E4h. | G4q. A4e G4q | E4h. | D5h D5q | B4h. | C5h C5q | G4h. | A4h A4q | C5q. B4e A4q | G4q. A4e G4q | E4h. | A4h A4q | C5q. B4e A4q | G4q. A4e G4q | E4h. | D5h D5q | F5q. D5e B4q | C5h. | E5h. | C5q. G4e E4q | G4q. F4e D4q | C4h.' },
        { name: '伴奏', inst: 'epiano', vol: 0.45, acc: ['C | C | C | C | G7 | G7 | C | C | F | F | C | C | F | F | C | C | G7 | G7 | C | C | C | G7 | C', 'six8'] },
      ],
    },
    {
      id: 'birthday', cat: 'season', title: 'ハッピーバースデー', composer: 'ヒル姉妹', bpm: 100, ts: [3, 4], key: 0,
      tracks: [
        { name: 'メロディ', inst: 'piano', seq: 'rh G4e. G4s | A4q G4q C5q | B4h G4e. G4s | A4q G4q D5q | C5h G4e. G4s | G5q E5q C5q | B4q A4q F5e. F5s | E5q C5q D5q | C5h.' },
        { name: '伴奏', inst: 'piano', vol: 0.45, acc: ['- | C | G | G | C | C | F | C G | C', 'waltz'] },
      ],
    },
    {
      id: 'op', cat: 'anime', title: 'アニメOP風「青空スタートライン」', composer: 'オリジナル', bpm: 168, ts: [4, 4], key: 0,
      tracks: [
        { name: 'メロディ', inst: 'brass', seq: 'A4e C5e F5q E5e D5e C5q | D5e B4e G4q D5e E5e D5q | E5e G5e B5q A5e G5e E5q | A5q. G5e E5h | F5e E5e C5q F5e E5e C5e A4e | B4e D5e G5q F5e E5e D5q | D5e E5e F5q G5e A5e B5q | C6h. rq' },
        { name: 'ストリングス', inst: 'strings', vol: 0.4, acc: ['F | G | Em | Am | F | G | Dm G | C', 'block'] },
        { name: 'ベース', inst: 'bass', vol: 0.7, acc: ['F | G | Em | Am | F | G | Dm G | C', 'pump8'] },
      ],
    },
    {
      id: 'rpg', cat: 'anime', title: 'RPG風「はじまりの草原」', composer: 'オリジナル', bpm: 140, ts: [4, 4], key: 0,
      tracks: [
        { name: 'メロディ', inst: 'square', seq: 'C5q. G4e C5e D5e E5e F5e | G5h E5q C5q | A5q. F5e A5e G5e F5e E5e | D5h. rq | C5q. G4e C5e D5e E5e F5e | G5q A5e G5e E5q C5q | F5e E5e D5e C5e B4e C5e D5e B4e | C5h. rq' },
        { name: 'ハーモニー', inst: 'square', vol: 0.35, acc: ['C | G | F | G | C | Am | F G | C', 'march'] },
        { name: 'ベース', inst: 'triangle', vol: 0.8, acc: ['C | G | F | G | C | Am | F G | C', 'pump8'] },
      ],
    },
    {
      id: 'ballad', cat: 'anime', title: 'バラード風「夕焼けの約束」', composer: 'オリジナル', bpm: 76, ts: [4, 4], key: 0,
      tracks: [
        { name: 'メロディ', inst: 'piano', seq: 'E5q. D5e C5q G4q | D5q. C5e B4h | C5q. B4e A4q E5q | B4h. rq | A4q. C5e F5q E5e D5e | E5h. C5q | D5q. E5e F5q A5q | G5h. rq | C5w' },
        { name: 'アルペジオ', inst: 'piano', vol: 0.5, acc: ['C | G/B | Am | Em/G | F | C/E | Dm | G | C', 'arp8'] },
      ],
    },
    {
      id: 'magical', cat: 'anime', title: '魔法少女風「ほしふるステッキ」', composer: 'オリジナル', bpm: 132, ts: [4, 4], key: 0,
      tracks: [
        { name: 'メロディ', inst: 'musicbox', seq: 'G5e E5e C5e E5e G5q C6q | A5e G5e E5e C5e A4h | F5e A5e C6e A5e F5q E5q | D5e E5e F5e G5e A5q B5q | C6q. B5e C6q G5q | A5q. G5e E5q C5q | F5e A5e G5e F5e E5e F5e D5e B4e | C6h. rq' },
        { name: 'ストリングス', inst: 'strings', vol: 0.35, acc: ['C | Am | F | G | C | Am | F G | C', 'block'] },
        { name: 'ベース', inst: 'bass', vol: 0.6, acc: ['C | Am | F | G | C | Am | F G | C', 'march'] },
      ],
    },
  ];

  /** テンプレートから曲データを作る */
  MM.buildTemplate = (tpl) => {
    const song = { title: tpl.title, bpm: tpl.bpm, timeSig: tpl.ts.slice(), keySig: tpl.key || 0, bars: 1, tracks: [] };
    const barT = MM.barTicks(song);
    for (const t of tpl.tracks) {
      const track = MM.newTrack(song, t.name, t.inst);
      if (t.vol != null) track.volume = t.vol;
      track.notes = t.seq ? MM.parseSeq(t.seq) : accompany(t.acc[0], barT, t.acc[1]);
      track.notes = track.notes.map((n) => ({ p: n.p, t: Math.round(n.t), d: Math.round(n.d) }));
      song.tracks.push(track);
    }
    return MM.fitBars(song);
  };

  MM.accompany = accompany;
})();
