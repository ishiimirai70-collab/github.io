/* おんがくメーカー: 音源（Web Audio シンセ）と再生 */
(function () {
  'use strict';
  const MM = window.MM;

  MM.INSTRUMENTS = [
    { id: 'piano', name: '🎹 ピアノ', gm: 0 },
    { id: 'epiano', name: '🎹 エレピ', gm: 4 },
    { id: 'musicbox', name: '🎁 オルゴール', gm: 10 },
    { id: 'organ', name: '⛪ オルガン', gm: 19 },
    { id: 'strings', name: '🎻 ストリングス', gm: 48 },
    { id: 'brass', name: '🎺 ブラス', gm: 61 },
    { id: 'flute', name: '🪈 フルート', gm: 73 },
    { id: 'guitar', name: '🎸 ギター', gm: 25 },
    { id: 'koto', name: '🎍 琴', gm: 107 },
    { id: 'bass', name: '🎸 ベース', gm: 33 },
    { id: 'square', name: '👾 ピコピコ(8bit)', gm: 80 },
    { id: 'triangle', name: '👾 8bitベース', gm: 81 },
  ];

  const freqOf = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /** 1音を鳴らす。戻り値は停止用の情報 */
  function voice(ctx, out, inst, midi, t0, dur, vel) {
    const f = freqOf(midi);
    const tEnd = t0 + Math.max(0.03, dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.connect(out);
    const srcs = [];
    const osc = (type, freq, gain, dest) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      let node = o;
      if (gain != null) {
        const og = ctx.createGain();
        og.gain.value = gain;
        o.connect(og);
        node = og;
      }
      node.connect(dest || g);
      srcs.push(o);
      return o;
    };
    let release = 0.08;
    const peak = 0.32 * vel;
    // 減衰音（ピアノ系）の共通エンベロープ
    const pluckEnv = (attack, decay, sustain) => {
      g.gain.linearRampToValueAtTime(peak, t0 + attack);
      g.gain.setTargetAtTime(peak * sustain, t0 + attack, decay);
    };
    const holdEnv = (attack, level) => {
      g.gain.linearRampToValueAtTime(peak * level, t0 + attack);
    };

    switch (inst) {
      case 'piano': {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(Math.min(12000, f * 10), t0);
        lp.frequency.setTargetAtTime(Math.min(8000, f * 3), t0 + 0.01, 0.4);
        lp.connect(g);
        osc('triangle', f, 0.9, lp);
        osc('sawtooth', f * 1.002, 0.18, lp);
        osc('sine', f * 2, 0.15, lp);
        const decay = 0.9 * Math.pow(261 / f, 0.35);
        pluckEnv(0.004, decay, 0.0);
        release = 0.12;
        break;
      }
      case 'epiano': {
        // FM エレピ
        const mod = ctx.createOscillator();
        const mg = ctx.createGain();
        mod.frequency.value = f;
        mg.gain.setValueAtTime(f * 1.4, t0);
        mg.gain.setTargetAtTime(f * 0.1, t0, 0.25);
        mod.connect(mg);
        const car = osc('sine', f, 1);
        mg.connect(car.frequency);
        srcs.push(mod);
        osc('sine', f * 2, 0.08);
        pluckEnv(0.005, 1.2, 0.0);
        release = 0.2;
        break;
      }
      case 'musicbox': {
        osc('sine', f, 1);
        osc('sine', f * 4, 0.12);
        osc('triangle', f * 2, 0.08);
        pluckEnv(0.002, 0.6, 0.0);
        release = 0.5;
        break;
      }
      case 'organ': {
        [1, 2, 3, 4, 6].forEach((h, i) => osc('sine', f * h, [0.6, 0.35, 0.2, 0.15, 0.08][i]));
        holdEnv(0.015, 0.75);
        release = 0.05;
        break;
      }
      case 'strings': {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.min(5000, f * 6);
        lp.connect(g);
        const a = osc('sawtooth', f * 0.997, 0.4, lp);
        const b = osc('sawtooth', f * 1.003, 0.4, lp);
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = 5.2;
        lg.gain.value = f * 0.004;
        lfo.connect(lg);
        lg.connect(a.frequency);
        lg.connect(b.frequency);
        srcs.push(lfo);
        holdEnv(0.12, 0.75);
        release = 0.3;
        break;
      }
      case 'brass': {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(f * 1.5, t0);
        lp.frequency.linearRampToValueAtTime(Math.min(7000, f * 7), t0 + 0.06);
        lp.frequency.setTargetAtTime(Math.min(5000, f * 4), t0 + 0.08, 0.2);
        lp.connect(g);
        osc('sawtooth', f, 0.6, lp);
        osc('square', f * 1.001, 0.15, lp);
        holdEnv(0.04, 0.7);
        release = 0.1;
        break;
      }
      case 'flute': {
        const o = osc('sine', f, 0.9);
        osc('triangle', f * 2, 0.06);
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = 5;
        lg.gain.setValueAtTime(0, t0);
        lg.gain.linearRampToValueAtTime(f * 0.006, t0 + 0.4);
        lfo.connect(lg);
        lg.connect(o.frequency);
        srcs.push(lfo);
        holdEnv(0.06, 0.8);
        release = 0.1;
        break;
      }
      case 'guitar':
      case 'koto': {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(Math.min(12000, f * (inst === 'koto' ? 14 : 8)), t0);
        lp.frequency.setTargetAtTime(f * 1.5, t0, inst === 'koto' ? 0.15 : 0.25);
        lp.Q.value = inst === 'koto' ? 4 : 1;
        lp.connect(g);
        osc('sawtooth', f, 0.6, lp);
        osc('square', f * 1.003, 0.2, lp);
        pluckEnv(0.002, inst === 'koto' ? 0.5 : 0.8, 0.0);
        release = 0.15;
        break;
      }
      case 'bass': {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(Math.min(3000, f * 8), t0);
        lp.frequency.setTargetAtTime(f * 2, t0, 0.12);
        lp.connect(g);
        osc('sawtooth', f, 0.7, lp);
        osc('sine', f, 0.6, lp);
        pluckEnv(0.005, 0.7, 0.35);
        release = 0.06;
        break;
      }
      case 'square': {
        osc('square', f, 0.35);
        holdEnv(0.005, 0.8);
        release = 0.02;
        break;
      }
      case 'triangle': {
        osc('triangle', f, 1);
        holdEnv(0.005, 0.95);
        release = 0.02;
        break;
      }
      default: {
        osc('triangle', f, 1);
        pluckEnv(0.005, 0.8, 0.2);
      }
    }
    g.gain.setTargetAtTime(0, tEnd, release / 3);
    const stopAt = tEnd + release * 2 + 0.05;
    srcs.forEach((s) => {
      s.start(t0);
      s.stop(stopAt);
    });
    return { g, srcs, end: stopAt };
  }

  class Player {
    constructor() {
      this.ctx = null;
      this.playing = false;
      this.loop = false;
      this.active = [];
      this.onEnd = null;
    }

    init() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    preview(inst, midi, dur = 0.35, vel = 0.8) {
      this.init();
      const v = voice(this.ctx, this.master, inst, midi, this.ctx.currentTime + 0.005, dur, vel);
      this.active.push(v);
    }

    _buildEvents(song) {
      const solo = song.tracks.some((t) => t.solo);
      this.trackGains = song.tracks.map((t) => {
        const gn = this.ctx.createGain();
        gn.gain.value = t.mute || (solo && !t.solo) ? 0 : t.volume;
        gn.connect(this.master);
        return gn;
      });
      const ev = [];
      song.tracks.forEach((t, ti) => {
        if (t.mute || (solo && !t.solo)) return;
        for (const n of t.notes) ev.push({ t: n.t, d: n.d, p: n.p, ti, inst: t.instrument });
      });
      ev.sort((a, b) => a.t - b.t);
      this.events = ev;
      this.tps = (song.bpm * MM.TPQ) / 60; // ticks / 秒
      this.endTick = Math.max(MM.barTicks(song), song.bars * MM.barTicks(song));
    }

    _indexFrom(tick) {
      let i = 0;
      while (i < this.events.length && this.events[i].t < tick) i++;
      return i;
    }

    play(song, fromTick = 0) {
      this.init();
      this.stop(true);
      this.song = song;
      this._buildEvents(song);
      if (fromTick >= this.endTick) fromTick = 0;
      const t0 = this.ctx.currentTime + 0.06;
      this.segments = [{ time: t0, tick: fromTick }];
      this.nextTick = fromTick;
      this.idx = this._indexFrom(fromTick);
      this.playing = true;
      this._timer = setInterval(() => this._schedule(), 25);
      this._schedule();
    }

    /** 再生中に曲が編集されたとき */
    updateSong(song) {
      if (!this.playing) return;
      const oldTps = this.tps;
      const oldGains = this.trackGains;
      this._buildEvents(song);
      oldGains.forEach((gn) => gn.gain.setTargetAtTime(0, this.ctx.currentTime + 0.3, 0.05));
      if (oldTps !== this.tps) {
        const seg = this.segments[this.segments.length - 1];
        const time = seg.time + (this.nextTick - seg.tick) / oldTps;
        this.segments.push({ time, tick: this.nextTick });
      }
      this.idx = this._indexFrom(this.nextTick);
    }

    _schedule() {
      if (!this.playing) return;
      const now = this.ctx.currentTime;
      const horizon = now + 0.15;
      for (let guard = 0; guard < 4; guard++) {
        const seg = this.segments[this.segments.length - 1];
        const hTick = seg.tick + (horizon - seg.time) * this.tps;
        const limit = this.endTick;
        const upto = Math.min(hTick, limit);
        while (this.idx < this.events.length && this.events[this.idx].t < upto) {
          const e = this.events[this.idx++];
          if (e.t < this.nextTick) continue;
          const when = seg.time + (e.t - seg.tick) / this.tps;
          const v = voice(this.ctx, this.trackGains[e.ti], e.inst, e.p, Math.max(when, now), e.d / this.tps, 0.8);
          this.active.push(v);
        }
        this.nextTick = upto;
        if (hTick >= limit) {
          const endTime = seg.time + (limit - seg.tick) / this.tps;
          if (this.loop) {
            this.segments.push({ time: endTime, tick: 0 });
            this.nextTick = 0;
            this.idx = 0;
            continue;
          } else if (now >= endTime + 0.05) {
            this.stop();
            if (this.onEnd) this.onEnd();
            return;
          }
        }
        break;
      }
      if (this.segments.length > 8) this.segments.splice(0, this.segments.length - 8);
      this.active = this.active.filter((v) => v.end > now);
    }

    currentTick() {
      if (!this.playing) return -1;
      const now = this.ctx.currentTime;
      let seg = this.segments[0];
      for (const s of this.segments) if (s.time <= now) seg = s;
      const t = seg.tick + Math.max(0, now - seg.time) * this.tps;
      return Math.min(t, this.endTick);
    }

    stop(silent) {
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
      this.playing = false;
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      for (const v of this.active) {
        try {
          v.g.gain.cancelScheduledValues(now);
          v.g.gain.setTargetAtTime(0, now, 0.015);
          v.srcs.forEach((s) => {
            try {
              s.stop(now + 0.08);
            } catch (e) {
              /* 既に停止済み */
            }
          });
        } catch (e) {
          /* ignore */
        }
      }
      this.active = [];
      if (!silent && this.onStop) this.onStop();
    }
  }

  MM.Player = Player;
  MM.player = new Player();
})();
