/* おんがくメーカー: MusicXML (.musicxml / .xml / .mxl) の読み込み */
(function () {
  'use strict';
  const MM = window.MM;

  const child = (el, name) => {
    if (!el) return null;
    for (const c of el.children) if (c.localName === name) return c;
    return null;
  };
  const text = (el, name) => {
    const c = child(el, name);
    return c ? c.textContent.trim() : null;
  };

  MM.importMusicXML = function (xmlText, opts = {}) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('MusicXML を読み取れませんでした');
    const root = doc.documentElement;
    if (root.localName === 'score-timewise') throw new Error('score-timewise 形式には対応していません');
    if (root.localName !== 'score-partwise') throw new Error('MusicXML ではないようです');

    const song = { title: opts.title || 'MusicXMLの曲', bpm: 120, timeSig: null, keySig: null, bars: 1, tracks: [] };
    const workTitle = root.querySelector('work > work-title') || root.querySelector('movement-title');
    if (workTitle && workTitle.textContent.trim()) song.title = workTitle.textContent.trim();
    else {
      const credit = root.querySelector('credit-words');
      if (credit && credit.textContent.trim()) song.title = credit.textContent.trim();
    }

    const partInfo = {};
    for (const sp of root.querySelectorAll('part-list > score-part')) {
      const prog = sp.querySelector('midi-instrument > midi-program');
      partInfo[sp.getAttribute('id')] = {
        name: (text(sp, 'part-name') || '').trim(),
        program: prog ? parseInt(prog.textContent, 10) - 1 : null,
      };
    }

    let tempoFound = false;
    for (const part of root.querySelectorAll(':scope > part')) {
      const info = partInfo[part.getAttribute('id')] || { name: '' };
      let divisions = 1;
      let t = 0; // tick
      let lastStart = 0;
      const byStaff = new Map(); // staff番号 → notes
      const openTies = new Map();
      const toTicks = (d) => (d * MM.TPQ) / divisions;

      for (const measure of part.querySelectorAll(':scope > measure')) {
        for (const el of measure.children) {
          switch (el.localName) {
            case 'attributes': {
              const div = text(el, 'divisions');
              if (div) divisions = parseFloat(div) || 1;
              const key = child(el, 'key');
              if (key && song.keySig == null && text(key, 'fifths') != null) song.keySig = parseInt(text(key, 'fifths'), 10);
              const time = child(el, 'time');
              if (time && !song.timeSig && text(time, 'beats')) {
                const beats = parseInt(text(time, 'beats'), 10);
                const bt = parseInt(text(time, 'beat-type'), 10);
                if (beats > 0 && bt > 0) song.timeSig = [beats, bt];
              }
              break;
            }
            case 'direction':
            case 'sound': {
              const snd = el.localName === 'sound' ? el : el.querySelector('sound');
              if (!tempoFound && snd && snd.getAttribute('tempo')) {
                song.bpm = Math.round(parseFloat(snd.getAttribute('tempo')));
                tempoFound = true;
              }
              const pm = el.querySelector('metronome > per-minute');
              if (!tempoFound && pm && parseFloat(pm.textContent)) {
                song.bpm = Math.round(parseFloat(pm.textContent));
                tempoFound = true;
              }
              break;
            }
            case 'backup':
              t -= toTicks(parseFloat(text(el, 'duration')) || 0);
              break;
            case 'forward':
              t += toTicks(parseFloat(text(el, 'duration')) || 0);
              break;
            case 'note': {
              if (child(el, 'grace')) break;
              const isChord = !!child(el, 'chord');
              const dur = toTicks(parseFloat(text(el, 'duration')) || 0);
              const start = isChord ? lastStart : t;
              if (!isChord) {
                lastStart = t;
                t += dur;
              }
              if (child(el, 'rest') || child(el, 'cue')) break;
              const pitch = child(el, 'pitch');
              if (!pitch) break;
              const step = text(pitch, 'step');
              const alter = parseFloat(text(pitch, 'alter') || '0');
              const octave = parseInt(text(pitch, 'octave'), 10);
              const midi = (octave + 1) * 12 + MM.STEP_SEMI[step] + Math.round(alter);
              const staff = parseInt(text(el, 'staff') || '1', 10);
              const ties = [...el.children].filter((c) => c.localName === 'tie').map((c) => c.getAttribute('type'));
              const s0 = Math.round(start);
              const d0 = Math.max(1, Math.round(start + dur) - s0);
              let note;
              const tieKey = staff + ':' + midi;
              const prev = openTies.get(tieKey);
              if (ties.includes('stop') && prev && Math.abs(prev.t + prev.d - s0) <= 1) {
                prev.d = s0 + d0 - prev.t;
                note = prev;
              } else {
                note = { p: midi, t: s0, d: d0 };
                if (!byStaff.has(staff)) byStaff.set(staff, []);
                byStaff.get(staff).push(note);
              }
              if (ties.includes('start')) openTies.set(tieKey, note);
              else openTies.delete(tieKey);
              break;
            }
          }
        }
      }
      const staffs = [...byStaff.keys()].sort((a, b) => a - b);
      const baseName = info.name || 'パート' + (song.tracks.length + 1);
      for (const st of staffs) {
        let name = baseName;
        if (staffs.length === 2) name += st === 1 ? '（右手）' : '（左手）';
        else if (staffs.length > 2) name += '（' + st + '段目）';
        const tr = MM.newTrack(song, name, MM.instrumentFromProgram(info.program != null ? info.program : guessProgram(baseName)));
        tr.notes = byStaff.get(st).filter((n) => n.t >= 0).sort((a, b) => a.t - b.t);
        song.tracks.push(tr);
      }
    }
    song.timeSig = song.timeSig || [4, 4];
    song.keySig = song.keySig || 0;
    if (!song.tracks.length) throw new Error('音符が見つかりませんでした');
    return MM.fitBars(song);
  };

  function guessProgram(name) {
    const n = name.toLowerCase();
    if (/violin|viola|cello|string|バイオリン|ヴァイオリン|チェロ/.test(n)) return 48;
    if (/flute|フルート|recorder|リコーダー/.test(n)) return 73;
    if (/trumpet|horn|brass|トランペット/.test(n)) return 56;
    if (/guitar|ギター/.test(n)) return 25;
    if (/bass|ベース/.test(n)) return 33;
    if (/organ|オルガン/.test(n)) return 19;
    return 0;
  }

  // ---- .mxl (zip) の展開 ----------------------------------------------------
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('このブラウザは .mxl に対応していません。.musicxml で保存してください');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  MM.unzip = async function (buffer) {
    const dv = new DataView(buffer);
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('zip ファイルを読み取れませんでした');
    const count = dv.getUint16(eocd + 10, true);
    let ptr = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(ptr, true) !== 0x02014b50) break;
      const method = dv.getUint16(ptr + 10, true);
      const csize = dv.getUint32(ptr + 20, true);
      const nameLen = dv.getUint16(ptr + 28, true);
      const extraLen = dv.getUint16(ptr + 30, true);
      const commentLen = dv.getUint16(ptr + 32, true);
      const localOff = dv.getUint32(ptr + 42, true);
      const name = dec.decode(new Uint8Array(buffer, ptr + 46, nameLen));
      ptr += 46 + nameLen + extraLen + commentLen;
      const lName = dv.getUint16(localOff + 26, true);
      const lExtra = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lName + lExtra;
      const raw = new Uint8Array(buffer, start, csize);
      files[name] = { method, raw };
    }
    return {
      names: Object.keys(files),
      async read(name) {
        const f = files[name];
        if (!f) return null;
        return f.method === 0 ? f.raw : inflateRaw(f.raw);
      },
    };
  };

  MM.readMxl = async function (buffer) {
    const zip = await MM.unzip(buffer);
    let path = null;
    const container = await zip.read('META-INF/container.xml');
    if (container) {
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(container), 'application/xml');
      const rf = doc.querySelector('rootfile');
      if (rf) path = rf.getAttribute('full-path');
    }
    if (!path) path = zip.names.find((n) => /\.(musicxml|xml)$/i.test(n) && !n.startsWith('META-INF'));
    if (!path) throw new Error('.mxl の中に楽譜が見つかりませんでした');
    return new TextDecoder().decode(await zip.read(path));
  };
})();
