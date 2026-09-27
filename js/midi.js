/* おんがくメーカー: MIDI ファイルの読み込み・書き出し */
(function () {
  'use strict';
  const MM = window.MM;

  MM.importMidi = function (buffer, opts = {}) {
    const data = new Uint8Array(buffer);
    let p = 0;
    const u32 = () => ((data[p++] << 24) | (data[p++] << 16) | (data[p++] << 8) | data[p++]) >>> 0;
    const u16 = () => (data[p++] << 8) | data[p++];
    const str4 = () => String.fromCharCode(data[p++], data[p++], data[p++], data[p++]);
    const vlq = () => {
      let v = 0, b;
      do {
        b = data[p++];
        v = (v << 7) | (b & 0x7f);
      } while (b & 0x80 && p < data.length);
      return v;
    };

    if (str4() !== 'MThd') throw new Error('MIDIファイルではないようです');
    const hlen = u32();
    const hstart = p;
    u16(); // format
    const ntrks = u16();
    let division = u16();
    if (division & 0x8000) division = 480; // SMPTE は非対応 → 仮の値
    p = hstart + hlen;

    let bpm = null, timeSig = null, keySig = null, title = null;
    const groups = new Map(); // key: track-channel
    for (let ti = 0; ti < ntrks && p < data.length; ti++) {
      const id = str4();
      const len = u32();
      const end = p + len;
      if (id !== 'MTrk') {
        p = end;
        continue;
      }
      let tick = 0, status = 0, name = null;
      const programs = {};
      const open = new Map();
      while (p < end) {
        tick += vlq();
        let b = data[p];
        if (b & 0x80) {
          status = b;
          p++;
        }
        const type = status & 0xf0;
        const ch = status & 0x0f;
        if (status === 0xff) {
          const mt = data[p++];
          const ml = vlq();
          const md = data.subarray(p, p + ml);
          p += ml;
          if (mt === 0x51 && bpm == null) bpm = Math.round(60000000 / ((md[0] << 16) | (md[1] << 8) | md[2]));
          else if (mt === 0x58 && !timeSig) timeSig = [md[0], Math.pow(2, md[1])];
          else if (mt === 0x59 && keySig == null) keySig = (md[0] << 24) >> 24;
          else if (mt === 0x03 && !name) name = decodeText(md);
          else if (mt === 0x2f) break;
        } else if (status === 0xf0 || status === 0xf7) {
          p += vlq();
        } else if (type === 0x90 || type === 0x80) {
          const note = data[p++];
          const vel = data[p++];
          const k = ch * 128 + note;
          if (type === 0x90 && vel > 0) {
            if (!open.has(k)) open.set(k, []);
            open.get(k).push(tick);
          } else {
            const st = open.get(k);
            if (st && st.length) {
              const s = st.shift();
              const gk = ti + '-' + ch;
              if (!groups.has(gk)) groups.set(gk, { ti, ch, name: null, notes: [], program: null });
              groups.get(gk).notes.push({ p: note, s, e: tick });
            }
          }
        } else if (type === 0xc0) {
          programs[ch] = data[p++];
        } else if (type === 0xd0) {
          p += 1;
        } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
          p += 2;
        } else {
          p++; // 不明なデータ
        }
      }
      for (const g of groups.values()) {
        if (g.ti === ti) {
          g.name = name;
          if (programs[g.ch] != null) g.program = programs[g.ch];
        }
      }
      if (ti === 0 && name) title = name;
      p = end;
    }

    const q = opts.quantize || 1;
    const conv = (t) => Math.round(((t * MM.TPQ) / division) / q) * q;
    const song = {
      title: opts.title || title || 'MIDIの曲',
      bpm: bpm || 120,
      timeSig: timeSig || [4, 4],
      keySig: keySig || 0,
      bars: 1,
      tracks: [],
    };
    for (const g of groups.values()) {
      if (g.ch === 9 && !opts.keepDrums) continue; // ドラムは省略
      if (!g.notes.length) continue;
      const name = g.name && g.name.trim() ? g.name.trim() : 'トラック' + (song.tracks.length + 1);
      const tr = MM.newTrack(song, name, MM.instrumentFromProgram(g.program));
      tr.notes = g.notes
        .map((n) => {
          const t = conv(n.s);
          return { p: n.p, t, d: Math.max(q, conv(n.e) - t) };
        })
        .sort((a, b) => a.t - b.t);
      song.tracks.push(tr);
    }
    if (!song.tracks.length) throw new Error('音符が見つかりませんでした');
    return MM.fitBars(song);
  };

  function decodeText(bytes) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      try {
        return new TextDecoder('shift_jis').decode(bytes);
      } catch (e2) {
        return String.fromCharCode(...bytes);
      }
    }
  }

  MM.exportMidi = function (song) {
    const DIV = 480;
    const k = DIV / MM.TPQ;
    const chunks = [];
    const vlq = (v) => {
      const bytes = [v & 0x7f];
      while ((v >>= 7)) bytes.unshift((v & 0x7f) | 0x80);
      return bytes;
    };
    const text = (s) => Array.from(new TextEncoder().encode(s));
    const track = (events) => {
      events.sort((a, b) => a.t - b.t || a.o - b.o);
      const out = [];
      let last = 0;
      for (const e of events) {
        out.push(...vlq(e.t - last), ...e.b);
        last = e.t;
      }
      out.push(0, 0xff, 0x2f, 0);
      return [0x4d, 0x54, 0x72, 0x6b, (out.length >>> 24) & 255, (out.length >>> 16) & 255, (out.length >>> 8) & 255, out.length & 255].concat(out);
    };
    // テンポトラック
    const us = Math.round(60000000 / song.bpm);
    const t0 = [
      { t: 0, o: 0, b: [0xff, 0x03, ...vlq(text(song.title).length), ...text(song.title)] },
      { t: 0, o: 0, b: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] },
      { t: 0, o: 0, b: [0xff, 0x58, 4, song.timeSig[0], Math.round(Math.log2(song.timeSig[1])), 24, 8] },
      { t: 0, o: 0, b: [0xff, 0x59, 2, (song.keySig || 0) & 255, 0] },
    ];
    chunks.push(track(t0));
    song.tracks.forEach((tr, i) => {
      let ch = i % 15;
      if (ch >= 9) ch++; // 10ch(ドラム)を避ける
      const inst = MM.INSTRUMENTS.find((x) => x.id === tr.instrument);
      const ev = [
        { t: 0, o: 0, b: [0xff, 0x03, ...vlq(text(tr.name).length), ...text(tr.name)] },
        { t: 0, o: 0, b: [0xc0 | ch, inst ? inst.gm : 0] },
        { t: 0, o: 0, b: [0xb0 | ch, 7, Math.round(Math.min(1, tr.volume) * 127)] },
      ];
      if (!tr.mute) {
        for (const n of tr.notes) {
          ev.push({ t: Math.round(n.t * k), o: 2, b: [0x90 | ch, n.p, 96] });
          ev.push({ t: Math.round((n.t + n.d) * k), o: 1, b: [0x80 | ch, n.p, 0] });
        }
      }
      chunks.push(track(ev));
    });
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, chunks.length, (DIV >> 8) & 255, DIV & 255];
    const all = header.concat(...chunks);
    return new Uint8Array(all);
  };
})();
