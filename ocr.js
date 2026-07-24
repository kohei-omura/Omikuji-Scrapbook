/* 御神籤帖 — 写真の読み取り（Gemini API）
   画像はGoogleのGemini APIへ送って解析します。APIキーはこの端末にだけ保存され、
   控え（JSON）には含めません。 */
(function (global) {
  'use strict';

  var KEY_STORE = 'gsc.geminiKey';
  var MODEL = 'gemini-2.0-flash';
  var ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    MODEL + ':generateContent';

  /* フォームの項目。key はアプリ内部、label はおみくじの見出し */
  var LABELS = [
    { key: 'wish', label: '願望' },
    { key: 'health', label: '健康' },
    { key: 'love', label: '恋愛' },
    { key: 'marriage', label: '縁談' },
    { key: 'work', label: '仕事' },
    { key: 'study', label: '学業' },
    { key: 'money', label: '金運' },
    { key: 'travel', label: '旅行' },
    { key: 'wait', label: '待ち人' },
    { key: 'lost', label: '失せ物' }
  ];

  var FORTUNES = ['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶'];

  var PROMPT =
    'このおみくじの画像から次をJSONのみで返せ。' +
    '{"shrine":神社名,"number":番号,"rank":運勢(大吉/中吉/小吉/吉/末吉/凶/大凶のいずれか),' +
    '"summary":総評(和歌・格言部分),' +
    '"items":{"願望":"","健康":"","恋愛":"","縁談":"","仕事":"","学業":"","金運":"","旅行":"","待ち人":"","失せ物":""}}' +
    ' 読めない項目は空文字。縦書きに注意。前置きやコードブロック記号は一切付けるな';

  /* ── APIキー ── */
  function getKey() {
    try { return (localStorage.getItem(KEY_STORE) || '').trim(); } catch (e) { return ''; }
  }
  function setKey(v) {
    try {
      v = String(v || '').trim();
      if (v) localStorage.setItem(KEY_STORE, v);
      else localStorage.removeItem(KEY_STORE);
      return true;
    } catch (e) { return false; }
  }
  function hasKey() { return !!getKey(); }

  /* ── 画像を長辺1024pxにしてBase64へ ── */
  function toBase64(blob, maxSide) {
    maxSide = maxSide || 1024;
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var sc = Math.min(1, maxSide / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
        var cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        var d;
        try { d = cv.toDataURL('image/jpeg', 0.85); }
        catch (e) { rej(new Error('写真を変換できませんでした')); return; }
        res({ data: d.slice(d.indexOf(',') + 1), mime: 'image/jpeg' });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        rej(new Error('写真を読み込めませんでした'));
      };
      img.src = url;
    });
  }

  /* ── 応答の掃除とJSON化 ── */
  function toJson(text) {
    var t = String(text || '').trim();
    t = t.replace(/^\uFEFF/, '');
    // ```json … ``` を外す
    t = t.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '').trim();
    // 前後に説明が付いた場合は最初の { から最後の } まで
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    return JSON.parse(t);
  }

  function pickFortune(v) {
    var s = String(v || '').replace(/[\s　]/g, '');
    if (!s) return '';
    for (var i = 0; i < FORTUNES.length; i++) {
      if (s === FORTUNES[i]) return FORTUNES[i];
    }
    // 「大吉」を先に見るため長い順で照合
    var order = ['大吉', '中吉', '小吉', '末吉', '大凶', '吉', '凶'];
    for (var j = 0; j < order.length; j++) {
      if (s.indexOf(order[j]) >= 0) return order[j];
    }
    return '';
  }

  function tidy(v) {
    return String(v == null ? '' : v).replace(/[\s　]+/g, ' ').trim();
  }

  /* ── 応答を画面の入力に合う形へ ── */
  function shape(obj) {
    var out = {
      shrine: tidy(obj.shrine),
      no: tidy(obj.number),
      fortune: pickFortune(obj.rank),
      summary: String(obj.summary == null ? '' : obj.summary).trim(),
      sections: {},
      raw: obj
    };
    var items = obj.items || {};
    LABELS.forEach(function (L) {
      var v = tidy(items[L.label]);
      if (!v && L.label === '待ち人') v = tidy(items['待人']);
      if (!v && L.label === '失せ物') v = tidy(items['失物']);
      if (v) out.sections[L.key] = v;
    });
    return out;
  }

  function errorFor(status, body) {
    if (status === 400) return 'APIキーが正しくないか、画像を受け付けられませんでした。設定を確かめてください';
    if (status === 401 || status === 403) return 'APIキーが使えませんでした。設定で入れ直してください';
    if (status === 429) return '読み取りの回数制限に達しました。しばらく待ってからお試しください';
    if (status >= 500) return 'Gemini側が混み合っています。少し待ってからお試しください';
    return '読み取りに失敗しました（' + status + '）。手で入力してください';
  }

  var OCR = {
    labels: LABELS,
    fortunes: FORTUNES,
    getKey: getKey,
    setKey: setKey,
    hasKey: hasKey,
    model: MODEL,
    online: function () { return navigator.onLine !== false; },
    /** 読み取れる状態か（電波とAPIキーの両方が要る） */
    available: function () { return OCR.online() && hasKey(); },

    /**
     * 写真から読み取る。onProgress(パーセント, 説明)
     * 返り値: { shrine, no, fortune, summary, sections }
     */
    run: function (blob, onProgress) {
      var report = function (p, m) { if (onProgress) onProgress(p, m); };

      if (!OCR.online()) {
        return Promise.reject(new Error('電波のある場所で読み取れます'));
      }
      var key = getKey();
      if (!key) {
        var e = new Error('先に設定でGemini APIキーを入れてください');
        e.needKey = true;
        return Promise.reject(e);
      }

      report(10, '写真を整えています');
      return toBase64(blob, 1024).then(function (img) {
        report(35, 'おみくじを送っています');
        return fetch(ENDPOINT + '?key=' + encodeURIComponent(key), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: PROMPT },
                { inline_data: { mime_type: img.mime, data: img.data } }
              ]
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
          })
        });
      }).catch(function (err) {
        if (err && err.message && /^(電波|先に設定|写真を)/.test(err.message)) throw err;
        throw new Error('通信できませんでした。電波の良い場所でお試しください');
      }).then(function (r) {
        report(70, '読み取っています');
        if (!r.ok) {
          return r.text().catch(function () { return ''; }).then(function (body) {
            var msg = errorFor(r.status, body);
            var e2 = new Error(msg);
            if (r.status === 400 || r.status === 401 || r.status === 403) e2.needKey = true;
            throw e2;
          });
        }
        return r.json();
      }).then(function (j) {
        var text = '';
        try {
          var parts = j.candidates[0].content.parts || [];
          text = parts.map(function (p) { return p.text || ''; }).join('');
        } catch (e) { text = ''; }
        if (!text.trim()) {
          var blocked = j && j.promptFeedback && j.promptFeedback.blockReason;
          throw new Error(blocked
            ? 'この画像は読み取れませんでした。別の写真でお試しください'
            : '読み取り結果が空でした。手で入力してください');
        }
        report(90, '内容を整えています');
        var obj;
        try { obj = toJson(text); }
        catch (e) { throw new Error('読み取り結果を解釈できませんでした。手で入力してください'); }
        report(100, '読み取りました');
        return shape(obj);
      });
    }
  };

  global.OCR = OCR;
})(window);
