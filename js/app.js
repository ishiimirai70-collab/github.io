/* おんがくメーカー: アプリ本体（画面の操作） */
(function () {
  'use strict';
  const MM = window.MM;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const player = MM.player;

  const LS_CURRENT = 'mm.current.v1';
  const LS_LIBRARY = 'mm.library.v1';
  const LS_PREFS = 'mm.prefs.v1';

  const KEY_NAMES = {
    '-7': '♭7 変ハ長調', '-6': '♭6 変ト長調', '-5': '♭5 変ニ長調', '-4': '♭4 変イ長調', '-3': '♭3 変ホ長調', '-2': '♭2 変ロ長調', '-1': '♭1 ヘ長調',
    0: 'なし ハ長調/イ短調', 1: '♯1 ト長調', 2: '♯2 ニ長調', 3: '♯3 イ長調', 4: '♯4 ホ長調', 5: '♯5 ロ長調', 6: '♯6 嬰ヘ長調', 7: '♯7 嬰ハ長調',
  };

  const state = {
    song: null,
    active: 0,
    undo: [],
    redo: [],
    snap: null,
    view: 'roll',
    baseLen: 12,
    dotted: false,
    triplet: false,
  };

  // ---- 保存 --------------------------------------------------------------
  const store = {
    get(k, def) {
      try {
        const v = localStorage.getItem(k);
        return v ? JSON.parse(v) : def;
      } catch (e) {
        return def;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
        return true;
      } catch (e) {
        return false;
      }
    },
  };
  let saveTimer = null;
  const autosave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set(LS_CURRENT, { song: state.song, active: state.active }), 400);
  };

  // ---- 確認・入力ダイアログ（ブラウザの confirm/prompt の代わり） ----------------
  function ask(message, opts = {}) {
    return new Promise((resolve) => {
      const d = $('#dlg-ask');
      $('#ask-msg').textContent = message;
      const input = $('#ask-input');
      input.hidden = opts.input == null;
      input.value = opts.input || '';
      $('#ask-ok').textContent = opts.ok || 'OK';
      $('#ask-ok').className = 'btn ' + (opts.danger ? 'danger' : 'accent');
      const done = (v) => {
        $('#ask-ok').onclick = $('#ask-cancel').onclick = null;
        d.onclose = null;
        if (d.open) d.close();
        resolve(v);
      };
      $('#ask-ok').onclick = () => done(opts.input == null ? true : input.value);
      $('#ask-cancel').onclick = () => done(opts.input == null ? false : null);
      d.onclose = () => done(opts.input == null ? false : null);
      input.onkeydown = (e) => {
        if (e.key === 'Enter') done(input.value);
      };
      d.showModal();
      if (!input.hidden) input.focus();
    });
  }

  // ---- トースト ------------------------------------------------------------
  let toastTimer = null;
  function toast(msg, ms = 2600) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  MM.toast = toast;

  // ---- 変更・元に戻す -------------------------------------------------------
  function pushUndo(snapshot) {
    state.undo.push(snapshot);
    if (state.undo.length > 200) state.undo.shift();
    state.redo = [];
    updateUndoButtons();
  }
  function checkpoint() {
    pushUndo(JSON.stringify(state.song));
  }
  function updateUndoButtons() {
    $('#btn-undo').disabled = !state.undo.length;
    $('#btn-redo').disabled = !state.redo.length;
  }
  function undo() {
    if (!state.undo.length) return;
    state.redo.push(JSON.stringify(state.song));
    loadSong(JSON.parse(state.undo.pop()), { keepHistory: true, keepScroll: true });
    updateUndoButtons();
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push(JSON.stringify(state.song));
    loadSong(JSON.parse(state.redo.pop()), { keepHistory: true, keepScroll: true });
    updateUndoButtons();
  }

  /** 曲データが変わったあとに呼ぶ */
  function changed() {
    MM.fitBars(state.song);
    roll.updateSize();
    roll.draw();
    renderTracks();
    syncSongFields();
    if (state.view === 'score') renderScore();
    player.updateSong(state.song);
    autosave();
  }

  function loadSong(song, opts = {}) {
    player.stop();
    state.song = MM.normalizeSong(song);
    if (!opts.keepHistory) {
      state.undo = [];
      state.redo = [];
    }
    state.active = Math.min(opts.active != null ? opts.active : state.active, state.song.tracks.length - 1);
    if (state.active < 0) state.active = 0;
    roll.setSong(state.song);
    if (!opts.keepScroll) {
      roll.cursorTick = 0;
      roll.wrap.scrollLeft = 0;
      roll.scrollToNotes();
    }
    renderTracks();
    syncSongFields();
    if (state.view === 'score') renderScore();
    updateUndoButtons();
    autosave();
  }

  function syncSongFields() {
    const s = state.song;
    if (document.activeElement !== $('#song-title')) $('#song-title').value = s.title;
    if (document.activeElement !== $('#bpm')) $('#bpm').value = s.bpm;
    const ts = s.timeSig.join('/');
    const sel = $('#timesig');
    if (![...sel.options].some((o) => o.value === ts)) sel.add(new Option(ts, ts));
    sel.value = ts;
    $('#keysig').value = String(s.keySig);
    if (document.activeElement !== $('#bars')) $('#bars').value = s.bars;
  }

  // ---- ピアノロール ----------------------------------------------------------
  const roll = new MM.PianoRoll($('#roll'), {
    activeTrack: () => state.active,
    beginEdit: () => {
      state.snap = JSON.stringify(state.song);
    },
    endEdit: (didChange) => {
      if (didChange && state.snap) pushUndo(state.snap);
      state.snap = null;
      changed();
    },
    preview: (p) => {
      const tr = state.song.tracks[state.active];
      player.preview(tr ? tr.instrument : 'piano', p, 0.4);
    },
    seek: (t) => {
      if (player.playing) player.play(state.song, t);
    },
  });

  // ---- トラック一覧 ----------------------------------------------------------
  function renderTracks() {
    const box = $('#tracks');
    box.innerHTML = '';
    state.song.tracks.forEach((tr, i) => {
      const el = document.createElement('div');
      el.className = 'track' + (i === state.active ? ' active' : '');
      el.style.setProperty('--tc', tr.color);
      const name = document.createElement('button');
      name.className = 'name';
      name.title = 'クリックで選ぶ / ダブルクリックで名前を変える';
      name.innerHTML = `<span class="dot" style="background:${tr.color}"></span><span></span><span class="count">${tr.notes.length}</span>`;
      name.children[1].textContent = tr.name;
      name.onclick = () => {
        if (state.active !== i) {
          state.active = i;
          renderTracks();
          roll.draw();
          autosave();
        }
      };
      name.ondblclick = () => renameTrack(i);
      el.appendChild(name);

      const sel = document.createElement('select');
      sel.title = '楽器';
      for (const inst of MM.INSTRUMENTS) sel.add(new Option(inst.name, inst.id));
      sel.value = tr.instrument;
      sel.onchange = () => {
        checkpoint();
        tr.instrument = sel.value;
        player.preview(tr.instrument, 60, 0.5);
        changed();
      };
      el.appendChild(sel);

      const vol = document.createElement('input');
      vol.type = 'range';
      vol.min = 0;
      vol.max = 1;
      vol.step = 0.05;
      vol.value = tr.volume;
      vol.title = '音量';
      vol.oninput = () => {
        tr.volume = Number(vol.value);
        player.updateSong(state.song);
        autosave();
      };
      el.appendChild(vol);

      const mute = document.createElement('button');
      mute.className = 'btn mini' + (tr.mute ? ' on' : '');
      mute.textContent = tr.mute ? '🔇' : '🔊';
      mute.title = 'ミュート（音を消す）';
      mute.onclick = () => {
        tr.mute = !tr.mute;
        changed();
      };
      el.appendChild(mute);

      const menu = document.createElement('button');
      menu.className = 'btn mini';
      menu.textContent = '✏️';
      menu.title = '名前を変える';
      menu.onclick = () => renameTrack(i);
      el.appendChild(menu);

      const del = document.createElement('button');
      del.className = 'btn mini';
      del.textContent = '✕';
      del.title = 'トラックを削除';
      del.onclick = async () => {
        if (state.song.tracks.length <= 1) return toast('トラックは1つ以上必要です');
        if (tr.notes.length && !(await ask(`「${tr.name}」を削除しますか？（↶で元に戻せます）`, { ok: '削除', danger: true }))) return;
        checkpoint();
        state.song.tracks.splice(i, 1);
        state.active = Math.max(0, Math.min(state.active, state.song.tracks.length - 1));
        changed();
      };
      el.appendChild(del);
      box.appendChild(el);
    });
    const add = document.createElement('button');
    add.className = 'btn add-track';
    add.textContent = '＋ トラック';
    add.title = 'トラック（パート）を追加';
    add.onclick = () => {
      checkpoint();
      const tr = MM.newTrack(state.song, null, 'piano');
      state.song.tracks.push(tr);
      state.active = state.song.tracks.length - 1;
      changed();
      toast('トラックを追加しました。楽器を選んで音符を置いてね');
    };
    box.appendChild(add);
  }

  async function renameTrack(i) {
    const tr = state.song.tracks[i];
    const v = await ask('トラックの名前', { input: tr.name, ok: '変更' });
    if (v && v.trim()) {
      checkpoint();
      tr.name = v.trim().slice(0, 30);
      changed();
    }
  }

  // ---- 再生 -------------------------------------------------------------------
  function play() {
    player.loop = $('#btn-loop').classList.contains('on');
    player.play(state.song, roll.cursorTick);
    $('#btn-play').textContent = '⏸';
    $('#btn-play').classList.add('playing');
  }
  function pause() {
    const t = player.currentTick();
    player.stop();
    if (t >= 0) roll.cursorTick = Math.floor(t / 3) * 3;
  }
  player.onStop = () => {
    $('#btn-play').textContent = '▶';
    $('#btn-play').classList.remove('playing');
    roll.playTick = -1;
    roll.draw();
    $('#score-playhead').classList.add('hidden');
  };
  player.onEnd = () => {
    roll.cursorTick = 0;
    roll.draw();
  };
  function togglePlay() {
    if (player.playing) pause();
    else play();
  }

  let lastTick = -1;
  function frame() {
    if (player.playing) {
      const t = player.currentTick();
      if (t !== lastTick) {
        lastTick = t;
        roll.playTick = t;
        if (state.view === 'roll') {
          roll.followPlayhead(t);
          roll.draw();
        } else updateScorePlayhead(t);
      }
    }
    requestAnimationFrame(frame);
  }

  // ---- 楽譜表示 ----------------------------------------------------------------
  let scoreInfo = null;
  function renderScore() {
    const box = $('#score');
    const width = Math.max(360, Math.min(1100, $('.score-scroll').clientWidth - 24));
    scoreInfo = MM.renderScore(state.song, { width });
    box.innerHTML = scoreInfo.svg;
  }
  function updateScorePlayhead(t) {
    const el = $('#score-playhead');
    if (!scoreInfo) return;
    const loc = scoreInfo.locate(t);
    if (!loc) return el.classList.add('hidden');
    const box = $('#score');
    el.classList.remove('hidden');
    el.style.left = box.offsetLeft + loc.x + 'px';
    el.style.top = box.offsetTop + loc.y0 + 'px';
    el.style.height = loc.y1 - loc.y0 + 'px';
    const sc = $('.score-scroll');
    const y = box.offsetTop + loc.y0;
    if (y < sc.scrollTop || y + (loc.y1 - loc.y0) > sc.scrollTop + sc.clientHeight) sc.scrollTop = y - 20;
  }
  function setView(v) {
    state.view = v;
    $$('#views .btn').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    $('#roll').classList.toggle('hidden', v !== 'roll');
    $('#score-view').classList.toggle('hidden', v !== 'score');
    if (v === 'score') renderScore();
    else {
      roll.resize();
    }
  }

  // ---- ツールバー ---------------------------------------------------------------
  function setTool(t) {
    roll.tool = t;
    $$('#tools .btn').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    const msg = {
      pen: '✏️ ます目をタップすると音符が置けます。ドラッグで長さ、音符をドラッグで移動、タップで削除。',
      erase: '🧽 音符をタップ（なぞる）と消えます。',
      pan: '✋ ドラッグで画面を動かせます（ペンのときも2本指で動かせます）。',
    }[t];
    $('#status').textContent = msg;
  }
  function updateLen() {
    let len = state.baseLen;
    if (state.dotted) len *= 1.5;
    if (state.triplet) len = (len * 2) / 3;
    roll.noteLen = Math.max(1, Math.round(len));
    $$('#lengths .note-btn').forEach((b) => b.classList.toggle('on', Number(b.dataset.len) === state.baseLen));
    $('#btn-dot').classList.toggle('on', state.dotted);
    $('#btn-triplet').classList.toggle('on', state.triplet);
  }
  function setSnap(v) {
    roll.snap = v;
    $('#snap').value = String(v);
    roll.draw();
  }

  function bindToolbar() {
    $('#btn-play').onclick = togglePlay;
    $('#btn-stop').onclick = () => {
      player.stop();
      roll.cursorTick = 0;
      roll.wrap.scrollLeft = 0;
      roll.draw();
    };
    $('#btn-loop').onclick = (e) => {
      e.currentTarget.classList.toggle('on');
      player.loop = e.currentTarget.classList.contains('on');
    };
    $('#song-title').addEventListener('change', (e) => {
      checkpoint();
      state.song.title = e.target.value.trim() || '無題';
      changed();
    });
    $('#bpm').addEventListener('change', (e) => {
      const v = Math.max(20, Math.min(400, Math.round(Number(e.target.value) || 120)));
      checkpoint();
      state.song.bpm = v;
      changed();
    });
    $('#timesig').addEventListener('change', (e) => {
      checkpoint();
      state.song.timeSig = e.target.value.split('/').map(Number);
      changed();
    });
    const ks = $('#keysig');
    for (let k = -7; k <= 7; k++) ks.add(new Option(KEY_NAMES[k], String(k)));
    ks.addEventListener('change', (e) => {
      checkpoint();
      state.song.keySig = Number(e.target.value);
      changed();
    });
    $('#bars').addEventListener('change', (e) => {
      const need = Math.ceil(MM.lastNoteEnd(state.song) / MM.barTicks(state.song));
      const req = Math.round(Number(e.target.value) || 1);
      checkpoint();
      state.song.bars = Math.max(1, need, Math.min(999, req));
      if (state.song.bars > req) toast('音符がある小節までは減らせません');
      changed();
    });
    $$('#tools .btn').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
    $$('#lengths .note-btn').forEach(
      (b) =>
        (b.onclick = () => {
          state.baseLen = Number(b.dataset.len);
          updateLen();
          if (!state.triplet && roll.snap > state.baseLen) setSnap(Math.max(3, state.baseLen));
        })
    );
    $('#btn-dot').onclick = () => {
      state.dotted = !state.dotted;
      if (state.dotted) state.triplet = false;
      updateLen();
    };
    $('#btn-triplet').onclick = () => {
      state.triplet = !state.triplet;
      if (state.triplet) state.dotted = false;
      updateLen();
      setSnap(state.triplet ? (state.baseLen <= 6 ? 2 : 4) : 3);
    };
    $('#snap').addEventListener('change', (e) => setSnap(Number(e.target.value)));
    $('#btn-zoom-in').onclick = () => roll.setZoom(1.35);
    $('#btn-zoom-out').onclick = () => roll.setZoom(1 / 1.35);
    $('#btn-undo').onclick = undo;
    $('#btn-redo').onclick = redo;
    $('#btn-clear').onclick = async () => {
      const tr = state.song.tracks[state.active];
      if (!tr.notes.length) return;
      if (!(await ask(`「${tr.name}」の音符を全部消しますか？（↶で元に戻せます）`, { ok: '全部消す', danger: true }))) return;
      checkpoint();
      tr.notes = [];
      changed();
    };
    $$('#views .btn').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
    $('#btn-print').onclick = () => window.print();
    $('#btn-svg').onclick = () => {
      if (!scoreInfo) renderScore();
      const svg = scoreInfo.svg.replace(/var\(--paper, #fff\)/g, '#fff').replace(/var\(--ink, #111\)/g, '#111');
      MM.download(MM.safeFileName(state.song.title) + '.svg', svg, 'image/svg+xml');
    };

    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (document.querySelector('dialog[open]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (!e.ctrlKey && !e.metaKey && /^[1-5]$/.test(e.key)) {
        state.baseLen = [48, 24, 12, 6, 3][Number(e.key) - 1];
        updateLen();
      }
    });
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => state.view === 'score' && renderScore(), 200);
    });
  }

  // ---- ダイアログ共通 -------------------------------------------------------------
  function openDialog(id) {
    const d = $(id);
    if (!d.open) d.showModal();
  }
  $$('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();
      if (e.target.closest('[data-close]')) d.close();
    });
    d.addEventListener('close', () => {
      if (tplPreviewing) {
        player.stop();
        tplPreviewing = null;
      }
    });
  });

  // ---- テンプレート ---------------------------------------------------------------
  let tplCat = 'classic';
  let tplPreviewing = null;
  function renderTemplates() {
    const tabs = $('#tpl-tabs');
    tabs.innerHTML = '';
    for (const c of MM.TEMPLATE_CATEGORIES) {
      const b = document.createElement('button');
      b.className = 'btn' + (c.id === tplCat ? ' on' : '');
      b.textContent = c.name;
      b.onclick = () => {
        tplCat = c.id;
        renderTemplates();
      };
      tabs.appendChild(b);
    }
    const grid = $('#tpl-grid');
    grid.innerHTML = '';
    for (const t of MM.TEMPLATES.filter((x) => x.cat === tplCat)) {
      const card = document.createElement('div');
      card.className = 'tpl-card';
      const h = document.createElement('h4');
      h.textContent = t.title;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${t.composer} ・ ${t.ts.join('/')}拍子 ・ ♩=${t.bpm} ・ ${t.tracks.length}パート`;
      const act = document.createElement('div');
      act.className = 'actions';
      const pv = document.createElement('button');
      pv.className = 'btn';
      pv.textContent = tplPreviewing === t.id ? '⏹ 止める' : '▶ 試聴';
      pv.onclick = () => {
        if (tplPreviewing === t.id) {
          player.stop();
          tplPreviewing = null;
        } else {
          player.loop = false;
          player.play(MM.buildTemplate(t), 0);
          tplPreviewing = t.id;
          const prevEnd = player.onEnd;
          player.onEnd = () => {
            tplPreviewing = null;
            renderTemplates();
            player.onEnd = prevEnd;
          };
        }
        renderTemplates();
      };
      const use = document.createElement('button');
      use.className = 'btn accent';
      use.textContent = 'この曲を使う';
      use.onclick = () => {
        player.stop();
        tplPreviewing = null;
        checkpoint();
        const undoStack = state.undo.slice();
        loadSong(MM.buildTemplate(t), { active: 0 });
        state.undo = undoStack;
        updateUndoButtons();
        $('#dlg-templates').close();
        toast(`「${t.title}」を読み込みました ▶で再生！（↶で前の曲に戻せます）`, 3500);
      };
      act.append(pv, use);
      card.append(h, meta, act);
      grid.appendChild(card);
    }
  }

  // ---- 読み込み -------------------------------------------------------------------
  let omrPages = null;
  let omrScales = [];

  function importMode() {
    return document.querySelector('input[name=import-mode]:checked').value;
  }

  function applyImported(song, label) {
    song = MM.normalizeSong(song);
    const undoStack = state.undo.concat([JSON.stringify(state.song)]);
    if (importMode() === 'add') {
      const cur = MM.clone(state.song);
      const base = cur.tracks.length;
      song.tracks.forEach((t, i) => {
        t.color = MM.TRACK_COLORS[(base + i) % MM.TRACK_COLORS.length];
        cur.tracks.push(t);
      });
      if (!cur.tracks.some((t) => t.notes.length)) {
        cur.bpm = song.bpm;
        cur.timeSig = song.timeSig;
        cur.keySig = song.keySig;
      }
      loadSong(cur, { active: base, keepScroll: false });
    } else {
      loadSong(song, { active: 0 });
    }
    state.undo = undoStack;
    state.redo = [];
    updateUndoButtons();
    $('#dlg-import').close();
    const count = state.song.tracks.reduce((a, t) => a + t.notes.length, 0);
    toast(`${label}を読み込みました（音符 ${count} 個）`, 3500);
  }

  function showBusy(msg) {
    const el = document.createElement('div');
    el.className = 'busy';
    el.textContent = msg;
    document.body.appendChild(el);
    return () => el.remove();
  }

  async function handleFile(file) {
    if (!file) return;
    const name = file.name || '';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const baseTitle = name.replace(/\.[^.]+$/, '');
    try {
      if (ext === 'mid' || ext === 'midi') {
        applyImported(MM.importMidi(await file.arrayBuffer(), { title: baseTitle, quantize: 1 }), 'MIDI');
      } else if (ext === 'mxl') {
        applyImported(MM.importMusicXML(await MM.readMxl(await file.arrayBuffer()), { title: baseTitle }), 'MusicXML');
      } else if (ext === 'musicxml' || ext === 'xml') {
        applyImported(MM.importMusicXML(await file.text(), { title: baseTitle }), 'MusicXML');
      } else if (ext === 'abc' || ext === 'txt') {
        applyImported(MM.importABC(await file.text()), 'ABC楽譜');
      } else if (ext === 'json') {
        const data = JSON.parse(await file.text());
        applyImported(data.song || data, '保存ファイル');
      } else if (ext === 'pdf' || file.type === 'application/pdf') {
        const done = showBusy('PDF を読み込み中…');
        try {
          const canvases = await MM.OMR.loadPdf(file);
          await runOmr(canvases, baseTitle);
        } finally {
          done();
        }
      } else if (file.type.startsWith('image/') || /^(png|jpe?g|gif|webp|bmp|heic)$/.test(ext)) {
        const done = showBusy('画像を読み込み中…');
        try {
          const c = await MM.OMR.loadImage(file);
          await runOmr([c], baseTitle);
        } finally {
          done();
        }
      } else {
        toast('このファイルの形式には対応していません');
      }
    } catch (err) {
      console.error(err);
      toast('読み込めませんでした: ' + err.message, 6000);
    }
  }

  async function runOmr(canvases, title) {
    const done = showBusy('🎼 楽譜を解析中…');
    await new Promise((r) => setTimeout(r, 50));
    try {
      omrPages = canvases.map((c) => MM.OMR.analyze(c));
    } finally {
      done();
    }
    omrPages.title = title;
    const total = omrPages.reduce((a, p) => a + p.notes.length, 0);
    const staves = omrPages.reduce((a, p) => a + p.staves.length, 0);
    $('#omr-mode').value = 'auto';
    const ts = MM.OMR.guessTimeSig(omrPages).join('/');
    if ([...$('#omr-ts').options].some((o) => o.value === ts)) $('#omr-ts').value = ts;
    $('#omr-key').value = String(MM.OMR.guessKey(omrPages));
    $('#omr-bpm').value = String(state.song.bpm || 100);
    $('#import-start').classList.add('hidden');
    $('#omr-panel').classList.remove('hidden');
    omrSong(); // 音名を計算してからプレビューを描く
    $('#omr-status').textContent = staves
      ? `✅ 五線 ${staves} 段・音符 ${total} 個を見つけました。調号などを確認して「読み込む」を押してね。`
      : '⚠️ 五線が見つかりませんでした。明るく、まっすぐ撮った楽譜の画像を使ってみてください。';
    drawOmrPages();
  }

  function drawOmrPages() {
    const box = $('#omr-pages');
    box.innerHTML = '';
    omrScales = [];
    omrPages.forEach((page, pi) => {
      const c = document.createElement('canvas');
      const maxW = Math.min(1600, Math.max(600, box.clientWidth * (window.devicePixelRatio || 1)));
      const s = MM.OMR.drawOverlay(page, c, { maxWidth: maxW });
      omrScales[pi] = s;
      c.onclick = (e) => {
        const r = c.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * c.width;
        const y = ((e.clientY - r.top) / r.height) * c.height;
        const n = MM.OMR.hitNote(page, x, y, s);
        if (n) {
          n.excluded = !n.excluded;
          omrSong();
          MM.OMR.drawOverlay(page, c, { maxWidth: maxW });
        }
      };
      box.appendChild(c);
    });
  }

  function omrSong() {
    return MM.OMR.toSong(omrPages, {
      mode: $('#omr-mode').value,
      keySig: Number($('#omr-key').value),
      bpm: Number($('#omr-bpm').value) || 100,
      timeSig: $('#omr-ts').value.split('/').map(Number),
      title: omrPages.title || '読み込んだ楽譜',
    });
  }

  function bindImport() {
    const drop = $('#drop');
    ['dragenter', 'dragover'].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add('over');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove('over');
      })
    );
    drop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
    // ページのどこにドロップしても読み込めるように
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files[0] && !e.target.closest('#drop')) {
        openImport();
        handleFile(e.dataTransfer.files[0]);
      }
    });
    $('#file-input').onchange = (e) => {
      handleFile(e.target.files[0]);
      e.target.value = '';
    };
    $('#camera-input').onchange = (e) => {
      handleFile(e.target.files[0]);
      e.target.value = '';
    };
    $('#btn-abc').onclick = () => {
      try {
        applyImported(MM.importABC($('#abc-text').value), 'ABC楽譜');
      } catch (err) {
        toast('読み込めませんでした: ' + err.message, 6000);
      }
    };
    // 設定を変えたら、読み取った音名を描き直す
    ['#omr-mode', '#omr-key', '#omr-ts'].forEach((q) =>
      $(q).addEventListener('change', () => {
        if (!omrPages) return;
        omrSong();
        drawOmrPages();
      })
    );
    const ok = $('#omr-key');
    for (let k = -7; k <= 7; k++) ok.add(new Option(KEY_NAMES[k], String(k)));
    $('#btn-omr-back').onclick = () => {
      player.stop();
      $('#omr-panel').classList.add('hidden');
      $('#import-start').classList.remove('hidden');
    };
    $('#btn-omr-preview').onclick = () => {
      if (player.playing) return player.stop();
      const s = omrSong();
      player.loop = false;
      player.play(s, 0);
    };
    $('#btn-omr-apply').onclick = () => {
      player.stop();
      const s = omrSong();
      if (!s.tracks.some((t) => t.notes.length)) return toast('読み込める音符がありません');
      applyImported(s, '楽譜の画像');
    };
  }

  function openImport() {
    $('#omr-panel').classList.add('hidden');
    $('#import-start').classList.remove('hidden');
    openDialog('#dlg-import');
  }

  // ---- 保存・開く ------------------------------------------------------------------
  function renderLibrary() {
    const lib = store.get(LS_LIBRARY, {});
    const ul = $('#lib');
    ul.innerHTML = '';
    const names = Object.keys(lib).sort((a, b) => (lib[b].saved || 0) - (lib[a].saved || 0));
    if (!names.length) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="hint">まだ保存した曲はありません</span>';
      ul.appendChild(li);
    }
    for (const n of names) {
      const li = document.createElement('li');
      const nm = document.createElement('span');
      nm.className = 'lib-name';
      nm.textContent = n;
      const dt = document.createElement('span');
      dt.className = 'lib-date';
      dt.textContent = lib[n].saved ? new Date(lib[n].saved).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' }) : '';
      const open = document.createElement('button');
      open.className = 'btn accent';
      open.textContent = '開く';
      open.onclick = () => {
        const undoStack = state.undo.concat([JSON.stringify(state.song)]);
        loadSong(lib[n].song, { active: 0 });
        state.undo = undoStack;
        updateUndoButtons();
        $('#dlg-file').close();
        toast(`「${n}」を開きました`);
      };
      const del = document.createElement('button');
      del.className = 'btn';
      del.textContent = '🗑';
      del.title = '削除';
      del.onclick = async () => {
        if (!(await ask(`「${n}」を削除しますか？`, { ok: '削除', danger: true }))) return;
        const l2 = store.get(LS_LIBRARY, {});
        delete l2[n];
        store.set(LS_LIBRARY, l2);
        renderLibrary();
      };
      li.append(nm, dt, open, del);
      ul.appendChild(li);
    }
  }

  function bindFile() {
    $('#btn-save').onclick = async () => {
      const name = ($('#save-name').value || state.song.title || '無題').trim().slice(0, 60);
      const lib = store.get(LS_LIBRARY, {});
      if (lib[name] && !(await ask(`「${name}」は既にあります。上書きしますか？`, { ok: '上書き' }))) return;
      lib[name] = { song: state.song, saved: Date.now() };
      if (!store.set(LS_LIBRARY, lib)) return toast('保存できませんでした。ブラウザの保存容量が足りないか、保存が許可されていません', 5000);
      renderLibrary();
      toast(`「${name}」を保存しました`);
    };
    $('#btn-export-json').onclick = () => {
      MM.download(MM.safeFileName(state.song.title) + '.json', JSON.stringify({ app: 'ongaku-maker', version: 1, song: state.song }, null, 1), 'application/json');
    };
    $('#btn-export-midi').onclick = () => {
      MM.download(MM.safeFileName(state.song.title) + '.mid', MM.exportMidi(state.song), 'audio/midi');
    };
    $('#btn-new').onclick = () => {
      const undoStack = state.undo.concat([JSON.stringify(state.song)]);
      loadSong(MM.newSong(), { active: 0 });
      state.undo = undoStack;
      updateUndoButtons();
      $('#dlg-file').close();
      toast('新しい曲を作りました（↶で前の曲に戻せます）');
    };
  }

  // ---- アプリとして使う（ホーム画面に追加・オフライン） ------------------------------
  function bindInstall() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (window.MM_ARTIFACT) return;
    // 長押しメニュー（コピーなど）を出さない。文字入力の欄だけは使える
    document.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('input, textarea, select')) e.preventDefault();
    });
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    if (standalone) return;
    let deferred = null;
    const btn = $('#btn-install');
    btn.hidden = false;
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    $('#install-ios').hidden = !ios && /Android/.test(ua);
    $('#install-android').hidden = ios;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      $('#btn-install-now').hidden = false;
    });
    window.addEventListener('appinstalled', () => {
      btn.hidden = true;
      $('#dlg-install').close();
      toast('アプリを追加しました！ホーム画面から開けます 🎉', 4000);
    });
    btn.onclick = () => openDialog('#dlg-install');
    $('#btn-install-now').onclick = async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
      $('#btn-install-now').hidden = true;
    };
  }

  // ---- 起動 ----------------------------------------------------------------------
  function init() {
    if (window.MM_ARTIFACT) {
      // 共有ページではダウンロード・印刷・カメラが使えないので隠す
      ['#btn-print', '#btn-svg', '#btn-export-json', '#btn-export-midi', '#camera-label', '#export-section'].forEach((q) => {
        const el = $(q);
        if (el) el.hidden = true;
      });
    }
    bindToolbar();
    bindInstall();
    bindImport();
    bindFile();
    $('#btn-templates').onclick = () => {
      renderTemplates();
      openDialog('#dlg-templates');
    };
    $('#btn-import').onclick = openImport;
    $('#btn-file').onclick = () => {
      $('#save-name').value = state.song.title;
      renderLibrary();
      openDialog('#dlg-file');
    };

    const prefs = store.get(LS_PREFS, {});
    const saved = store.get(LS_CURRENT, null);
    let first = false;
    if (saved && saved.song) loadSong(saved.song, { active: saved.active || 0 });
    else {
      first = true;
      loadSong(MM.newSong(), { active: 0 });
    }
    setTool('pen');
    state.baseLen = prefs.baseLen || 12;
    updateLen();
    setSnap(3);
    setView('roll');
    requestAnimationFrame(frame);
    if (first) {
      setTimeout(() => toast('ようこそ！ ます目をタップして音符を置いてみよう 🎵 「📚 テンプレート」で名曲も入れられます', 5000), 400);
    }
    window.addEventListener('beforeunload', () => store.set(LS_CURRENT, { song: state.song, active: state.active }));
  }

  init();
  MM.app = { state, loadSong, handleFile, runOmr, omrSong: () => omrSong(), get omrPages() { return omrPages; } };
})();
