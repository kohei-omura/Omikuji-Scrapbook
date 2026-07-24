/* 御神籤帖 — OCR（Tesseract.js v5 / jpn + jpn_vert）
   オフライン時は読み取りを行わず、手入力へ案内します。 */
(function (global) {
  'use strict';

  var CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  var _loading = null;
  var _worker = null;

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

  function getWorker(onProgress) {
    if (_worker) return Promise.resolve(_worker);
    return loadLib().then(function () {
      return global.Tesseract.createWorker('jpn+jpn_vert', 1, {
        logger: function (m) {
          if (!onProgress) return;
          var pct = Math.round((m.progress || 0) * 100);
          var label = ({
            'loading tesseract core': '部品を読み込んでいます',
            'loading language traineddata': '日本語の辞書を読み込んでいます',
            'initializing api': '準備しています',
            'recognizing text': '文字を読み取っています'
          })[m.status] || '読み取り中';
          onProgress(pct, label);
        }
      });
    }).then(function (w) { _worker = w; return w; });
  }

  var FORTUNES = ['大吉', '中吉', '小吉', '末吉', '大凶', '吉', '凶'];

  var LABELS = [
    { key: 'wish', label: '願望', pat: '願望|願事|願い事|ねがひごと|所願' },
    { key: 'health', label: '健康', pat: '健康|病気|やまひ|病' },
    { key: 'love', label: '恋愛', pat: '恋愛|恋' },
    { key: 'marriage', label: '縁談', pat: '縁談|縁組|結婚' },
    { key: 'work', label: '仕事', pat: '仕事|商売|職業|事業' },
    { key: 'study', label: '学業', pat: '学業|学問|受験' },
    { key: 'money', label: '金運', pat: '金運|金銭|財' },
    { key: 'travel', label: '旅行', pat: '旅行|旅立|旅' },
    { key: 'wait', label: '待ち人', pat: '待人|待ち人' },
    { key: 'lost', label: '失せ物', pat: '失物|失せ物|落し物|落とし物' }
  ];

  /** 読み取った文章から各項目を推定する（誤読前提・あくまで下書き） */
  function parse(raw) {
    var text = String(raw || '')
      .replace(/[\u3000\t]+/g, ' ')
      .replace(/[ ]{2,}/g, ' ');
    var flat = text.replace(/\r?\n/g, '\n');
    var out = { fortune: '', no: '', summary: '', sections: {}, raw: text };

    // 運勢（長い語から先に照合）
    for (var i = 0; i < FORTUNES.length; i++) {
      if (flat.indexOf(FORTUNES[i]) >= 0) { out.fortune = FORTUNES[i]; break; }
    }

    // 番号（第○番／○番）
    var mNo = flat.match(/第?\s*([0-9０-９一二三四五六七八九十百千]+)\s*番/);
    if (mNo) out.no = '第' + mNo[1].trim() + '番';

    // 項目別（ラベル位置で切り出す）
    var all = LABELS.map(function (L) { return L.pat; }).join('|');
    var re = new RegExp('(' + all + ')\\s*[:：・…\\-—]?\\s*', 'g');
    var hits = [], m;
    while ((m = re.exec(flat)) !== null) hits.push({ word: m[1], at: m.index, end: re.lastIndex });

    hits.forEach(function (h, idx) {
      var stop = idx + 1 < hits.length ? hits[idx + 1].at : flat.length;
      var body = flat.slice(h.end, stop).replace(/\n+/g, ' ').trim();
      if (body.length > 60) body = body.slice(0, 60);
      var L = LABELS.find(function (x) { return new RegExp(x.pat).test(h.word); });
      if (L && body && !out.sections[L.key]) out.sections[L.key] = body;
    });

    // 総評：ラベル行より前のまとまった文章を拾う
    var head = hits.length ? flat.slice(0, hits[0].at) : flat;
    var lines = head.split('\n').map(function (s) { return s.trim(); })
      .filter(function (s) {
        if (s.length < 6) return false;
        if (FORTUNES.indexOf(s) >= 0) return false;
        if (/^第?[0-9０-９一二三四五六七八九十百千]+番$/.test(s)) return false;
        return true;
      });
    out.summary = lines.slice(0, 4).join('\n');

    return out;
  }

  var OCR = {
    labels: LABELS,
    fortunes: FORTUNES,
    parse: parse,
    available: function () { return navigator.onLine !== false; },
    /** 画像から文字を読み取る。onProgress(パーセント, 説明) */
    run: function (blobOrUrl, onProgress) {
      if (!OCR.available()) {
        return Promise.reject(new Error('オフラインのため読み取れません。手で入力してください'));
      }
      return getWorker(onProgress).then(function (w) {
        if (onProgress) onProgress(0, '文字を読み取っています');
        return w.recognize(blobOrUrl);
      }).then(function (r) {
        var text = (r && r.data && r.data.text) || '';
        if (!text.trim()) throw new Error('文字を読み取れませんでした。手で入力してください');
        return parse(text);
      });
    },
    dispose: function () {
      if (_worker && _worker.terminate) { try { _worker.terminate(); } catch (e) {} }
      _worker = null;
    }
  };

  global.OCR = OCR;
})(window);
