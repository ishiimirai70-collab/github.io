/* おんがくメーカー: 楽譜（五線譜）表示 — SVG で描画 */
(function () {
  'use strict';
  const MM = window.MM;

  const S = 10; // 五線の間隔(px)
  const RX = S * 0.62; // 符頭の横半径
  const INK = 'var(--ink, #111)';

  // 標準の音価（tick）と種類
  const VALUES = [
    [72, 'w', 1], [48, 'w', 0], [36, 'h', 1], [24, 'h', 0], [18, 'q', 1], [12, 'q', 0],
    [9, 'e', 1], [8, 'q', 0, 3], [6, 'e', 0], [4, 'e', 0, 3], [3, 's', 0], [2, 's', 0, 3], [1, 's', 0, 3],
  ];

  function decompose(d) {
    const out = [];
    let rest = d;
    while (rest > 0) {
      const v = VALUES.find((x) => x[0] <= rest) || VALUES[VALUES.length - 1];
      out.push({ d: v[0], type: v[1], dots: v[2], tuplet: v[3] || 0 });
      rest -= v[0];
    }
    return out;
  }

  // 音高 → 五線上の位置(全音階番号)と臨時記号
  const SHARP_MAP = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
  const FLAT_MAP = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
  const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
  const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];

  function spell(midi, keySig) {
    const oct = Math.floor(midi / 12) - 1;
    const [step, alter] = (keySig < 0 ? FLAT_MAP : SHARP_MAP)[midi % 12];
    return { dn: oct * 7 + step, step, alter };
  }

  function keyAlters(keySig) {
    const a = [0, 0, 0, 0, 0, 0, 0];
    if (keySig > 0) for (let i = 0; i < keySig; i++) a[SHARP_ORDER[i]] = 1;
    if (keySig < 0) for (let i = 0; i < -keySig; i++) a[FLAT_ORDER[i]] = -1;
    return a;
  }

  // 調号の位置 (ト音記号, 全音階番号)
  const KEY_POS_SHARP = [38, 35, 39, 36, 33, 37, 34];
  const KEY_POS_FLAT = [34, 37, 33, 36, 32, 35, 31];

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  /**
   * 曲を楽譜 SVG にする。
   * @returns {{svg: string, locate: (tick:number)=>{x:number,y0:number,y1:number}|null}}
   */
  MM.renderScore = function (song, opts = {}) {
    const width = Math.max(360, opts.width || 900);
    const barT = MM.barTicks(song);
    const nBars = Math.max(1, song.bars, Math.ceil(MM.lastNoteEnd(song) / barT));
    const keySig = song.keySig || 0;
    const tracks = song.tracks.filter((t) => !t.hidden);

    // パートごとに、平均の高さでト音記号かヘ音記号に割り当てる
    const trackStaff = tracks.map((tr) => {
      if (!tr.notes.length) return null;
      const avg = tr.notes.reduce((a, n) => a + n.p, 0) / tr.notes.length;
      return avg >= 60 ? 'T' : 'B';
    });
    const hasT = trackStaff.includes('T') || !trackStaff.includes('B');
    const hasB = trackStaff.includes('B');
    const staves = [];
    if (hasT) staves.push('T');
    if (hasB) staves.push('B');

    // --- 音符を小節ごと・標準音価に分割 ---
    const measures = Array.from({ length: nBars }, () => ({ T: [], B: [] }));
    tracks.forEach((tr, ti) => {
      for (const n of tr.notes) {
        let t = n.t;
        const end = n.t + n.d;
        let prevSeg = null;
        while (t < end) {
          const m = Math.floor(t / barT);
          if (m >= nBars) break;
          const segEnd = Math.min(end, (m + 1) * barT);
          let tt = t;
          for (const v of decompose(segEnd - t)) {
            const seg = { p: n.p, t: tt, d: v.d, type: v.type, dots: v.dots, tuplet: v.tuplet, ti, tieFrom: !!prevSeg };
            if (prevSeg) prevSeg.tieTo = seg;
            measures[m][trackStaff[ti]].push(seg);
            prevSeg = seg;
            tt += v.d;
          }
          t = segEnd;
        }
      }
    });

    // --- イベント（和音）にまとめ、休符を補う ---
    for (let m = 0; m < nBars; m++) {
      for (const st of staves) {
        const segs = measures[m][st];
        const map = new Map();
        for (const s of segs) {
          const k = s.t + ':' + s.d + ':' + s.ti;
          if (!map.has(k)) map.set(k, { t: s.t, d: s.d, type: s.type, dots: s.dots, tuplet: s.tuplet, notes: [], staff: st });
          map.get(k).notes.push(s);
        }
        const events = [...map.values()].sort((a, b) => a.t - b.t || b.d - a.d);
        // 休符
        const mStart = m * barT;
        const covered = [];
        for (const e of events) covered.push([e.t, e.t + e.d]);
        covered.sort((a, b) => a[0] - b[0]);
        const rests = [];
        if (!covered.length) {
          rests.push({ t: mStart, d: barT, type: 'W', rest: true, dots: 0, staff: st, whole: true });
        } else {
          let pos = mStart;
          const addGap = (a, b) => {
            let p = a;
            while (b - p >= 1) {
              let v = null;
              for (const val of [48, 24, 12, 6, 3]) {
                if (val <= b - p && (p - mStart) % val === 0) {
                  v = val;
                  break;
                }
              }
              if (!v) v = [48, 24, 12, 6, 3].find((x) => x <= b - p) || b - p;
              const type = { 48: 'w', 24: 'h', 12: 'q', 6: 'e', 3: 's' }[v] || 's';
              rests.push({ t: p, d: v, type, rest: true, dots: 0, staff: st });
              p += v;
            }
          };
          for (const [a, b] of covered) {
            if (a > pos) addGap(pos, a);
            pos = Math.max(pos, b);
          }
          if (pos < mStart + barT) addGap(pos, mStart + barT);
        }
        measures[m][st] = events.concat(rests).sort((a, b) => a.t - b.t);
      }
    }

    // --- 小節の幅 ---
    const mWidths = measures.map((ms, m) => {
      const starts = new Set();
      for (const st of staves) for (const e of ms[st]) starts.add(e.t);
      const arr = [...starts].sort((a, b) => a - b);
      arr.push((m + 1) * barT);
      let minGap = barT;
      for (let i = 1; i < arr.length; i++) minGap = Math.min(minGap, arr[i] - arr[i - 1]);
      const w = (barT / Math.max(2, minGap)) * 24 + 42;
      return Math.max(110, Math.min(width - 150, w));
    });

    // --- 段組み ---
    const keyW = Math.abs(keySig) * S * 1.05;
    const headW = (first) => 16 + S * 3.4 + keyW + (first ? S * 2.4 : 0) + 8;
    const systems = [];
    let cur = null;
    for (let m = 0; m < nBars; m++) {
      if (!cur || cur.used + mWidths[m] > width - 12) {
        if (cur) systems.push(cur);
        cur = { first: systems.length === 0, measures: [], used: headW(systems.length === 0) };
      }
      cur.measures.push(m);
      cur.used += mWidths[m];
    }
    if (cur) systems.push(cur);

    const staffTop = { T: 0, B: 0 };
    const staffGap = S * 7; // ト音とヘ音の間
    const sysH = 60 + staves.length * S * 4 + (staves.length - 1) * staffGap + 60;
    const titleH = song.title ? 56 : 16;
    const height = titleH + systems.length * sysH + 10;

    const out = [];
    const locs = []; // 再生位置表示用
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="score-svg">`);
    out.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="var(--paper, #fff)"/>`);
    if (song.title) {
      out.push(`<text x="${width / 2}" y="36" text-anchor="middle" font-size="22" font-weight="bold" fill="${INK}" font-family="serif">${esc(song.title)}</text>`);
    }
    out.push(`<text x="16" y="${titleH - 6}" font-size="12" fill="${INK}" font-family="sans-serif">♩ = ${song.bpm}</text>`);

    const ties = [];
    systems.forEach((sys, si) => {
      const y0 = titleH + si * sysH + 50;
      staves.forEach((st, i) => (staffTop[st] = y0 + i * (S * 4 + staffGap)));
      const x0 = 12;
      // 余白を均等に配分（最後の段は詰める）
      const avail = width - 12 - headW(sys.first);
      const natural = sys.measures.reduce((a, m) => a + mWidths[m], 0);
      const stretch = si === systems.length - 1 && natural < avail * 0.75 ? 1 : avail / natural;
      const x1 = si === systems.length - 1 && stretch === 1 ? x0 + headW(sys.first) + natural : width - 12;
      const yTop = staffTop[staves[0]];
      const yBot = staffTop[staves[staves.length - 1]] + S * 4;

      // 五線
      for (const st of staves) {
        for (let l = 0; l < 5; l++) {
          const y = staffTop[st] + l * S;
          out.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${INK}" stroke-width="1"/>`);
        }
      }
      out.push(`<line x1="${x0}" y1="${yTop}" x2="${x0}" y2="${yBot}" stroke="${INK}" stroke-width="1.2"/>`);
      if (staves.length === 2) {
        out.push(`<path d="M${x0 - 4},${yTop} q-6,${(yBot - yTop) / 4} 0,${(yBot - yTop) / 2} q-6,${(yBot - yTop) / 4} 0,${(yBot - yTop) / 2}" fill="none" stroke="${INK}" stroke-width="2.2"/>`);
      }
      // 音部記号・調号・拍子
      let hx = x0 + 6;
      for (const st of staves) {
        const top = staffTop[st];
        if (st === 'T') {
          out.push(`<text x="${hx}" y="${top + S * 3}" font-size="${S * 4.2}" class="music-font" fill="${INK}">&#x1D11E;</text>`);
        } else {
          out.push(`<text x="${hx}" y="${top + S * 3.4}" font-size="${S * 4.2}" class="music-font" fill="${INK}">&#x1D122;</text>`);
        }
      }
      hx += S * 3.4 + 6;
      if (keySig) {
        const pos = keySig > 0 ? KEY_POS_SHARP : KEY_POS_FLAT;
        const sym = keySig > 0 ? '♯' : '♭';
        for (let i = 0; i < Math.abs(keySig); i++) {
          for (const st of staves) {
            const dn = pos[i] - (st === 'B' ? 14 : 0);
            out.push(accidental(hx + i * S * 1.05, yOf(st, dn), sym));
          }
        }
        hx += keyW;
      }
      if (sys.first) {
        for (const st of staves) {
          const top = staffTop[st];
          out.push(`<text x="${hx + S}" y="${top + S * 1.9}" text-anchor="middle" font-size="${S * 2.3}" font-weight="bold" font-family="serif" fill="${INK}">${song.timeSig[0]}</text>`);
          out.push(`<text x="${hx + S}" y="${top + S * 3.9}" text-anchor="middle" font-size="${S * 2.3}" font-weight="bold" font-family="serif" fill="${INK}">${song.timeSig[1]}</text>`);
        }
      }

      let mx = x0 + headW(sys.first);
      sys.measures.forEach((m, mi) => {
        const mw = mWidths[m] * stretch;
        if (mi === 0) {
          out.push(`<text x="${x0}" y="${yTop - S * 2.2}" font-size="10" fill="${INK}" font-family="sans-serif">${m + 1}</text>`);
        }
        const padL = 14, padR = 10;
        const xAt = (t) => mx + padL + ((t - m * barT) / barT) * (mw - padL - padR);
        locs.push({ m, x: mx, w: mw, xAt, y0: yTop - S * 2, y1: yBot + S * 2, sys: si });

        for (const st of staves) {
          const events = measures[m][st];
          const accState = new Map();
          const kAlt = keyAlters(keySig);
          const noteEvents = events.filter((e) => !e.rest);
          // 連桁グループ
          const beamGroups = makeBeams(noteEvents, song, st);
          const beamed = new Set();
          beamGroups.forEach((g) => g.forEach((e) => beamed.add(e)));

          for (const e of events) {
            const x = e.whole ? mx + mw / 2 - RX : xAt(e.t);
            if (e.rest) {
              out.push(drawRest(x, staffTop[st], e.whole ? 'w' : e.type));
              continue;
            }
            // 符頭
            const heads = e.notes.map((n) => ({ n, sp: spell(n.p, keySig) })).sort((a, b) => a.sp.dn - b.sp.dn);
            const avg = heads.reduce((a, h) => a + h.sp.dn, 0) / heads.length;
            const mid = st === 'T' ? 34 : 22;
            let up = e.beamUp != null ? e.beamUp : avg < mid;
            e.up = up;
            let prevDn = null, prevShift = false;
            for (const h of heads) {
              const y = yOf(st, h.sp.dn);
              let hx2 = x;
              if (prevDn != null && h.sp.dn - prevDn === 1 && !prevShift) {
                hx2 = up ? x + RX * 2 - 1 : x - RX * 2 + 1;
                prevShift = true;
              } else prevShift = false;
              prevDn = h.sp.dn;
              // 加線
              ledger(out, st, h.sp.dn, hx2);
              // 臨時記号
              const key = h.sp.dn;
              const curAlt = accState.has(key) ? accState.get(key) : kAlt[h.sp.step];
              if (!h.n.tieFrom && curAlt !== h.sp.alter) {
                out.push(accidental(x - S * 1.35 - (heads.length > 1 ? 2 : 0), y, h.sp.alter === 1 ? '♯' : h.sp.alter === -1 ? '♭' : '♮'));
                accState.set(key, h.sp.alter);
              }
              out.push(notehead(hx2, y, e.type));
              if (e.dots) {
                const onLine = (((h.sp.dn - (st === 'T' ? 30 : 18)) % 2) + 2) % 2 === 0;
                out.push(`<circle cx="${hx2 + RX + 5}" cy="${y + (onLine ? -S / 2 : 0)}" r="1.7" fill="${INK}"/>`);
              }
              h.x = hx2;
              h.y = y;
              if (h.n.tieTo) ties.push({ from: h, seg: h.n, up, st, sys: si });
              h.n._pos = { x: hx2, y, sys: si, x1 };
            }
            e.heads = heads;
            if (e.tuplet && !beamed.has(e)) {
              out.push(`<text x="${x + RX}" y="${up ? yOf(st, heads[heads.length - 1].sp.dn) - S * 4 : yOf(st, heads[0].sp.dn) + S * 4.6}" font-size="10" text-anchor="middle" font-style="italic" fill="${INK}">3</text>`);
            }
            if (e.type === 'w') continue;
            if (beamed.has(e)) continue;
            // 符尾
            const yHi = heads[heads.length - 1].y;
            const yLo = heads[0].y;
            const sx = up ? x + RX - 0.6 : x - RX + 0.6;
            const tip = up ? Math.min(yHi - S * 3.4, staffTop[st] + S * 2) : Math.max(yLo + S * 3.4, staffTop[st] + S * 2);
            out.push(`<line x1="${sx}" y1="${up ? yLo : yHi}" x2="${sx}" y2="${tip}" stroke="${INK}" stroke-width="1.3"/>`);
            const flags = e.type === 'e' ? 1 : e.type === 's' ? 2 : 0;
            for (let f = 0; f < flags; f++) {
              const fy = tip + (up ? f * S * 0.8 : -f * S * 0.8);
              out.push(up
                ? `<path d="M${sx},${fy} c1,${S * 1.2} ${S * 1.3},${S * 1.3} ${S * 0.9},${S * 2.8} c0.2,-${S * 1.1} -${S * 0.3},-${S * 1.5} -${S * 0.9},-${S * 1.9} z" fill="${INK}"/>`
                : `<path d="M${sx},${fy} c1,-${S * 1.2} ${S * 1.3},-${S * 1.3} ${S * 0.9},-${S * 2.8} c0.2,${S * 1.1} -${S * 0.3},${S * 1.5} -${S * 0.9},${S * 1.9} z" fill="${INK}"/>`);
            }
          }
          // 連桁を描く
          for (const g of beamGroups) out.push(drawBeam(g, st));
        }
        mx += mw;
        const isLast = m === nBars - 1;
        if (isLast) {
          out.push(`<line x1="${mx - 5}" y1="${yTop}" x2="${mx - 5}" y2="${yBot}" stroke="${INK}" stroke-width="1"/>`);
          out.push(`<line x1="${mx - 1.5}" y1="${yTop}" x2="${mx - 1.5}" y2="${yBot}" stroke="${INK}" stroke-width="3"/>`);
        } else {
          out.push(`<line x1="${mx}" y1="${yTop}" x2="${mx}" y2="${yBot}" stroke="${INK}" stroke-width="1"/>`);
        }
      });
    });

    // タイ
    for (const tie of ties) {
      const a = tie.seg._pos;
      const b = tie.seg.tieTo && tie.seg.tieTo._pos;
      if (!a) continue;
      const dir = tie.up ? 1 : -1;
      const ya = a.y + dir * (S * 0.7);
      let xb, yb;
      if (b && b.sys === a.sys) {
        xb = b.x - RX * 0.4;
        yb = b.y + dir * (S * 0.7);
      } else {
        xb = a.x1 - 2;
        yb = ya;
      }
      const xa = a.x + RX * 0.6;
      const mxp = (xa + xb) / 2;
      out.push(`<path d="M${xa},${ya} Q${mxp},${ya + dir * S * 1.1} ${xb},${yb} Q${mxp},${ya + dir * S * 0.75} ${xa},${ya} z" fill="${INK}"/>`);
    }
    // 後始末
    for (const ms of measures) for (const st of staves) for (const e of ms[st]) if (e.notes) e.notes.forEach((n) => delete n._pos);

    out.push('</svg>');

    function yOf(st, dn) {
      return st === 'T' ? staffTop.T + (38 - dn) * (S / 2) : staffTop.B + (26 - dn) * (S / 2);
    }

    function ledger(arr, st, dn, x) {
      const top = st === 'T' ? 38 : 26;
      const bot = st === 'T' ? 30 : 18;
      const draw = (k) => arr.push(`<line x1="${x - RX - 3.5}" y1="${yOf(st, k)}" x2="${x + RX + 3.5}" y2="${yOf(st, k)}" stroke="${INK}" stroke-width="1"/>`);
      for (let k = top + 2; k <= dn; k += 2) draw(k);
      for (let k = bot - 2; k >= dn; k -= 2) draw(k);
    }

    function makeBeams(events, song2, st) {
      const beatLen = song2.timeSig[1] === 8 && song2.timeSig[0] % 3 === 0 ? 18 : 12;
      const groups = [];
      let g = [];
      const flush = () => {
        if (g.length >= 2) groups.push(g);
        g = [];
      };
      const evs = events.slice().sort((a, b) => a.t - b.t);
      // 同じ時刻に複数イベント（別トラック）があると連桁が乱れるので除外
      const counts = new Map();
      evs.forEach((e) => counts.set(e.t, (counts.get(e.t) || 0) + 1));
      for (const e of evs) {
        const ok = (e.type === 'e' || e.type === 's') && counts.get(e.t) === 1;
        if (!ok) {
          flush();
          continue;
        }
        e.ti = e.notes[0].ti;
        if (g.length) {
          const prev = g[g.length - 1];
          const sameBeat = Math.floor(prev.t / beatLen) === Math.floor(e.t / beatLen);
          if (prev.t + prev.d !== e.t || !sameBeat || prev.ti !== e.ti) flush();
        }
        g.push(e);
      }
      flush();
      for (const grp of groups) {
        let sum = 0, cnt = 0;
        for (const e of grp) for (const n of e.notes) {
          sum += spell(n.p, keySig).dn;
          cnt++;
        }
        const up = sum / cnt < (st === 'T' ? 34 : 22);
        grp.forEach((e) => (e.beamUp = up));
      }
      return groups;
    }

    function drawBeam(grp, st) {
      const up = grp[0].up;
      const parts = [];
      const stems = grp.map((e) => {
        const yHi = e.heads[e.heads.length - 1].y;
        const yLo = e.heads[0].y;
        const x = xOfEvent(e);
        return { e, x: up ? x + RX - 0.6 : x - RX + 0.6, yHi, yLo };
      });
      const tip = up
        ? Math.min(...stems.map((s) => s.yHi)) - S * 3.2
        : Math.max(...stems.map((s) => s.yLo)) + S * 3.2;
      const T = S * 0.48;
      for (const s of stems) {
        parts.push(`<line x1="${s.x}" y1="${up ? s.yLo : s.yHi}" x2="${s.x}" y2="${tip}" stroke="${INK}" stroke-width="1.3"/>`);
      }
      const bar = (xa, xb, level) => {
        const y = up ? tip + level * S * 0.78 : tip - level * S * 0.78 - T;
        parts.push(`<rect x="${Math.min(xa, xb) - 0.6}" y="${y}" width="${Math.abs(xb - xa) + 1.2}" height="${T}" fill="${INK}"/>`);
      };
      bar(stems[0].x, stems[stems.length - 1].x, 0);
      for (let i = 0; i < stems.length; i++) {
        if (stems[i].e.type !== 's') continue;
        const next = stems[i + 1];
        const prev = stems[i - 1];
        if (next && next.e.type === 's') bar(stems[i].x, next.x, 1);
        else if (!(prev && prev.e.type === 's')) {
          if (next) bar(stems[i].x, stems[i].x + S * 1.1, 1);
          else bar(stems[i].x - S * 1.1, stems[i].x, 1);
        }
      }
      if (grp.some((e) => e.tuplet)) {
        const xm = (stems[0].x + stems[stems.length - 1].x) / 2;
        parts.push(`<text x="${xm}" y="${up ? tip - 4 : tip + 12}" font-size="10" text-anchor="middle" font-style="italic" fill="${INK}">3</text>`);
      }
      void st;
      return parts.join('');
    }

    function xOfEvent(e) {
      // 先頭の符頭は2度ずらしされないので、これが基準位置
      return e.heads[0].x;
    }

    return {
      svg: out.join(''),
      height,
      locate(tick) {
        const m = Math.floor(tick / barT);
        const l = locs.find((q) => q.m === m);
        if (!l) return null;
        return { x: l.xAt(tick), y0: l.y0, y1: l.y1 };
      },
    };
  };

  function notehead(x, y, type) {
    if (type === 'w') {
      return `<ellipse cx="${x}" cy="${y}" rx="${RX * 1.15}" ry="${S * 0.46}" fill="none" stroke="${INK}" stroke-width="${S * 0.22}" transform="rotate(-10 ${x} ${y})"/>`;
    }
    if (type === 'h') {
      return `<ellipse cx="${x}" cy="${y}" rx="${RX - 0.8}" ry="${S * 0.36}" fill="none" stroke="${INK}" stroke-width="${S * 0.18}" transform="rotate(-22 ${x} ${y})"/>`;
    }
    return `<ellipse cx="${x}" cy="${y}" rx="${RX}" ry="${S * 0.44}" fill="${INK}" transform="rotate(-22 ${x} ${y})"/>`;
  }

  // 臨時記号は図形で描く（フォントによって位置がずれないように）
  function accidental(x, y, sym) {
    const k = S / 10;
    if (sym === '♯') {
      return `<g fill="${INK}"><rect x="${x - 2.6 * k}" y="${y - 13 * k}" width="${1.1 * k}" height="${25 * k}"/><rect x="${x + 1.6 * k}" y="${y - 14 * k}" width="${1.1 * k}" height="${25 * k}"/>` +
        `<path d="M${x - 5 * k},${y - 3 * k} L${x + 5 * k},${y - 6 * k} L${x + 5 * k},${y - 3.2 * k} L${x - 5 * k},${y - 0.2 * k} Z"/>` +
        `<path d="M${x - 5 * k},${y + 4.2 * k} L${x + 5 * k},${y + 1.2 * k} L${x + 5 * k},${y + 4 * k} L${x - 5 * k},${y + 7 * k} Z"/></g>`;
    }
    if (sym === '♭') {
      return `<g fill="${INK}"><rect x="${x - 3.5 * k}" y="${y - 17 * k}" width="${1.2 * k}" height="${22 * k}"/>` +
        `<path d="M${x - 2.3 * k},${y + 5 * k} C${x + 7 * k},${y - 1 * k} ${x + 4 * k},${y - 7 * k} ${x - 2.3 * k},${y - 2.5 * k} L${x - 2.3 * k},${y - 0.5 * k} C${x + 2 * k},${y - 4 * k} ${x + 4 * k},${y - 1 * k} ${x - 2.3 * k},${y + 3 * k} Z"/></g>`;
    }
    // ♮
    return `<g fill="${INK}"><rect x="${x - 3 * k}" y="${y - 13 * k}" width="${1.1 * k}" height="${19 * k}"/><rect x="${x + 1.9 * k}" y="${y - 6 * k}" width="${1.1 * k}" height="${19 * k}"/>` +
      `<path d="M${x - 3 * k},${y - 2.5 * k} L${x + 3 * k},${y - 4.5 * k} L${x + 3 * k},${y - 1.8 * k} L${x - 3 * k},${y + 0.2 * k} Z"/>` +
      `<path d="M${x - 3 * k},${y + 4.5 * k} L${x + 3 * k},${y + 2.5 * k} L${x + 3 * k},${y + 5.2 * k} L${x - 3 * k},${y + 7.2 * k} Z"/></g>`;
  }

  function drawRest(x, top, type) {
    const mid = top + S * 2;
    switch (type) {
      case 'w':
        return `<rect x="${x - S * 0.6}" y="${top + S}" width="${S * 1.2}" height="${S * 0.5}" fill="${INK}"/>`;
      case 'h':
        return `<rect x="${x - S * 0.6}" y="${mid - S * 0.5}" width="${S * 1.2}" height="${S * 0.5}" fill="${INK}"/>`;
      case 'q':
        return `<path d="M${x - S * 0.2},${mid - S * 1.5} l${S * 0.6},${S * 0.8} q-${S * 0.5},${S * 0.35} -${S * 0.15},${S * 0.85} l${S * 0.55},${S * 0.5} q-${S * 0.9},-${S * 0.3} -${S * 0.45},${S * 0.9} q-${S * 0.95},-${S * 0.55} -${S * 0.05},-${S * 1.05} l-${S * 0.55},-${S * 0.65} q${S * 0.55},-${S * 0.4} ${S * 0.2},-${S * 1.0} z" fill="${INK}"/>`;
      case 'e':
      case 's': {
        const parts = [];
        const n = type === 'e' ? 1 : 2;
        const sx = x + S * 0.35;
        parts.push(`<line x1="${sx}" y1="${mid - S * 0.9}" x2="${sx - S * 0.55}" y2="${mid + S * (n === 1 ? 1.1 : 1.9)}" stroke="${INK}" stroke-width="1.3"/>`);
        for (let i = 0; i < n; i++) {
          const yy = mid - S * 0.9 + i * S;
          const xx = sx - i * S * 0.25;
          parts.push(`<circle cx="${xx - S * 0.62}" cy="${yy - S * 0.05}" r="${S * 0.27}" fill="${INK}"/>`);
          parts.push(`<path d="M${xx - S * 0.62},${yy + S * 0.15} q${S * 0.35},${S * 0.25} ${S * 0.62},-${S * 0.15}" stroke="${INK}" stroke-width="1.2" fill="none"/>`);
        }
        return parts.join('');
      }
    }
    return '';
  }
})();
