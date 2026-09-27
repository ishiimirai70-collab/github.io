/* おんがくメーカー: ABC記譜法（テキストの楽譜）の読み込み
 * 例:
 *   X:1
 *   T:きらきら星
 *   M:4/4
 *   L:1/4
 *   K:C
 *   C C G G | A A G2 | F F E E | D D C2 |
 */
(function () {
  'use strict';
  const MM = window.MM;

  const MAJOR_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
  const MODE_OFFSET = { '': 0, maj: 0, ion: 0, mix: -1, dor: -2, m: -3, min: -3, aeo: -3, phr: -4, loc: -5, lyd: 1 };
  const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
  const LETTER_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

  function parseKey(k) {
    const m = /^\s*([A-G])([#b]?)\s*([A-Za-z]*)/.exec(k || 'C');
    if (!m) return 0;
    const root = m[1] + m[2];
    const mode = (m[3] || '').toLowerCase().slice(0, 3);
    const mo = MODE_OFFSET[mode === 'maj' ? 'maj' : mode] != null ? MODE_OFFSET[mode] : mode.startsWith('m') ? -3 : 0;
    let f = MAJOR_FIFTHS[root];
    if (f == null) {
      // 例: A#, D# などの長調
      const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
      f = ((semis * 7) % 12 + 12) % 12;
      if (f > 6) f -= 12;
    }
    return Math.max(-7, Math.min(7, f + mo));
  }

  function keyAlters(fifths) {
    const a = [0, 0, 0, 0, 0, 0, 0];
    if (fifths > 0) for (let i = 0; i < fifths; i++) a[SHARP_ORDER[i]] = 1;
    if (fifths < 0) for (let i = 0; i < -fifths; i++) a[SHARP_ORDER[6 - i]] = -1;
    return a;
  }

  function parseFrac(s, def) {
    const m = /^\s*(\d+)\s*\/\s*(\d+)/.exec(s || '');
    return m ? parseInt(m[1], 10) / parseInt(m[2], 10) : def;
  }

  MM.importABC = function (src) {
    const lines = String(src).replace(/\r/g, '').split('\n');
    const song = { title: 'ABCの曲', bpm: 120, timeSig: [4, 4], keySig: 0, bars: 1, tracks: [] };
    let unit = null;
    let inBody = false;
    let seenX = false;
    const voices = new Map();
    let cur = null;
    let fifths = 0;
    let alters = keyAlters(0);

    const getVoice = (id) => {
      if (!voices.has(id)) {
        voices.set(id, { id, t: 0, notes: [], name: null, lastNotes: null, tie: [], barAcc: {} });
      }
      return voices.get(id);
    };

    const setField = (f, v) => {
      switch (f) {
        case 'T':
          if (song.title === 'ABCの曲') song.title = v.trim();
          break;
        case 'M': {
          if (/^C\|/.test(v.trim())) song.timeSig = [2, 2];
          else if (/^C/.test(v.trim())) song.timeSig = [4, 4];
          else {
            const m = /(\d+)\s*\/\s*(\d+)/.exec(v);
            if (m) song.timeSig = [parseInt(m[1], 10), parseInt(m[2], 10)];
          }
          break;
        }
        case 'L':
          unit = parseFrac(v, 1 / 8);
          break;
        case 'Q': {
          const m = /(?:(\d+\s*\/\s*\d+)\s*=\s*)?(\d+)/.exec(v);
          if (m) {
            const beat = m[1] ? parseFrac(m[1], 1 / 4) : 1 / 4;
            song.bpm = Math.round(parseInt(m[2], 10) * beat * 4);
          }
          break;
        }
        case 'K':
          fifths = parseKey(v);
          alters = keyAlters(fifths);
          if (!inBody) song.keySig = fifths;
          inBody = true;
          break;
        case 'V': {
          const id = v.trim().split(/\s+/)[0];
          cur = getVoice(id);
          const nm = /(?:name|nm)\s*=\s*"([^"]*)"/.exec(v);
          if (nm) cur.name = nm[1];
          break;
        }
      }
    };

    for (let raw of lines) {
      const line = raw.replace(/%.*$/, '');
      const fm = /^([A-Za-z]):(.*)$/.exec(line);
      if (fm) {
        if (fm[1] === 'X') {
          if (seenX) break; // 最初の曲だけ
          seenX = true;
          continue;
        }
        setField(fm[1], fm[2]);
        continue;
      }
      if (!inBody || !line.trim()) continue;
      if (unit == null) {
        const r = song.timeSig[0] / song.timeSig[1];
        unit = r < 0.75 ? 1 / 16 : 1 / 8;
      }
      if (!cur) cur = getVoice('1');
      parseBody(line);
    }

    function parseBody(s) {
      let i = 0;
      let tuplet = null; // {n, ratio}
      let broken = null; // 次の音符の倍率
      const unitTicks = () => unit * 48;

      const readLen = () => {
        const m = /^(\d*)(\/*)(\d*)/.exec(s.slice(i));
        i += m[0].length;
        let num = m[1] ? parseInt(m[1], 10) : 1;
        let den = 1;
        if (m[2]) den = m[3] ? parseInt(m[3], 10) : Math.pow(2, m[2].length);
        return num / den;
      };

      const readPitch = () => {
        const m = /^([\^=_]*)([A-Ga-g])([,']*)/.exec(s.slice(i));
        if (!m) return null;
        i += m[0].length;
        const letter = m[2].toUpperCase();
        let oct = m[2] === letter ? 4 : 5;
        for (const c of m[3]) oct += c === "'" ? 1 : -1;
        const step = LETTER_STEP[letter];
        const accKey = letter + oct;
        let alt;
        if (m[1]) {
          alt = 0;
          for (const c of m[1]) alt += c === '^' ? 1 : c === '_' ? -1 : 0;
          cur.barAcc[accKey] = alt;
        } else if (cur.barAcc[accKey] != null) alt = cur.barAcc[accKey];
        else alt = alters[step];
        return (oct + 1) * 12 + MM.DIATONIC_SEMI[step] + alt;
      };

      const place = (pitches, len) => {
        let d = len * unitTicks();
        if (broken) {
          d *= broken;
          broken = null;
        }
        if (tuplet) {
          d *= tuplet.ratio;
          if (--tuplet.n <= 0) tuplet = null;
        }
        // > < 付点リズム
        const nx = s[i];
        let nextFactor = null;
        if (nx === '>' || nx === '<') {
          let cnt = 0;
          while (s[i] === nx) {
            cnt++;
            i++;
          }
          const f = 1 - Math.pow(0.5, cnt);
          if (nx === '>') {
            d *= 1 + f;
            nextFactor = 1 - f;
          } else {
            d *= 1 - f;
            nextFactor = 1 + f;
          }
        }
        const created = [];
        for (const p of pitches) {
          if (p == null) continue;
          const tieIdx = cur.tie.findIndex((n) => n.p === p && Math.abs(n.t + n.d - cur.t) < 0.01);
          if (tieIdx >= 0) {
            const n = cur.tie[tieIdx];
            n.d += d;
            created.push(n);
          } else {
            const n = { p, t: cur.t, d };
            cur.notes.push(n);
            created.push(n);
          }
        }
        cur.tie = [];
        if (s[i] === '-') {
          i++;
          cur.tie = created;
        }
        cur.t += d;
        broken = nextFactor;
      };

      while (i < s.length) {
        const c = s[i];
        if (c === '"') {
          const j = s.indexOf('"', i + 1);
          i = j < 0 ? s.length : j + 1;
        } else if (c === '!' || c === '+') {
          const j = s.indexOf(c, i + 1);
          i = j < 0 ? s.length : j + 1;
        } else if (c === '{') {
          const j = s.indexOf('}', i + 1);
          i = j < 0 ? s.length : j + 1; // 装飾音は省略
        } else if (c === '[' && /^\[[A-Za-z]:/.test(s.slice(i))) {
          const j = s.indexOf(']', i);
          const inner = s.slice(i + 1, j < 0 ? s.length : j);
          setField(inner[0], inner.slice(2));
          i = j < 0 ? s.length : j + 1;
        } else if (c === '[' && /^\[\d/.test(s.slice(i))) {
          i += 2; // 繰り返し記号 [1 [2
        } else if (c === '[') {
          i++;
          const ps = [];
          let len = null;
          while (i < s.length && s[i] !== ']') {
            const p = readPitch();
            if (p == null) {
              i++;
              continue;
            }
            const l = readLen();
            if (len == null) len = l;
            ps.push(p);
            if (s[i] === '-') i++;
          }
          i++;
          const outer = readLen();
          place(ps, (len || 1) * outer);
        } else if (c === '(' && /^\(\d/.test(s.slice(i))) {
          const m = /^\((\d)(?::(\d*))?(?::(\d*))?/.exec(s.slice(i));
          i += m[0].length;
          const p = parseInt(m[1], 10);
          const q = m[2] ? parseInt(m[2], 10) : p === 3 || p === 6 ? 2 : p === 2 || p === 4 || p === 8 ? 3 : 2;
          const r = m[3] ? parseInt(m[3], 10) : p;
          tuplet = { n: r, ratio: q / p };
        } else if (c === '|' || c === ':') {
          cur.barAcc = {};
          i++;
        } else if (/[\^=_A-Ga-g]/.test(c)) {
          const p = readPitch();
          if (p == null) {
            i++;
            continue;
          }
          const len = readLen();
          place([p], len);
        } else if (c === 'z' || c === 'x') {
          i++;
          const len = readLen();
          place([], len);
        } else if (c === 'Z' || c === 'X') {
          i++;
          const m = /^\d*/.exec(s.slice(i));
          i += m[0].length;
          const bars = m[0] ? parseInt(m[0], 10) : 1;
          cur.t += bars * (song.timeSig[0] * 48) / song.timeSig[1];
        } else {
          i++;
        }
      }
    }

    // 変換 (1全音符 = 48 tick)
    for (const v of voices.values()) {
      if (!v.notes.length) continue;
      const tr = MM.newTrack(song, v.name || (voices.size > 1 ? '声部 ' + v.id : 'メロディ'), 'piano');
      tr.notes = v.notes.map((n) => ({ p: n.p, t: Math.round(n.t), d: Math.max(1, Math.round(n.d)) }));
      song.tracks.push(tr);
    }
    if (!song.tracks.length) throw new Error('ABC の音符が見つかりませんでした（K: 行のあとに音符を書いてください）');
    return MM.fitBars(song);
  };
})();
