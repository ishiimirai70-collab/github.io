/* おんがくメーカー: 楽譜の画像・PDF から音符を読み取る（かんたん OMR）
 *
 * できること:
 *   - 五線を見つけて、黒い符頭(4分・8分・16分)と白い符頭(2分・全音符)を探す
 *   - 符尾・旗・連桁の本数から音の長さ、付点も推定
 *   - 調号はユーザーが選ぶ（臨時記号・休符は読み取らない）
 * 印刷されたきれいな楽譜（スキャン・スクリーンショット）で一番うまく動きます。
 */
(function () {
  'use strict';
  const MM = window.MM;
  const OMR = (MM.OMR = {});

  // ---- ファイル → canvas ---------------------------------------------------
  OMR.loadImage = (file) =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('画像を開けませんでした'));
      };
      img.src = url;
    });

  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('PDF 読み込み用のライブラリを取得できませんでした（インターネット接続を確認してください）'));
      document.head.appendChild(s);
    });
  }

  OMR.loadPdf = async (file, maxPages = 10) => {
    if (!window.pdfjsLib) {
      await loadScript(PDFJS + 'pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    }
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
      const page = await pdf.getPage(i);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, 2000 / vp0.width) });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      pages.push(c);
    }
    return pages;
  };

  // ---- 画像処理ヘルパー --------------------------------------------------------
  function otsu(gray) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, th = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) {
        best = v;
        th = i;
      }
    }
    return th;
  }

  function toBinary(canvas) {
    const W = canvas.width, H = canvas.height;
    const d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    const gray = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
      gray[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
    }
    // 明るさのムラに強い「局所しきい値」（Bradley 法）+ 全体のしきい値
    const glob = Math.min(215, otsu(gray) + 15);
    const ii = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let rs = 0;
      for (let x = 0; x < W; x++) {
        rs += gray[y * W + x];
        ii[(y + 1) * (W + 1) + x + 1] = ii[y * (W + 1) + x + 1] + rs;
      }
    }
    const r = Math.max(8, Math.round(Math.max(W, H) / 60));
    const bin = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
        const sum = ii[y1 * (W + 1) + x1] - ii[y0 * (W + 1) + x1] - ii[y1 * (W + 1) + x0] + ii[y0 * (W + 1) + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0));
        const v = gray[y * W + x];
        bin[y * W + x] = v < mean * 0.82 && v < glob ? 1 : 0;
      }
    }
    return { W, H, bin };
  }

  /** 傾き補正の角度（度）を推定 */
  function estimateSkew(img) {
    const { W, H, bin } = img;
    const step = Math.max(1, Math.round(W / 1000));
    const rows = new Float64Array(H + 400);
    const score = (a) => {
      const tan = Math.tan((a * Math.PI) / 180);
      rows.fill(0);
      for (let y = 0; y < H; y++) {
        const off = y * W;
        for (let x = 0; x < W; x += step) {
          if (bin[off + x]) {
            const yy = Math.round(y + x * tan) + 200;
            if (yy >= 0 && yy < rows.length) rows[yy]++;
          }
        }
      }
      let s2 = 0;
      for (let i = 0; i < rows.length; i++) s2 += rows[i] * rows[i];
      return s2;
    };
    let best = 0, bestScore = -1;
    for (let a = -5; a <= 5.001; a += 0.25) {
      const sc = score(a);
      if (sc > bestScore) {
        bestScore = sc;
        best = a;
      }
    }
    const c = best;
    for (let a = c - 0.25; a <= c + 0.25001; a += 0.025) {
      const sc = score(a);
      if (sc > bestScore) {
        bestScore = sc;
        best = a;
      }
    }
    return best;
  }

  function rotateCanvas(src, deg) {
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.translate(c.width / 2, c.height / 2);
    g.rotate((deg * Math.PI) / 180);
    g.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }

  function scaleCanvas(src, maxW, minW) {
    let s = 1;
    if (src.width > maxW) s = maxW / src.width;
    else if (src.width < minW) s = minW / src.width;
    if (s === 1) return src;
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * s);
    c.height = Math.round(src.height * s);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  // ---- 五線検出 ------------------------------------------------------------------
  function findStaves(img) {
    const { W, H, bin } = img;
    // 各行で一番長い横線の長さ（小さなすき間は無視）
    const rowCount = new Int32Array(H);
    const maxGap = Math.max(3, Math.round(W / 250));
    for (let y = 0; y < H; y++) {
      const off = y * W;
      let best = 0, start = -1, gap = 0;
      for (let x = 0; x < W; x++) {
        if (bin[off + x]) {
          if (start < 0) start = x;
          gap = 0;
          if (x - start + 1 > best) best = x - start + 1;
        } else if (start >= 0 && ++gap > maxGap) {
          start = -1;
          gap = 0;
        }
      }
      rowCount[y] = best;
    }
    const th = Math.max(60, W * 0.08);
    const lines = [];
    let y = 0;
    while (y < H) {
      if (rowCount[y] >= th) {
        const top = y;
        let cnt = rowCount[y++];
        // 長さが大きく違う行（連桁など）は別の線として扱う
        while (y < H && rowCount[y] >= th && rowCount[y] > cnt * 0.35 && rowCount[y] < cnt * 2.8) cnt = Math.max(cnt, rowCount[y++]);
        const bot = y - 1;
        lines.push({ y: (top + bot) / 2, top, bot, cnt });
      } else y++;
    }
    // 等間隔に並んだ5本の線を探す（間に連桁などが混ざっていてもよい）
    const staves = [];
    for (let i = 0; i < lines.length; i++) {
      let found = null;
      for (let j = i + 1; j < lines.length && lines[j].y - lines[i].y <= 60 && !found; j++) {
        const g = lines[j].y - lines[i].y;
        if (g < 4) continue;
        const idx = [i, j];
        let ok = true;
        for (let k = 2; k <= 4 && ok; k++) {
          const target = lines[i].y + k * g;
          let best = -1, bd = 1e9;
          for (let m = j + 1; m < lines.length && lines[m].y <= target + g * 0.25; m++) {
            const dd = Math.abs(lines[m].y - target);
            if (dd < bd) {
              bd = dd;
              best = m;
            }
          }
          if (best < 0 || bd > g * 0.2) ok = false;
          else idx.push(best);
        }
        if (!ok) continue;
        const L = idx.map((q) => lines[q]);
        const cmax = Math.max(...L.map((q) => q.cnt)), cmin = Math.min(...L.map((q) => q.cnt));
        if (cmin < cmax * 0.45) continue;
        found = L;
        i = idx[4];
      }
      if (found) {
        const d = (found[4].y - found[0].y) / 4;
        staves.push({ lines: found, d, top: found[0].y, bottom: found[4].y });
      }
    }
    // 横の範囲
    for (const st of staves) {
      const yy = Math.round(st.lines[2].y);
      let bestS = 0, bestE = 0, s = -1, gap = 0;
      const maxGap = Math.max(2, st.d * 0.5);
      for (let x = 0; x < W; x++) {
        let dark = 0;
        for (let k = -1; k <= 1; k++) dark |= bin[(yy + k) * W + x];
        if (dark) {
          if (s < 0) s = x;
          gap = 0;
          if (x - s > bestE - bestS) {
            bestS = s;
            bestE = x;
          }
        } else if (s >= 0 && ++gap > maxGap) {
          s = -1;
          gap = 0;
        }
      }
      st.x0 = bestS;
      st.x1 = bestE;
    }
    return staves.filter((st) => st.x1 - st.x0 > st.d * 10);
  }

  /** 五線を消した画像を作る（符頭と重なる部分は残す） */
  function removeStaffLines(img, staves) {
    const { W, bin } = img;
    const nb = bin.slice();
    for (const st of staves) {
      // 五線と、加線（上下4本ぶん）の位置
      const th = Math.max(...st.lines.map((L) => L.bot - L.top));
      const rows = st.lines.map((L) => ({ top: L.top, bot: L.bot }));
      for (let j = 1; j <= 4; j++) {
        for (const yc of [st.lines[0].y - j * st.d, st.lines[4].y + j * st.d]) {
          rows.push({ top: Math.round(yc - th / 2) - 1, bot: Math.round(yc + th / 2) + 1 });
        }
      }
      for (const L of rows) {
        const top = L.top, bot = L.bot;
        const reach = 1;
        if (top - reach - 2 < 0 || bot + reach + 2 >= img.H) continue;
        for (let x = st.x0 - 2; x <= st.x1 + 2; x++) {
          if (x < 0 || x >= W) continue;
          const above = bin[(top - reach - 1) * W + x];
          const below = bin[(bot + reach + 1) * W + x];
          if (!above && !below) {
            for (let yy = top - 1; yy <= bot + 1; yy++) nb[yy * W + x] = 0;
          }
        }
      }
    }
    return nb;
  }

  function integral(W, H, arr) {
    const ii = new Int32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let rs = 0;
      const off = y * W;
      const o1 = (y + 1) * (W + 1), o0 = y * (W + 1);
      for (let x = 0; x < W; x++) {
        rs += arr[off + x];
        ii[o1 + x + 1] = ii[o0 + x + 1] + rs;
      }
    }
    return ii;
  }

  // ---- 符頭検出 ------------------------------------------------------------------
  function analyzeStaff(img, nb, ii, st) {
    const { W, H } = img;
    const d = st.d;
    const a = d * 0.62, b = d * 0.46; // 楕円の半径
    const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? nb[y * W + x] : 0);
    const boxSum = (x0, y0, x1, y1) => {
      x0 = Math.max(0, Math.floor(x0));
      y0 = Math.max(0, Math.floor(y0));
      x1 = Math.min(W, Math.ceil(x1));
      y1 = Math.min(H, Math.ceil(y1));
      if (x1 <= x0 || y1 <= y0) return { s: 0, n: 1 };
      const w1 = W + 1;
      const s = ii[y1 * w1 + x1] - ii[y0 * w1 + x1] - ii[y1 * w1 + x0] + ii[y0 * w1 + x0];
      return { s, n: (x1 - x0) * (y1 - y0) };
    };
    const ratio = (x0, y0, x1, y1) => {
      const r = boxSum(x0, y0, x1, y1);
      return r.s / r.n;
    };
    // 楕円のサンプル点
    const core = [], ring = [];
    for (let dy = -Math.ceil(b); dy <= Math.ceil(b); dy++) {
      for (let dx = -Math.ceil(a); dx <= Math.ceil(a); dx++) {
        const r = (dx * dx) / (a * a) + (dy * dy) / (b * b);
        if (r <= 0.3) core.push([dx, dy]);
        else if (r >= 0.55 && r <= 1.0) ring.push([dx, dy]);
      }
    }
    // 白い符頭: 中心から8方向に線をのばし、輪郭（インク）に囲まれているか調べる
    const DIRS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const t = (i * Math.PI) / 4;
      const ca = Math.cos(t), sa = -Math.sin(t);
      const rr = 1 / Math.sqrt((ca * ca) / (a * a) + (sa * sa) / (b * b));
      return { ca, sa, max: rr * 1.35 + 1 };
    });
    const castRay = (cx, cy, dir) => {
      let hit = -1;
      for (let r = 1; r <= dir.max; r++) {
        if (at(Math.round(cx + dir.ca * r), Math.round(cy + dir.sa * r))) {
          hit = r;
          break;
        }
      }
      if (hit < 0) return null;
      // 輪郭は細いはず（塗りつぶしの中ではない）
      for (let r = hit; r <= hit + d * 0.55; r++) {
        if (!at(Math.round(cx + dir.ca * r), Math.round(cy + dir.sa * r))) return hit;
      }
      return null;
    };
    // 五線・加線の行（白い符頭の中を横切る線を無視するため）
    const band = new Uint8Array(H);
    {
      const th = Math.max(...st.lines.map((L) => L.bot - L.top));
      const ys = st.lines.map((L) => L.y);
      for (let j = 1; j <= 4; j++) ys.push(st.lines[0].y - j * d, st.lines[4].y + j * d);
      for (const yc of ys) for (let y = Math.round(yc - th / 2) - 1; y <= Math.round(yc + th / 2) + 1; y++) if (y >= 0 && y < H) band[y] = 1;
    }
    const at3 = (x, y) => (y >= 0 && y < H && band[y] ? 0 : at(x, y));
    const castRay3 = (cx, cy, dir) => {
      let hit = -1;
      for (let r = 1; r <= dir.max; r++) {
        if (at3(Math.round(cx + dir.ca * r), Math.round(cy + dir.sa * r))) {
          hit = r;
          break;
        }
      }
      if (hit < 0) return null;
      for (let r = hit; r <= hit + d * 0.55; r++) {
        const yy = Math.round(cy + dir.sa * r);
        if (!at(Math.round(cx + dir.ca * r), yy) && !band[yy]) return hit;
      }
      return null;
    };
    const hollowTest = (cx, cy) => {
      const r1 = hollowEval(cx, cy, false);
      const r2 = band[cy] || band[cy - 2] || band[cy + 2] ? hollowEval(cx, cy, true) : null;
      return r1 == null ? r2 : r2 == null ? r1 : Math.max(r1, r2);
    };
    const hollowEval = (cx, cy, useBand) => {
      let h;
      if (!useBand) {
        if (at(cx, cy) || at(cx - 1, cy) || at(cx + 1, cy)) return null;
        h = DIRS.map((dir) => castRay(cx, cy, dir));
      } else {
        if (at3(cx, cy) || at3(cx - 1, cy) || at3(cx + 1, cy)) return null;
        h = DIRS.map((dir, i) => (i % 4 === 0 ? null : castRay3(cx, cy, dir)));
        // 横方向: 線の行の上下で調べる
        for (const i of [0, 4]) {
          if (!band[cy]) {
            h[i] = castRay(cx, cy, DIRS[i]);
            continue;
          }
          let yu = cy, yd = cy;
          while (yu > 0 && band[yu]) yu--;
          while (yd < H - 1 && band[yd]) yd++;
          const u = cy - yu <= b * 0.6 ? castRay(cx, yu, DIRS[i]) : null;
          const v = yd - cy <= b * 0.6 ? castRay(cx, yd, DIRS[i]) : null;
          h[i] = u != null && v != null ? Math.max(u, v) : u != null ? u : v;
        }
      }
      const [E, NE, N, NW, Wd, SW, S, SE] = h;
      if (E == null || Wd == null) return null;
      if (E < d * 0.22 || Wd < d * 0.22) return null;
      const up = [NE, N, NW].filter((v) => v != null).length;
      const dn = [SW, S, SE].filter((v) => v != null).length;
      if (up < 2 || dn < 2) return null;
      // 楕円の内側なら、斜め方向の壁は横方向より近い（縦線にはさまれたすき間ではない）
      const diags = [NE, NW, SW, SE].filter((v) => v != null);
      if (diags.length < 3) return null;
      const horiz = (E + Wd) / 2;
      if (diags.reduce((x, y) => x + y, 0) / diags.length > horiz * 0.95) return null;
      if ((N != null && N > horiz * 0.95) || (S != null && S > horiz * 0.95)) return null;
      const vN = N != null ? N : Math.min(NE || 99, NW || 99);
      const vS = S != null ? S : Math.min(SE || 99, SW || 99);
      if (vN > b * 1.4 || vS > b * 1.4) return null;
      return 1 - (Math.abs(E - Wd) + Math.abs(vN - vS)) / d;
    };
    const frac = (pts, cx, cy) => {
      let s = 0;
      for (const [dx, dy] of pts) s += at(cx + dx, cy + dy);
      return s / pts.length;
    };

    // 音部記号などのヘッダー部分をスキップ
    const bandTop = st.top - d * 3, bandBot = st.bottom + d * 3;
    const colDark = (x) => boxSum(x, bandTop, x + 1, bandBot).s;
    let x = st.x0;
    let clusters = 0;
    let headerEnd = st.x0;
    while (x < st.x1 && clusters < 2) {
      while (x < st.x1 && colDark(x) === 0) x++;
      const s = x;
      let empty = 0;
      while (x < st.x1 && empty < Math.max(3, d * 0.6)) {
        empty = colDark(x) === 0 ? empty + 1 : 0;
        x++;
      }
      const w = x - s - empty;
      if (w < d * 0.5 && clusters === 0) continue; // 先頭の縦線
      headerEnd = x;
      clusters++;
      break;
    }
    st.headerEnd = headerEnd;

    const cands = [];
    const levels = [];
    for (let k = -9; k <= 17; k++) levels.push(k);
    const ys = [0, -1, 1, -2, 2];
    for (const k of levels) {
      const baseY = st.bottom - (k * d) / 2;
      if (baseY - b < 0 || baseY + b >= H) continue;
      for (let cx = Math.round(headerEnd + a); cx < st.x1 - a * 0.5; cx++) {
        // 早めのふるい落とし
        const bx = ratio(cx - a, baseY - b, cx + a, baseY + b);
        if (bx < 0.12) continue;
        let best = null;
        for (const oy of ys) {
          const cy = Math.round(baseY + oy * Math.max(1, d / 12));
          const c = frac(core, cx, cy);
          const r = frac(ring, cx, cy);
          if (c >= 0.85 && r >= 0.62) {
            const sc = c + r;
            if (!best || sc > best.score) best = { cx, cy, k, score: sc, filled: true };
          } else if (c <= 0.6) {
            const hs = hollowTest(cx, cy);
            if (hs != null && (!best || hs > best.score)) best = { cx, cy, k, score: hs, filled: false };
          }
        }
        if (!best) continue;
        // 横の連続（連桁など）を除外
        const side = Math.max(ratio(cx + a * 1.25, best.cy - b * 0.35, cx + a * 1.8, best.cy + b * 0.35), 0);
        const side2 = Math.max(ratio(cx - a * 1.8, best.cy - b * 0.35, cx - a * 1.25, best.cy + b * 0.35), 0);
        if ((side > 0.55 && side2 > 0.55) || side > 0.8 || side2 > 0.8) continue; // 連桁の端など
        cands.push(best);
      }
    }
    // 近いものをまとめる（スコアの高い順）
    cands.sort((p, q) => q.filled - p.filled || q.score - p.score);
    const heads = [];
    for (const c of cands) {
      if (heads.some((h) => Math.abs(h.cx - c.cx) < a * 1.3 && Math.abs(h.k - c.k) <= 1)) continue;
      heads.push(c);
    }

    // 符尾・旗・付点
    const runV = (x0, y0, dir, maxLen) => {
      let len = 0, gap = 0, y = y0;
      for (let i = 0; i < maxLen; i++, y += dir) {
        const v = at(x0, y) || at(x0 - 1, y) || at(x0 + 1, y);
        if (v) {
          len = i + 1;
          gap = 0;
        } else if (++gap > 2) break;
      }
      return len;
    };
    const countRuns = (x0, y0, dir, len) => {
      let runs = 0, inRun = 0, y = y0;
      const minT = Math.max(1, d * 0.2), maxT = d * 1.1;
      let longRun = false;
      for (let i = 0; i < len; i++, y += dir) {
        if (at(x0, y)) inRun++;
        else {
          if (inRun >= minT && inRun <= maxT) runs++;
          if (inRun > maxT) longRun = true;
          inRun = 0;
        }
      }
      if (inRun >= minT && inRun <= maxT) runs++;
      return longRun ? -1 : runs;
    };

    const out = [];
    for (const h of heads) {
      const { cx, cy } = h;
      let stem = null;
      // 上向き（右側）
      for (let sx = Math.round(cx + a - d * 0.35); sx <= Math.round(cx + a + d * 0.2); sx++) {
        const len = runV(sx, Math.round(cy - b * 0.3), -1, Math.round(d * 5));
        if (len >= d * 2.2 && (!stem || len > stem.len)) stem = { x: sx, len, dir: -1 };
      }
      for (let sx = Math.round(cx - a - d * 0.2); sx <= Math.round(cx - a + d * 0.35); sx++) {
        const len = runV(sx, Math.round(cy + b * 0.3), 1, Math.round(d * 5));
        if (len >= d * 2.2 && (!stem || len > stem.len)) stem = { x: sx, len, dir: 1 };
      }
      if (h.filled && !stem) continue; // 黒い符頭には必ず符尾がある
      if (!h.filled && !stem) {
        // 全音符: 上下に大きな記号（拍子記号の数字など）がつながっていないか
        let ink = 0, cols = 0;
        for (let xx = Math.round(cx - a * 0.8); xx <= Math.round(cx + a * 0.8); xx++) {
          cols++;
          for (let yy = Math.round(st.top - d); yy <= Math.round(st.bottom + d); yy++) {
            if (Math.abs(yy - cy) <= b * 1.15) continue;
            ink += at(xx, yy);
          }
        }
        if (ink / cols > d * 0.7) continue;
      }
      let beams = 0;
      if (stem) {
        const tipY = Math.round(cy + stem.dir * (b * 0.3 + stem.len));
        const scanLen = Math.round(d * 2.6);
        let best = 0;
        for (const off of [0.55, 0.8]) {
          for (const side of [1, -1]) {
            const r = countRuns(Math.round(stem.x + side * d * off), tipY + stem.dir * Math.round(d * 0.3), -stem.dir, scanLen);
            if (r > best) best = r;
          }
        }
        beams = Math.min(3, best);
        h.stem = stem;
        h.tipY = tipY;
      }
      // 付点: 符頭の右にある、小さく丸い独立した点
      let dotted = false;
      {
        const rx0 = Math.round(cx + a + d * 0.15), rx1 = Math.round(cx + a + d * 1.2);
        const ry0 = Math.round(cy - d * 0.95), ry1 = Math.round(cy + d * 0.55);
        const rw = rx1 - rx0 + 1, rh = ry1 - ry0 + 1;
        const seen = new Uint8Array(rw * rh);
        for (let j = 0; j < rh && !dotted; j++) {
          for (let i = 0; i < rw && !dotted; i++) {
            if (seen[j * rw + i] || !at(rx0 + i, ry0 + j)) continue;
            if (stem && stem.dir === -1 && Math.abs(rx0 + i - stem.x) <= 2) continue;
            // 塗りつぶし（連結成分）
            const stack = [[i, j]];
            seen[j * rw + i] = 1;
            let cnt = 0, minx = i, maxx = i, miny = j, maxy = j, edge = false;
            while (stack.length) {
              const [u, v] = stack.pop();
              cnt++;
              if (u === 0 || v === 0 || u === rw - 1 || v === rh - 1) edge = true;
              minx = Math.min(minx, u);
              maxx = Math.max(maxx, u);
              miny = Math.min(miny, v);
              maxy = Math.max(maxy, v);
              for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const uu = u + du, vv = v + dv;
                if (uu < 0 || vv < 0 || uu >= rw || vv >= rh || seen[vv * rw + uu]) continue;
                if (!at(rx0 + uu, ry0 + vv)) continue;
                seen[vv * rw + uu] = 1;
                stack.push([uu, vv]);
              }
            }
            const w = maxx - minx + 1, hh = maxy - miny + 1;
            if (!edge && cnt >= d * d * 0.04 && cnt <= d * d * 0.4 && w <= d * 0.65 && hh <= d * 0.65 && w >= d * 0.15 && hh >= d * 0.15 && Math.max(w, hh) / Math.min(w, hh) < 2) dotted = true;
          }
        }
      }
      let dur;
      if (!h.filled) dur = stem ? 24 : 48;
      else dur = beams >= 2 ? 3 : beams === 1 ? 6 : 12;
      if (dotted) dur *= 1.5;
      out.push({ x: cx, y: cy, k: h.k, filled: h.filled, stem: !!stem, beams, dotted, dur, staff: st });
    }
    st.barlines = detectBarlines(st, out, at, headerEnd);
    return out.sort((p, q) => p.x - q.x);
  }

  /** 小節線を探す: 第1線から第5線までをつなぐ細い縦線で、近くに符頭がないもの */
  function detectBarlines(st, heads, at, headerEnd) {
    const d = st.d;
    const midY = Math.round(st.lines[2].y);
    const run = (x, dir) => {
      let y = midY, gap = 0, last = midY;
      for (let i = 0; i < d * 12; i++, y += dir) {
        if (at(x, y)) {
          last = y;
          gap = 0;
        } else if (++gap > Math.max(2, d * 0.15)) break;
      }
      return last;
    };
    const xs = [];
    for (let x = Math.round(headerEnd); x <= st.x1 + 1; x++) {
      if (!at(x, midY)) continue;
      const top = run(x, -1);
      // 上下にはみ出すのは、となりの段とつながる小節線（大譜表）の場合だけ
      if (top > st.top + d * 0.25 || (top < st.top - d * 0.7 && top > st.top - d * 3)) continue;
      const bot = run(x, 1);
      if (bot < st.bottom - d * 0.25 || (bot > st.bottom + d * 0.7 && bot < st.bottom + d * 3)) continue;
      // 太さ: 細い線だけ
      let w = 0;
      while (w < d && at(x + w, midY - Math.round(d * 0.5))) w++;
      if (w > d * 0.6) continue;
      if (heads.some((h) => Math.abs(h.x - x) < d * 1.1)) continue;
      xs.push(x);
    }
    // 近いものをまとめる
    const bars = [];
    for (const x of xs) {
      const last = bars[bars.length - 1];
      if (last && x - last.x1 <= d * 0.9) last.x1 = x;
      else bars.push({ x0: x, x1: x });
    }
    return bars.map((b) => (b.x0 + b.x1) / 2);
  }

  // ---- メイン -------------------------------------------------------------------
  /**
   * 1ページ分の画像を解析する
   * @returns {{canvas, staves, notes, scale}}
   */
  function prepare(srcCanvas, minW) {
    let canvas = scaleCanvas(srcCanvas, 2400, minW);
    let img = toBinary(canvas);
    const skew = estimateSkew(img);
    if (Math.abs(skew) >= 0.05) {
      canvas = rotateCanvas(canvas, skew);
      img = toBinary(canvas);
    }
    let staves = findStaves(img);
    // 五線の間隔が小さすぎる → 拡大してやり直し
    if (staves.length && staves[0].d < 12) {
      const factor = Math.min(3, 16 / staves[0].d);
      const c2 = scaleCanvas(canvas, canvas.width * factor, canvas.width * factor);
      const img2 = toBinary(c2);
      const st2 = findStaves(img2);
      if (st2.length >= staves.length) {
        canvas = c2;
        img = img2;
        staves = st2;
      }
    }
    return { canvas, img, staves, skew };
  }

  OMR.analyze = function (srcCanvas) {
    let prep = prepare(srcCanvas, 1000);
    // 小さい画像は、拡大したほうが五線がよく見つかることがある
    for (const w of [1800, 2400]) {
      if (srcCanvas.width >= w) break;
      const p2 = prepare(srcCanvas, w);
      if (p2.staves.length > prep.staves.length) prep = p2;
    }
    const { canvas, img, staves, skew } = prep;
    const nb = removeStaffLines(img, staves);
    const ii = integral(img.W, img.H, nb);
    const notes = [];
    staves.forEach((st, i) => {
      st.index = i;
      for (const n of analyzeStaff(img, nb, ii, st)) notes.push(n);
    });
    return { canvas, staves, notes, skew };
  };

  /** 大譜表（ト音＋ヘ音のペア）かどうか推測 */
  OMR.guessGrand = function (pages) {
    const all = [];
    pages.forEach((p) => p.staves.forEach((s) => all.push(s)));
    if (all.length < 2 || all.length % 2) return false;
    let ok = 0, n = 0;
    for (const p of pages) {
      for (let i = 0; i + 1 < p.staves.length; i += 2) {
        const g1 = p.staves[i + 1].top - p.staves[i].bottom;
        const g2 = p.staves[i + 2] ? p.staves[i + 2].top - p.staves[i + 1].bottom : null;
        n++;
        if (g2 == null ? g1 < p.staves[i].d * 12 : g1 < g2 * 0.85) ok++;
      }
    }
    return ok === n;
  };

  const TREBLE_BASE = 30; // E4 (第1線)
  const BASS_BASE = 18; // G2 (第1線)

  function pitchOf(k, clef, alters) {
    const dn = (clef === 'bass' ? BASS_BASE : TREBLE_BASE) + k;
    const step = ((dn % 7) + 7) % 7;
    const oct = Math.floor(dn / 7);
    return (oct + 1) * 12 + MM.DIATONIC_SEMI[step] + alters[step];
  }

  /** 音価の並びから拍子を推測 */
  OMR.guessTimeSig = function (pages) {
    const counts = new Map();
    for (const page of pages) {
      for (const m of measuresOf(page, OMR.guessGrand(pages) ? 'grand' : 'treble')) {
        const sum = m.clusters.reduce((a, c) => a + c.dur, 0);
        if (sum > 0) counts.set(sum, (counts.get(sum) || 0) + 1);
      }
    }
    const MAP = { 18: [3, 8], 24: [2, 4], 36: [3, 4], 48: [4, 4] };
    let best = null, bestN = 0;
    for (const [sum, n] of counts) if (MAP[sum] && n > bestN) {
      best = MAP[sum];
      bestN = n;
    }
    return best || [4, 4];
  };

  /** 段ごと・小節ごとに音をまとめる */
  function measuresOf(page, mode) {
    const grand = mode === 'grand';
    const systems = [];
    if (grand) for (let i = 0; i < page.staves.length; i += 2) systems.push(page.staves.slice(i, i + 2));
    else page.staves.forEach((st) => systems.push([st]));
    const out = [];
    for (const sys of systems) {
      const d = sys[0].d;
      const ns = page.notes.filter((n) => !n.excluded && sys.includes(n.staff)).sort((p, q) => p.x - q.x);
      // 小節線（大譜表では両方の段で見つかったものを優先）
      let bars = sys[0].barlines || [];
      if (sys[1] && sys[1].barlines) {
        const both = bars.filter((x) => sys[1].barlines.some((y) => Math.abs(x - y) < d));
        if (both.length) bars = both;
      }
      const x0 = Math.max(...sys.map((st) => st.headerEnd || st.x0));
      const bounds = [x0].concat(bars.filter((x) => x > x0 + d));
      const x1 = sys[0].x1;
      if (bounds[bounds.length - 1] < x1 - d * 1.5) bounds.push(x1);
      for (let i = 0; i + 1 < bounds.length; i++) {
        const mn = ns.filter((n) => n.x >= bounds[i] && n.x < bounds[i + 1]);
        const clusters = [];
        for (const n of mn) {
          const c = clusters[clusters.length - 1];
          if (c && n.x - c.x < d * 0.7) c.notes.push(n);
          else clusters.push({ x: n.x, notes: [n] });
        }
        for (const c of clusters) c.dur = Math.min(...c.notes.map((n) => Math.round(n.dur)));
        out.push({ sys, x0: bounds[i], x1: bounds[i + 1], clusters, d });
      }
    }
    return out;
  }
  OMR.measuresOf = measuresOf;

  /**
   * 解析結果を曲データにする
   * opts: { mode: 'treble'|'bass'|'grand', keySig, bpm, timeSig, title }
   */
  OMR.toSong = function (pages, opts) {
    const alters = [0, 0, 0, 0, 0, 0, 0];
    const SO = [3, 0, 4, 1, 5, 2, 6];
    const ks = opts.keySig || 0;
    if (ks > 0) for (let i = 0; i < ks; i++) alters[SO[i]] = 1;
    if (ks < 0) for (let i = 0; i < -ks; i++) alters[SO[6 - i]] = -1;

    const song = { title: opts.title || '読み込んだ楽譜', bpm: opts.bpm || 100, timeSig: opts.timeSig || [4, 4], keySig: ks, bars: 1, tracks: [] };
    const barT = MM.barTicks(song);
    const grand = opts.mode === 'grand';
    const rh = MM.newTrack(song, grand ? '右手' : 'メロディ', 'piano');
    song.tracks.push(rh);
    let lh = null;
    if (grand) {
      lh = MM.newTrack(song, '左手', 'piano');
      song.tracks.push(lh);
    }
    let t = 0;
    let first = true;
    for (const page of pages) {
      for (const m of measuresOf(page, opts.mode)) {
        const cl = m.clusters;
        if (!cl.length) {
          if (!first) t += barT; // 全休符の小節
          continue;
        }
        const sum = cl.reduce((a, c) => a + c.dur, 0);
        // 足りない分は休符。すき間が大きいところに入れる
        const extra = new Array(cl.length + 1).fill(0);
        let deficit = barT - sum;
        if (deficit > 0) {
          if (first) extra[0] = deficit; // 弱起（アウフタクト）
          else {
            const unit = Math.max(3, Math.min(...cl.map((c) => c.dur)));
            const gaps = cl.map((c, i) => (i + 1 < cl.length ? cl[i + 1].x : m.x1 - m.d * 0.8) - c.x);
            const g0 = cl[0].x - m.x0 - m.d * 1.6;
            let guard = 0;
            while (deficit > 0 && guard++ < 64) {
              let bi = -1, bv = -Infinity;
              const w0 = g0 / (unit + extra[0]);
              if (w0 > bv) {
                bv = w0;
                bi = 0;
              }
              for (let i = 0; i < cl.length; i++) {
                const w = gaps[i] / (cl[i].dur + extra[i + 1]);
                if (w > bv) {
                  bv = w;
                  bi = i + 1;
                }
              }
              const u = Math.min(unit, deficit);
              extra[bi] += u;
              deficit -= u;
            }
          }
        }
        let tt = t + extra[0];
        cl.forEach((c, i) => {
          for (const n of c.notes) {
            const role = grand ? (m.sys.indexOf(n.staff) === 0 ? 'treble' : 'bass') : opts.mode;
            const p = pitchOf(n.k, role, alters);
            const target = grand && role === 'bass' ? lh : rh;
            if (!target.notes.some((q) => q.p === p && q.t === tt)) target.notes.push({ p, t: tt, d: Math.round(n.dur) });
          }
          tt += c.dur + extra[i + 1];
        });
        // 次の小節は拍子どおりの位置から（読み取りミスでずれが広がらないように）
        t += barT * Math.max(1, Math.round((tt - t) / barT));
        first = false;
      }
    }
    if (lh && !lh.notes.length) song.tracks.pop();
    return MM.fitBars(song);
  };

  /** プレビュー用に検出結果を描く */
  OMR.drawOverlay = function (page, target, opts = {}) {
    const src = page.canvas;
    const maxW = opts.maxWidth || 900;
    const s = Math.min(1, maxW / src.width);
    target.width = Math.round(src.width * s);
    target.height = Math.round(src.height * s);
    const g = target.getContext('2d');
    g.drawImage(src, 0, 0, target.width, target.height);
    g.save();
    g.scale(s, s);
    for (const st of page.staves) {
      g.fillStyle = 'rgba(77,171,247,0.12)';
      g.fillRect(st.x0, st.top - st.d * 0.5, st.x1 - st.x0, st.bottom - st.top + st.d);
      g.fillStyle = 'rgba(240,62,62,0.5)';
      for (const bx of st.barlines || []) g.fillRect(bx - 1.5, st.top - st.d * 0.8, 3, st.bottom - st.top + st.d * 1.6);
      g.fillStyle = 'rgba(120,120,120,0.18)';
      g.fillRect(st.x0, st.top - st.d * 2, (st.headerEnd || st.x0) - st.x0, st.bottom - st.top + st.d * 4);
    }
    const colors = { 48: '#9c36b5', 72: '#9c36b5', 24: '#2f9e44', 36: '#2f9e44', 12: '#1c7ed6', 18: '#1c7ed6', 6: '#f76707', 9: '#f76707', 3: '#e03131', 4.5: '#e03131' };
    for (const n of page.notes) {
      const r = n.staff.d * 0.85;
      g.lineWidth = Math.max(2, n.staff.d * 0.18);
      g.strokeStyle = n.excluded ? 'rgba(128,128,128,0.8)' : colors[n.dur] || '#1c7ed6';
      g.beginPath();
      g.ellipse(n.x, n.y, r, r * 0.8, 0, 0, Math.PI * 2);
      g.stroke();
      if (n.excluded) {
        g.beginPath();
        g.moveTo(n.x - r, n.y - r);
        g.lineTo(n.x + r, n.y + r);
        g.moveTo(n.x + r, n.y - r);
        g.lineTo(n.x - r, n.y + r);
        g.stroke();
      }
    }
    g.restore();
    return s;
  };

  OMR.hitNote = function (page, x, y, scale) {
    const px = x / scale, py = y / scale;
    let best = null, bd = Infinity;
    for (const n of page.notes) {
      const dd = Math.hypot(n.x - px, n.y - py);
      if (dd < n.staff.d * 1.2 && dd < bd) {
        bd = dd;
        best = n;
      }
    }
    return best;
  };
})();
