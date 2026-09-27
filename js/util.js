/* おんがくメーカー: 共通ユーティリティ */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});

  // 4分音符 = 12 tick（16分音符 = 3, 3連8分 = 4）
  MM.TPQ = 12;

  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const JA = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];
  const STEP_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  MM.STEP_SEMI = STEP_SEMI;
  MM.DIATONIC_SEMI = [0, 2, 4, 5, 7, 9, 11];

  const pc = (m) => ((m % 12) + 12) % 12;
  MM.noteName = (m) => SHARP[pc(m)] + (Math.floor(m / 12) - 1);
  MM.noteNameJa = (m) => JA[pc(m)];
  MM.isBlack = (m) => [1, 3, 6, 8, 10].includes(pc(m));

  MM.parsePitch = (s) => {
    const m = /^([A-Ga-g])([#b♯♭]*)(-?\d+)$/.exec(String(s).trim());
    if (!m) return null;
    let v = STEP_SEMI[m[1].toUpperCase()];
    for (const c of m[2]) v += c === '#' || c === '♯' ? 1 : -1;
    return v + (parseInt(m[3], 10) + 1) * 12;
  };

  const DUR = { w: 48, h: 24, q: 12, e: 6, s: 3 };

  /**
   * かんたん楽譜記法をノート配列に変換する。
   *  "E4q"  = ミ(4オクターブ)の4分音符,  "C4+E4+G4h" = 和音の2分音符
   *  "rq"   = 4分休符,  "q." = 付点,  "et" = 3連8分,  "|" は小節線(無視)
   */
  MM.parseSeq = (str, startTick = 0) => {
    const notes = [];
    let t = startTick;
    for (const tok of String(str).split(/\s+/)) {
      if (!tok || tok === '|') continue;
      const m = /^(.*?)([whqes])(\.?)(t?)$/.exec(tok);
      if (!m) throw new Error('記法エラー: ' + tok);
      let d = DUR[m[2]];
      if (m[3]) d *= 1.5;
      if (m[4]) d = (d * 2) / 3;
      if (m[1] !== 'r') {
        for (const p of m[1].split('+')) {
          const midi = MM.parsePitch(p);
          if (midi == null) throw new Error('音名エラー: ' + tok);
          notes.push({ p: midi, t, d });
        }
      }
      t += d;
    }
    return notes;
  };

  MM.transposeStr = (str, semis) =>
    String(str).replace(/[A-G][#b]?-?\d+/g, (n) => MM.noteName(MM.parsePitch(n) + semis));

  MM.barTicks = (song) => (song.timeSig[0] * MM.TPQ * 4) / song.timeSig[1];
  MM.beatTicks = (song) => (MM.TPQ * 4) / song.timeSig[1];

  MM.lastNoteEnd = (song) => {
    let end = 0;
    for (const tr of song.tracks) for (const n of tr.notes) end = Math.max(end, n.t + n.d);
    return end;
  };

  MM.fitBars = (song) => {
    const need = Math.ceil(MM.lastNoteEnd(song) / MM.barTicks(song));
    if (need > song.bars) song.bars = need;
    if (song.bars < 1) song.bars = 1;
    return song;
  };

  MM.TRACK_COLORS = ['#ff6b8b', '#4dabf7', '#51cf66', '#fcc419', '#b197fc', '#ff922b', '#20c997', '#f06595'];

  let uidCounter = 0;
  MM.uid = () => Date.now().toString(36) + (uidCounter++).toString(36) + Math.random().toString(36).slice(2, 6);

  MM.newTrack = (song, name, instrument) => {
    const idx = song ? song.tracks.length : 0;
    return {
      id: MM.uid(),
      name: name || 'トラック' + (idx + 1),
      instrument: instrument || 'piano',
      color: MM.TRACK_COLORS[idx % MM.TRACK_COLORS.length],
      volume: 0.8,
      mute: false,
      notes: [],
    };
  };

  MM.newSong = (title) => {
    const song = { title: title || '新しい曲', bpm: 120, timeSig: [4, 4], keySig: 0, bars: 16, tracks: [] };
    song.tracks.push(MM.newTrack(song, 'メロディ', 'piano'));
    return song;
  };

  // 読み込んだデータを安全な形に整える
  MM.normalizeSong = (s) => {
    const song = {
      title: String(s.title || '無題'),
      bpm: Math.min(400, Math.max(20, Number(s.bpm) || 120)),
      timeSig: Array.isArray(s.timeSig) && s.timeSig.length === 2 ? s.timeSig.map(Number) : [4, 4],
      keySig: Math.max(-7, Math.min(7, Math.round(Number(s.keySig) || 0))),
      bars: Math.max(1, Math.round(Number(s.bars) || 16)),
      tracks: [],
    };
    (s.tracks || []).forEach((t) => {
      const tr = MM.newTrack(song, t.name, t.instrument);
      if (t.color) tr.color = t.color;
      tr.volume = t.volume != null ? Number(t.volume) : 0.8;
      tr.mute = !!t.mute;
      tr.notes = (t.notes || [])
        .filter((n) => n && n.d > 0 && n.p >= 0 && n.p <= 127 && n.t >= 0)
        .map((n) => ({ p: Math.round(n.p), t: Math.round(n.t), d: Math.max(1, Math.round(n.d)) }));
      song.tracks.push(tr);
    });
    if (!song.tracks.length) song.tracks.push(MM.newTrack(song, 'メロディ', 'piano'));
    return MM.fitBars(song);
  };

  MM.clone = (o) => JSON.parse(JSON.stringify(o));

  // GM音色番号 → アプリの楽器
  MM.instrumentFromProgram = (prog) => {
    if (prog == null) return 'piano';
    if (prog <= 3) return 'piano';
    if (prog <= 7) return 'epiano';
    if (prog <= 15) return 'musicbox';
    if (prog <= 23) return 'organ';
    if (prog <= 31) return 'guitar';
    if (prog <= 39) return 'bass';
    if (prog <= 55) return 'strings';
    if (prog <= 63) return 'brass';
    if (prog <= 79) return 'flute';
    if (prog <= 87) return 'square';
    if (prog <= 103) return 'strings';
    if (prog <= 111) return 'koto';
    return 'piano';
  };

  MM.download = (filename, data, mime) => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  };

  MM.safeFileName = (s) => String(s || 'song').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'song';
})();
