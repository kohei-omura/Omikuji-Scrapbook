/* 御神籤帖 — OCR（Tesseract.js v5 / jpn + jpn_vert）
   縦書き・横向き写真に対応するため、向きを見極めてから本読みします。 */
(function (global) {
  'use strict';

  var CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  var _loading = null;
  var _worker = null;

  var FORTUNES = ['大吉', '中吉', '小吉', '末吉', '大凶', '吉', '凶'];

  var LABELS = [
    { key: 'wish', label: '願望', pat: '願望|願事|願い事|所願' },
    { key: 'health', label: '健康', pat: '健康|病気|疾病' },
    { key: 'love', label: '恋愛', pat: '恋愛|恋' },
    { key: 'marriage', label: '縁談', pat: '縁談|縁組|結婚' },
    { key: 'work', label: '仕事', pat: '仕事|商業|商売|職業|事業|求職|求人' },
    { key: 'study', label: '学業', pat: '学業|学問|受験' },
    { key: 'money', label: '金運', pat: '金運|金銭|売買|財' },
    { key: 'travel', label: '旅行', pat: '旅行|旅立|旅' },
    { key: 'wait', label: '待ち人', pat: '待人|待ち人' },
    { key: 'lost', label: '失せ物', pat: '失物|失せ物|落し物|落とし物' }
  ];

  /* おみくじによく出る見出し。向きの良し悪しを測る手がかり */
  var CUES = ['運勢', '願望', '待人', '失物', '商業', '学問', '学業', '縁談', '病気',
    '争事', '旅行', '転居', '建築', '売買', '勝負', '出産', '求職', '求人', '恋愛',
    '金運', '仕事', '健康', '転宅', '訴訟'];

  function loadLib() {
    if (global.Tesseract) return Promise.resolve();
    if (_loading) return _loading;
    _loading = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = CDN;
      s.onload = function () { res(); };
      s.onerror = function () { _loading = null; rej(new Error('読み取り用の部品を取り込めませんでした')); };
      document.head.appendChild(s);
    });
    return _loading;
  }

  function getWorker(onStage) {
    if (_worker) return Promise.resolve(_worker);
    return loadLib().then(function () {
      return global.Tesseract.createWorker('jpn+jpn_vert', 1, {
        logger: function (m) {
          if (!onStage) return;
          var label = ({
            'loading tesseract core': '部品を読み込んでいます',
            'loading language traineddata': '日本語の辞書を読み込んでいます',
            'initializing api': '準備しています',
            'recognizing text': '文字を読み取っています'
          })[m.status];
          if (label) onStage(label, m.progress || 0);
        }
      });
    }).then(function (w) {
      _worker = w;
      return w.setParameters({
        tessedit_pageseg_mode: '5',
        preserve_interword_spaces: '1'
      }).then(function () { return w; }, function () { return w; });
    });
  }


  /* ── おみくじの紙の位置を見つける（朱枠→明るい領域の順に探す） ── */
  function detectCrop(src) {
    return new Promise(function (res) {
      var url = URL.createObjectURL(src);
      var img = new Image();
      img.onload = function () {
        var W = img.naturalWidth, H = img.naturalHeight;
        var n = 420;
        var sc = Math.min(1, n / Math.max(W, H));
        var w = Math.max(1, Math.round(W * sc)), h = Math.max(1, Math.round(H * sc));
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var c = cv.getContext('2d');
        c.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        var box = null;
        try {
          var d = c.getImageData(0, 0, w, h).data;
          var x, y, i, r, g, b;

          // ① 朱色の枠を探す
          var minX = w, minY = h, maxX = -1, maxY = -1, cnt = 0;
          for (y = 0; y < h; y++) {
            for (x = 0; x < w; x++) {
              i = (y * w + x) * 4; r = d[i]; g = d[i + 1]; b = d[i + 2];
              if (r > 110 && r - g > 38 && r - b > 38) {
                cnt++;
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
              }
            }
          }
          if (cnt > w * h * 0.004 && maxX > minX + w * 0.12 && maxY > minY + h * 0.04) {
            box = { x: minX, y: minY, x2: maxX, y2: maxY };
          }

          // ② 見つからなければ明るい領域で探す
          if (!box) {
            var lum = new Uint8Array(w * h), sum = 0;
            for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
              i = (y * w + x) * 4;
              var L = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
              lum[y * w + x] = L; sum += L;
            }
            var mean = sum / (w * h), th = mean + 18;
            minX = w; minY = h; maxX = -1; maxY = -1; cnt = 0;
            for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
              if (lum[y * w + x] > th) {
                cnt++;
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
              }
            }
            if (cnt > w * h * 0.05 && maxX > minX && maxY > minY) {
              box = { x: minX, y: minY, x2: maxX, y2: maxY };
            }
          }
        } catch (e) {}

        if (!box) { res(null); return; }
        var pad = 0.02;
        var bx = Math.max(0, box.x / w - pad), by = Math.max(0, box.y / h - pad);
        var bw = Math.min(1 - bx, (box.x2 - box.x) / w + pad * 2);
        var bh = Math.min(1 - by, (box.y2 - box.y) / h + pad * 2);
        if (bw * bh > 0.92) { res(null); return; }        // ほぼ全面なら切り出さない
        res({ x: bx, y: by, w: bw, h: bh });
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(null); };
      img.src = url;
    });
  }

  /* 切り出し＋回転＋白黒化＋濃淡の伸長 */
  function prepare(src, angle, maxSide, crop) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(src);
      var img = new Image();
      img.onload = function () {
        var W = img.naturalWidth, H = img.naturalHeight;
        var sx = 0, sy = 0, sw = W, sh = H;
        if (crop) {
          sx = Math.round(crop.x * W); sy = Math.round(crop.y * H);
          sw = Math.max(8, Math.round(crop.w * W)); sh = Math.max(8, Math.round(crop.h * H));
        }
        var sc = Math.min(1, maxSide / Math.max(sw, sh));
        var dw = Math.round(sw * sc), dh = Math.round(sh * sc);
        var swap = (angle === 90 || angle === 270);
        var cv = document.createElement('canvas');
        cv.width = swap ? dh : dw;
        cv.height = swap ? dw : dh;
        var c = cv.getContext('2d');
        c.save();
        c.translate(cv.width / 2, cv.height / 2);
        c.rotate(angle * Math.PI / 180);
        c.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
        c.restore();
        URL.revokeObjectURL(url);

        try {
          var d = c.getImageData(0, 0, cv.width, cv.height);
          var p = d.data, i, g;
          var hist = new Uint32Array(256);
          for (i = 0; i < p.length; i += 4) {
            g = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) | 0;
            p[i] = p[i + 1] = p[i + 2] = g;
            hist[g]++;
          }
          var total = cv.width * cv.height, acc = 0, lo = 0, hi = 255;
          for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > total * 0.02) { lo = i; break; } }
          acc = 0;
          for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > total * 0.02) { hi = i; break; } }
          if (hi - lo > 20) {
            var k = 255 / (hi - lo);
            for (i = 0; i < p.length; i += 4) {
              g = (p[i] - lo) * k;
              p[i] = p[i + 1] = p[i + 2] = g < 0 ? 0 : (g > 255 ? 255 : g);
            }
          }
          c.putImageData(d, 0, 0);
        } catch (e) { /* 加工できなくても素の画像で続ける */ }

        res(cv);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        rej(new Error('写真を読み込めませんでした'));
      };
      img.src = url;
    });
  }

  /* 読み取り結果の「おみくじらしさ」を採点 */
  function score(text) {
    var t = String(text || '');
    if (!t.trim()) return 0;
    var s = 0;
    var cp = t.replace(/[\s　]/g, '');
    CUES.forEach(function (w) { if (cp.indexOf(w) >= 0) s += 3; });
    FORTUNES.forEach(function (w) { if (cp.indexOf(w) >= 0) s += 2; });
    if (/第[0-9０-９一二三四五六七八九十百千]+番/.test(cp)) s += 5;
    var jp = (t.match(/[ぁ-んァ-ヶ一-龥]/g) || []).length;
    var all = t.replace(/\s/g, '').length || 1;
    s += Math.round(jp / all * 8);
    s += Math.min(6, Math.round(jp / 40));
    return s;
  }


  /* 読み取りの雑音（英数字・記号のかたまり）を落とす */
  function clean(v) {
    return String(v || '')
      .replace(/[A-Za-z0-9０-９]{1,}/g, ' ')
      .replace(/[\[\]{}()<>|\\\/_=+~^`*#@$%&"';:：]/g, ' ')
      .replace(/[.。、]{2,}/g, '')
      .replace(/[ 　]{2,}/g, ' ')
      .replace(/^[ 　・…\-—]+/, '')
      .trim();
  }
  /* 日本語らしさ（雑音行を落とす判定に使う） */
  function jpRatio(v) {
    var t = String(v || '').replace(/[\s　]/g, '');
    if (!t) return 0;
    return (t.match(/[ぁ-んァ-ヶ一-龥]/g) || []).length / t.length;
  }

  function parse(raw) {
    var text = String(raw || '').replace(/[\u3000\t]+/g, ' ').replace(/ {2,}/g, ' ');
    var out = { fortune: '', no: '', summary: '', sections: {}, raw: text };

    var compact = text.replace(/[\s　]/g, '');
    for (var i = 0; i < FORTUNES.length; i++) {
      if (compact.indexOf(FORTUNES[i]) >= 0) { out.fortune = FORTUNES[i]; break; }
    }
    var mNo = compact.match(/第([0-9０-９一二三四五六七八九十百千]+)番/) ||
              text.match(/第\s*([0-9０-９一二三四五六七八九十百千]+)\s*番/);
    if (mNo) out.no = '第' + mNo[1].replace(/[\s　]/g, '') + '番';

    var lines = text.split(/\r?\n/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
    var all = LABELS.map(function (L) { return L.pat; }).join('|');
    var used = {};

    // ① 行頭が見出しなら、その行の残りが本文（縦書き1列＝1行）
    lines.forEach(function (ln) {
      LABELS.forEach(function (L) {
        if (used[L.key]) return;
        var m = ln.match(new RegExp('^(?:' + L.pat + ')\\s*[:：・…\\-—]?\\s*(.+)$'));
        if (m && m[1]) {
          var body = clean(m[1]);
          if (body.length >= 2 && jpRatio(body) >= 0.6) {
            out.sections[L.key] = body.slice(0, 60);
            used[L.key] = 1;
          }
        }
      });
    });

    // ② 残りは、見出しから次の見出しまでを切り出す
    var re = new RegExp('(' + all + ')\\s*[:：・…\\-—]?\\s*', 'g');
    var hits = [], m2;
    while ((m2 = re.exec(text)) !== null) hits.push({ word: m2[1], at: m2.index, end: re.lastIndex });
    hits.forEach(function (h, idx) {
      var L = LABELS.filter(function (x) { return new RegExp('^(?:' + x.pat + ')$').test(h.word); })[0];
      if (!L || used[L.key]) return;
      var stop = idx + 1 < hits.length ? hits[idx + 1].at : text.length;
      var body = clean(text.slice(h.end, stop).replace(/\n+/g, ' '));
      if (body.length >= 2 && jpRatio(body) >= 0.6) {
        out.sections[L.key] = body.slice(0, 60); used[L.key] = 1;
      }
    });

    // 総評：見出しの付かない、まとまった行
    var head = lines.map(clean).filter(function (ln) {
      if (ln.length < 6) return false;
      if (jpRatio(ln) < 0.75) return false;
      if (new RegExp('^(?:' + all + ')').test(ln)) return false;
      if (/^第\s*[0-9０-９一二三四五六七八九十百千]+\s*番/.test(ln)) return false;
      if (FORTUNES.indexOf(ln) >= 0) return false;
      if (/電話|神社|祭$|祈祷|社務所|承ります/.test(ln)) return false;
      return true;
    });
    out.summary = head.slice(0, 3).join('\n');
    return out;
  }

  var OCR = {
    labels: LABELS,
    fortunes: FORTUNES,
    parse: parse,
    score: score,
    prepare: prepare,
    detectCrop: detectCrop,
    available: function () { return navigator.onLine !== false; },

    /** 向きを見極めてから本読みする */
    run: function (blob, onProgress) {
      if (!OCR.available()) {
        return Promise.reject(new Error('オフラインのため読み取れません。手で入力してください'));
      }
      var worker = null, crop = null;
      var report = function (pct, msg) { if (onProgress) onProgress(Math.round(pct), msg); };

      return getWorker(function (msg, pr) { report(pr * 10, msg); }).then(function (w) {
        worker = w;
        report(12, 'おみくじの位置を探しています');
        return detectCrop(blob);
      }).then(function (cr) {
        crop = cr;
        var order = [0, 90, 270, 180];
        var best = { sc: -1, angle: 0, text: '' };
        var step = 0;
        return order.reduce(function (chain, ang) {
          return chain.then(function () {
            if (best.sc >= 24) return;            // 十分に良ければ打ち切る
            step++;
            report(14 + step * 9, '向きを見極めています（' + step + '/' + order.length + '）');
            return prepare(blob, ang, 1000, crop).then(function (cv) {
              return worker.recognize(cv);
            }).then(function (r) {
              var t = (r && r.data && r.data.text) || '';
              var sc = score(t);
              if (sc > best.sc) best = { sc: sc, angle: ang, text: t };
            }).catch(function () {});
          });
        }, Promise.resolve()).then(function () { return best; });
      }).then(function (best) {
        report(58, '本読みしています（少し時間がかかります）');
        return prepare(blob, best.angle, 2600, crop).then(function (cv) {
          return worker.recognize(cv).then(function (r) {
            var text = (r && r.data && r.data.text) || '';
            // 縦書きとして振るわなければ、横書きとしても読んでみる
            if (score(text) < 22) {
              return worker.setParameters({ tessedit_pageseg_mode: '6' })
                .then(function () { return worker.recognize(cv); })
                .then(function (r2) {
                  var t2 = (r2 && r2.data && r2.data.text) || '';
                  return worker.setParameters({ tessedit_pageseg_mode: '5' })
                    .then(function () { return score(t2) > score(text) ? t2 : text; });
                })
                .catch(function () { return text; });
            }
            return text;
          });
        }).then(function (text) {
          if (score(text) < best.sc) text = best.text;
          if (!text.trim()) {
            throw new Error('文字を読み取れませんでした。明るい場所で、おみくじを画面いっぱいに写して撮り直してください');
          }
          report(100, '読み取りました');
          var p = parse(text);
          p.angle = best.angle;
          p.score = score(text);
          p.cropped = !!crop;
          return p;
        });
      });
    },

    dispose: function () {
      if (_worker && _worker.terminate) { try { _worker.terminate(); } catch (e) {} }
      _worker = null;
    }
  };

  global.OCR = OCR;
})(window);
