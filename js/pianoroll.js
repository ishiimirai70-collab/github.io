/* おんがくメーカー: ピアノロール（音符を置くエディター） */
(function () {
  'use strict';
  const MM = window.MM;

  class PianoRoll {
    constructor(wrap, hooks) {
      this.wrap = wrap;
      this.spacer = wrap.querySelector('.roll-spacer');
      this.canvas = wrap.querySelector('canvas');
      this.g = this.canvas.getContext('2d');
      this.hooks = hooks; // { beginEdit, endEdit, preview, seek, activeTrack }
      this.KEY_W = 64;
      this.RULER_H = 26;
      this.rowH = 18;
      this.pxPerTick = 7;
      this.low = 21; // A0
      this.high = 108; // C8
      this.tool = 'pen';
      this.noteLen = 12;
      this.snap = 3;
      this.cursorTick = 0;
      this.playTick = -1;
      this.pointers = new Map();
      this.drag = null;
      this.pressedKey = null;

      wrap.addEventListener('scroll', () => this.draw(), { passive: true });
      new ResizeObserver(() => this.resize()).observe(wrap);
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => this.onDown(e));
      c.addEventListener('pointermove', (e) => this.onMove(e));
      c.addEventListener('pointerup', (e) => this.onUp(e));
      c.addEventListener('pointercancel', (e) => this.onUp(e, true));
      c.addEventListener('contextmenu', (e) => e.preventDefault());
      window.addEventListener('pointerup', () => {
        if (this.pressedKey != null) {
          this.pressedKey = null;
          this.draw();
        }
      });
    }

    setSong(song) {
      this.song = song;
      this.updateSize();
      this.draw();
    }

    get track() {
      return this.song.tracks[this.hooks.activeTrack()] || this.song.tracks[0];
    }

    totalTicks() {
      const barT = MM.barTicks(this.song);
      return (this.song.bars + 8) * barT;
    }

    updateSize() {
      if (!this.song) return;
      this.spacer.style.width = this.KEY_W + this.totalTicks() * this.pxPerTick + 'px';
      this.spacer.style.height = this.RULER_H + (this.high - this.low + 1) * this.rowH + 'px';
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.wrap.clientWidth;
      const h = this.wrap.clientHeight;
      this.vw = w;
      this.vh = h;
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.dpr = dpr;
      this.draw();
    }

    setZoom(factor) {
      const centerTick = this.tickAtX(this.vw / 2);
      this.pxPerTick = Math.min(30, Math.max(1.5, this.pxPerTick * factor));
      this.updateSize();
      this.wrap.scrollLeft = Math.max(0, centerTick * this.pxPerTick - (this.vw - this.KEY_W) / 2);
      this.draw();
    }

    // 座標変換（キャンバス上の座標 ↔ 時間・音程）
    xOfTick(t) {
      return this.KEY_W + t * this.pxPerTick - this.wrap.scrollLeft;
    }
    tickAtX(x) {
      return (x - this.KEY_W + this.wrap.scrollLeft) / this.pxPerTick;
    }
    yOfPitch(p) {
      return this.RULER_H + (this.high - p) * this.rowH - this.wrap.scrollTop;
    }
    pitchAtY(y) {
      return this.high - Math.floor((y - this.RULER_H + this.wrap.scrollTop) / this.rowH);
    }

    scrollToPitch(p) {
      this.wrap.scrollTop = Math.max(0, (this.high - p) * this.rowH - this.wrap.clientHeight / 2);
    }

    scrollToNotes() {
      const notes = this.track ? this.track.notes : [];
      if (!notes.length) return this.scrollToPitch(66);
      let sum = 0;
      for (const n of notes) sum += n.p;
      this.scrollToPitch(Math.round(sum / notes.length));
    }

    followPlayhead(tick) {
      const x = this.xOfTick(tick);
      if (x > this.vw - 40 || x < this.KEY_W) {
        this.wrap.scrollLeft = Math.max(0, tick * this.pxPerTick - 40);
      }
    }

    // ---- 描画 ---------------------------------------------------------
    draw() {
      if (!this.song || !this.vw) return;
      const g = this.g;
      const { KEY_W, RULER_H, rowH } = this;
      const W = this.vw;
      const H = this.vh;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const css = getComputedStyle(document.documentElement);
      const col = (n) => css.getPropertyValue(n).trim();
      const C = {
        white: col('--roll-white'),
        black: col('--roll-black'),
        grid: col('--roll-grid'),
        beat: col('--roll-beat'),
        bar: col('--roll-bar'),
        ruler: col('--roll-ruler'),
        text: col('--text'),
        sub: col('--text-sub'),
        out: col('--roll-out'),
      };
      g.clearRect(0, 0, W, H);

      const barT = MM.barTicks(this.song);
      const beatT = MM.beatTicks(this.song);
      const endTick = this.song.bars * barT;
      const t0 = Math.max(0, this.tickAtX(KEY_W));
      const t1 = this.tickAtX(W);
      const pTop = this.pitchAtY(RULER_H);
      const pBot = this.pitchAtY(H);

      // 行（白鍵・黒鍵）
      for (let p = Math.min(this.high, pTop); p >= Math.max(this.low, pBot); p--) {
        const y = this.yOfPitch(p);
        g.fillStyle = MM.isBlack(p) ? C.black : C.white;
        g.fillRect(KEY_W, y, W - KEY_W, rowH);
        if (p % 12 === 0) {
          g.fillStyle = C.bar;
          g.fillRect(KEY_W, y + rowH - 1, W - KEY_W, 1);
        } else if (p % 12 === 5) {
          g.fillStyle = C.grid;
          g.fillRect(KEY_W, y + rowH - 1, W - KEY_W, 1);
        }
      }
      // 曲の終わりより後ろを暗く
      const xEnd = this.xOfTick(endTick);
      if (xEnd < W) {
        g.fillStyle = C.out;
        g.fillRect(Math.max(KEY_W, xEnd), RULER_H, W - Math.max(KEY_W, xEnd), H - RULER_H);
      }
      // 縦線
      const gridStep = this.pxPerTick * this.snap >= 6 ? this.snap : this.pxPerTick * beatT >= 6 ? beatT : barT;
      for (let t = Math.floor(t0 / gridStep) * gridStep; t <= t1; t += gridStep) {
        const x = Math.round(this.xOfTick(t)) + 0.5;
        if (x < KEY_W) continue;
        g.fillStyle = t % barT === 0 ? C.bar : t % beatT === 0 ? C.beat : C.grid;
        g.fillRect(x - 0.5, RULER_H, t % barT === 0 ? 2 : 1, H - RULER_H);
      }

      // 他のトラック（うすく表示）
      const active = this.track;
      g.globalAlpha = 0.28;
      for (const tr of this.song.tracks) {
        if (tr === active || tr.hidden) continue;
        g.fillStyle = tr.color;
        for (const n of tr.notes) {
          if (n.t > t1 || n.t + n.d < t0 || n.p > pTop || n.p < pBot) continue;
          const x = this.xOfTick(n.t);
          g.fillRect(x, this.yOfPitch(n.p) + 2, n.d * this.pxPerTick - 1, rowH - 4);
        }
      }
      g.globalAlpha = 1;

      // 選択中のトラック
      if (active) {
        g.font = `bold ${Math.min(11, rowH - 5)}px system-ui, sans-serif`;
        g.textBaseline = 'middle';
        for (const n of active.notes) {
          if (n.t > t1 || n.t + n.d < t0 || n.p > pTop || n.p < pBot) continue;
          const x = this.xOfTick(n.t);
          const y = this.yOfPitch(n.p);
          const w = Math.max(3, n.d * this.pxPerTick - 1);
          g.fillStyle = active.color;
          roundRect(g, x, y + 1, w, rowH - 2, 4);
          g.fill();
          g.strokeStyle = 'rgba(0,0,0,0.35)';
          g.lineWidth = 1;
          g.stroke();
          // 右端（長さ変更の取っ手）
          if (w > 14) {
            g.fillStyle = 'rgba(255,255,255,0.45)';
            g.fillRect(x + w - 4, y + 4, 2, rowH - 8);
          }
          if (w > 26 && rowH >= 14) {
            g.fillStyle = '#1b1b1f';
            g.fillText(MM.noteNameJa(n.p), x + 4, y + rowH / 2 + 0.5);
          }
        }
      }

      // 再生位置・カーソル
      const drawLine = (tick, color, width) => {
        const x = this.xOfTick(tick);
        if (x < KEY_W || x > W) return;
        g.fillStyle = color;
        g.fillRect(x - width / 2, 0, width, H);
      };
      drawLine(this.cursorTick, 'rgba(255,170,0,0.9)', 2);
      if (this.playTick >= 0) drawLine(this.playTick, '#ff3b5c', 2);

      // ルーラー（小節番号）
      g.fillStyle = C.ruler;
      g.fillRect(KEY_W, 0, W - KEY_W, RULER_H);
      g.fillStyle = C.text;
      g.font = 'bold 12px system-ui, sans-serif';
      g.textBaseline = 'middle';
      for (let bar = Math.floor(t0 / barT); bar * barT <= t1; bar++) {
        const x = this.xOfTick(bar * barT);
        if (x >= KEY_W - 1) {
          g.fillStyle = C.sub;
          g.fillRect(x, RULER_H - 10, 1, 10);
          g.fillStyle = C.text;
          g.fillText(String(bar + 1), x + 4, RULER_H / 2);
        }
        for (let b = 1; b < this.song.timeSig[0]; b++) {
          const bx = this.xOfTick(bar * barT + b * beatT);
          if (bx >= KEY_W) {
            g.fillStyle = C.sub;
            g.fillRect(bx, RULER_H - 5, 1, 5);
          }
        }
      }
      // カーソル▼
      const cx = this.xOfTick(this.cursorTick);
      if (cx >= KEY_W) {
        g.fillStyle = 'rgba(255,170,0,1)';
        g.beginPath();
        g.moveTo(cx - 6, 0);
        g.lineTo(cx + 6, 0);
        g.lineTo(cx, 9);
        g.fill();
      }

      // 鍵盤
      g.fillStyle = C.ruler;
      g.fillRect(0, 0, KEY_W, RULER_H);
      for (let p = Math.min(this.high, pTop); p >= Math.max(this.low, pBot); p--) {
        const y = this.yOfPitch(p);
        if (y + rowH < RULER_H) continue;
        const black = MM.isBlack(p);
        g.fillStyle = p === this.pressedKey ? active.color : black ? '#2b2b33' : '#fafafa';
        g.fillRect(0, y, black ? KEY_W * 0.62 : KEY_W, rowH);
        if (black) {
          g.fillStyle = '#fafafa';
          g.fillRect(KEY_W * 0.62, y, KEY_W * 0.38, rowH);
        }
        g.fillStyle = '#b8b8c0';
        g.fillRect(0, y + rowH - 0.5, KEY_W, 0.5);
        if (!black && rowH >= 12) {
          g.fillStyle = p % 12 === 0 ? '#e03131' : '#666';
          g.font = (p % 12 === 0 ? 'bold ' : '') + '10px system-ui, sans-serif';
          const label = p % 12 === 0 ? MM.noteName(p) + ' ド' : MM.noteNameJa(p);
          g.fillText(label, KEY_W - g.measureText(label).width - 4, y + rowH / 2);
        }
      }
      g.fillStyle = '#999';
      g.fillRect(KEY_W - 1, 0, 1, H);
      // 左上
      g.fillStyle = C.ruler;
      g.fillRect(0, 0, KEY_W, RULER_H);
      g.fillStyle = C.sub;
      g.font = '10px system-ui, sans-serif';
      g.fillText('小節 →', 6, RULER_H / 2);
    }

    // ---- 操作 ---------------------------------------------------------
    local(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    snapFloor(t) {
      return Math.max(0, Math.floor(t / this.snap) * this.snap);
    }

    hitTest(x, y) {
      const tr = this.track;
      if (!tr) return null;
      for (let i = tr.notes.length - 1; i >= 0; i--) {
        const n = tr.notes[i];
        const x0 = this.xOfTick(n.t);
        const x1 = this.xOfTick(n.t + n.d);
        const y0 = this.yOfPitch(n.p);
        if (x >= x0 && x <= x1 && y >= y0 && y <= y0 + this.rowH) {
          const edge = x > x1 - Math.min(10, (x1 - x0) / 3);
          return { note: n, edge };
        }
      }
      return null;
    }

    eraseAt(x, y) {
      const hit = this.hitTest(x, y);
      if (hit) {
        const arr = this.track.notes;
        arr.splice(arr.indexOf(hit.note), 1);
        this.drag.changed = true;
        this.draw();
      }
    }

    onDown(e) {
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      const pt = this.local(e);
      this.pointers.set(e.pointerId, pt);
      if (this.pointers.size === 2) {
        // 2本指 → スクロール
        this.cancelDrag();
        const pts = [...this.pointers.values()];
        this.drag = {
          type: 'pan2',
          cx: (pts[0].x + pts[1].x) / 2,
          cy: (pts[0].y + pts[1].y) / 2,
          sl: this.wrap.scrollLeft,
          st: this.wrap.scrollTop,
        };
        return;
      }
      if (this.pointers.size > 2) return;
      const { x, y } = pt;
      if (y < this.RULER_H && x > this.KEY_W) {
        const t = this.snapFloor(this.tickAtX(x));
        this.cursorTick = t;
        this.drag = { type: 'seek' };
        this.hooks.seek(t);
        this.draw();
        return;
      }
      if (x < this.KEY_W) {
        const p = this.pitchAtY(y);
        if (p >= this.low && p <= this.high) {
          this.pressedKey = p;
          this.hooks.preview(p);
          this.drag = { type: 'key', p };
          this.draw();
        }
        return;
      }
      if (this.tool === 'pan' || e.button === 1 || e.button === 2) {
        this.drag = { type: 'pan', sx: x, sy: y, sl: this.wrap.scrollLeft, st: this.wrap.scrollTop };
        return;
      }
      const tick = this.tickAtX(x);
      const pitch = this.pitchAtY(y);
      if (pitch < this.low || pitch > this.high) return;
      this.hooks.beginEdit();
      if (this.tool === 'erase') {
        this.drag = { type: 'erase', changed: false };
        this.eraseAt(x, y);
        return;
      }
      const hit = this.hitTest(x, y);
      if (hit) {
        const n = hit.note;
        this.drag = {
          type: hit.edge ? 'resize' : 'move',
          note: n,
          orig: { ...n },
          startTick: tick,
          startPitch: pitch,
          sx: x,
          moved: false,
          changed: false,
        };
      } else {
        const n = { p: pitch, t: this.snapFloor(tick), d: this.noteLen };
        this.track.notes.push(n);
        this.hooks.preview(pitch, n.d);
        this.drag = { type: 'create', note: n, sx: x, moved: false, changed: true };
      }
      this.draw();
    }

    onMove(e) {
      const pt = this.local(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, pt);
      const d = this.drag;
      if (!d) {
        // マウスのカーソル形
        if (e.pointerType === 'mouse') {
          let cur = 'crosshair';
          if (pt.x < this.KEY_W) cur = 'pointer';
          else if (pt.y < this.RULER_H) cur = 'pointer';
          else if (this.tool === 'pan') cur = 'grab';
          else if (this.tool === 'erase') cur = 'not-allowed';
          else {
            const hit = this.hitTest(pt.x, pt.y);
            if (hit) cur = hit.edge ? 'ew-resize' : 'move';
          }
          this.canvas.style.cursor = cur;
        }
        return;
      }
      const { x, y } = pt;
      switch (d.type) {
        case 'pan2': {
          const pts = [...this.pointers.values()];
          if (pts.length < 2) return;
          const cx = (pts[0].x + pts[1].x) / 2;
          const cy = (pts[0].y + pts[1].y) / 2;
          this.wrap.scrollLeft = d.sl - (cx - d.cx);
          this.wrap.scrollTop = d.st - (cy - d.cy);
          return;
        }
        case 'pan':
          this.wrap.scrollLeft = d.sl - (x - d.sx);
          this.wrap.scrollTop = d.st - (y - d.sy);
          return;
        case 'seek': {
          this.cursorTick = this.snapFloor(this.tickAtX(x));
          this.hooks.seek(this.cursorTick);
          this.draw();
          return;
        }
        case 'key': {
          const p = this.pitchAtY(y);
          if (p !== d.p && p >= this.low && p <= this.high) {
            d.p = p;
            this.pressedKey = p;
            this.hooks.preview(p);
            this.draw();
          }
          return;
        }
        case 'erase':
          this.eraseAt(x, y);
          return;
        case 'create': {
          if (Math.abs(x - d.sx) > 6) d.moved = true;
          if (d.moved) {
            const end = Math.ceil(this.tickAtX(x) / this.snap) * this.snap;
            d.note.d = Math.max(this.snap, end - d.note.t);
            this.draw();
          }
          return;
        }
        case 'move': {
          const tick = this.tickAtX(x);
          const pitch = Math.max(this.low, Math.min(this.high, this.pitchAtY(y)));
          const dt = Math.round((tick - d.startTick) / this.snap) * this.snap;
          const dp = pitch - d.startPitch;
          if (!d.moved && Math.abs(x - d.sx) < 5 && dp === 0) return;
          d.moved = true;
          const newP = Math.max(this.low, Math.min(this.high, d.orig.p + dp));
          const newT = Math.max(0, d.orig.t + dt);
          if (newP !== d.note.p) this.hooks.preview(newP, 0.2);
          if (newP !== d.note.p || newT !== d.note.t) d.changed = true;
          d.note.p = newP;
          d.note.t = newT;
          this.draw();
          return;
        }
        case 'resize': {
          const end = Math.round(this.tickAtX(x) / this.snap) * this.snap;
          const nd = Math.max(this.snap, end - d.note.t);
          if (nd !== d.note.d) {
            d.note.d = nd;
            d.moved = true;
            d.changed = true;
            this.draw();
          }
          return;
        }
      }
    }

    onUp(e, cancelled) {
      this.pointers.delete(e.pointerId);
      const d = this.drag;
      if (!d) return;
      if (d.type === 'pan2') {
        if (this.pointers.size === 0) this.drag = null;
        return;
      }
      this.drag = null;
      if (d.type === 'key') {
        this.pressedKey = null;
        this.draw();
        return;
      }
      if (['create', 'move', 'resize', 'erase'].includes(d.type)) {
        if (cancelled) {
          this.hooks.endEdit(d.changed);
          return;
        }
        if (d.type === 'move' && !d.moved) {
          // タップ → 音符を消す
          const arr = this.track.notes;
          arr.splice(arr.indexOf(d.note), 1);
          d.changed = true;
        }
        this.hooks.endEdit(d.changed);
      }
    }

    cancelDrag() {
      const d = this.drag;
      if (!d) return;
      if (d.type === 'create') {
        const arr = this.track.notes;
        const i = arr.indexOf(d.note);
        if (i >= 0) arr.splice(i, 1);
        this.hooks.endEdit(false);
      } else if (d.type === 'move' || d.type === 'resize') {
        Object.assign(d.note, d.orig);
        this.hooks.endEdit(false);
      } else if (d.type === 'erase') {
        this.hooks.endEdit(d.changed);
      }
      this.drag = null;
      this.draw();
    }
  }

  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  MM.PianoRoll = PianoRoll;
})();
