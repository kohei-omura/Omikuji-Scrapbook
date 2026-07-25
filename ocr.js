/* 御神籤帖 — 写真の読み取り（Gemini API）
   使えるモデルはGoogle側で入れ替わるため、キーで一覧を取り寄せて自動で選びます。
   APIキーはこの端末にだけ保存され、控え（JSON）には含めません。 */
(function (global) {
  'use strict';

  var K_KEY = 'gsc.geminiKey';
  var K_MODEL = 'gsc.geminiModel';
  var K_LIST = 'gsc.geminiModels';
  var BASE = 'https://generativelanguage.googleapis.com/v1beta';

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

  /* 一覧を取れなかったときに試す候補（新しい世代から順に） */
  var FALLBACK = [
    'gemini-flash-latest',
    'gemini-3.5-flash', 'gemini-3-flash',
    'gemini-3.1-flash-lite', 'gemini-flash-lite-latest',
    'gemini-2.5-flash', 'gemini-2.5-flash-lite'
  ];

  var PROMPT =
    'このおみくじの画像から次をJSONのみで返せ。' +
    '{"shrine":神社名,"number":番号,"rank":運勢(大吉/中吉/小吉/吉/末吉/凶/大凶のいずれか),' +
    '"summary":総評(和歌・格言部分),' +
    '"items":{"願望":"","健康":"","恋愛":"","縁談":"","仕事":"","学業":"","金運":"","旅行":"","待ち人":"","失せ物":""}}' +
    ' 読めない項目は空文字。縦書きに注意。前置きやコードブロック記号は一切付けるな';

  /* ── 保存もの ── */
  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k) || '';
      if (v === null) { localStorage.removeItem(k); return ''; }
      localStorage.setItem(k, v); return v;
    } catch (e) { return ''; }
  }
  function getKey() { return ls(K_KEY).trim(); }
  function setKey(v) { v = String(v || '').trim(); ls(K_KEY, v || null); return true; }
  function hasKey() { return !!getKey(); }
  function getModel() { return ls(K_MODEL); }
  function setModel(v) { ls(K_MODEL, v || null); return true; }
  function cachedList() {
    try { return JSON.parse(ls(K_LIST) || '[]'); } catch (e) { return []; }
  }

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

  /* ── 応答の掃除 ── */
  function toJson(text) {
    var t = String(text || '').trim().replace(/^\uFEFF/, '');
    t = t.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '').trim();
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    return JSON.parse(t);
  }

  function pickFortune(v) {
    var s = String(v || '').replace(/[\s　]/g, '');
    if (!s) return '';
    var order = ['大吉', '中吉', '小吉', '末吉', '大凶', '吉', '凶'];
    for (var j = 0; j < order.length; j++) if (s.indexOf(order[j]) >= 0) return order[j];
    return '';
  }
  function tidy(v) { return String(v == null ? '' : v).replace(/[\s　]+/g, ' ').trim(); }

  function shape(obj) {
    var out = {
      shrine: tidy(obj.shrine), no: tidy(obj.number),
      fortune: pickFortune(obj.rank),
      summary: String(obj.summary == null ? '' : obj.summary).trim(),
      sections: {}, raw: obj
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

  /* ── Googleの返す理由をそのまま日本語に添える ── */
  function explain(status, body) {
    var msg = '', reason = '', quota = null;
    try {
      var j = typeof body === 'string' ? JSON.parse(body) : body;
      if (j && j.error) {
        msg = j.error.message || '';
        reason = j.error.status || '';
        var det = j.error.details || [];
        det.forEach(function (d) {
          var m = d.metadata || {};
          if (m.quota_limit_value !== undefined) quota = m.quota_limit_value;
        });
      }
    } catch (e) {}
    var head;
    if (status === 404) head = 'このモデルは今は使えません（提供終了の可能性）';
    else if (status === 429 && String(quota) === '0') head = 'このモデルは無料枠が0のため使えません';
    else if (status === 429) head = '読み取りの回数制限に達しました。少し待ってからお試しください';
    else if (status === 400 && /API key/i.test(msg)) head = 'APIキーが正しくありません';
    else if (status === 400 && /location|region/i.test(msg)) head = 'お住まいの地域では無料枠が使えません。請求を有効にすると使えます';
    else if (status === 400) head = '送信内容を受け付けられませんでした';
    else if (status === 401 || status === 403) head = 'APIキーが使えませんでした';
    else if (status >= 500) head = 'Google側が混み合っています';
    else head = '読み取りに失敗しました（' + status + '）';
    return { head: head, detail: msg, reason: reason, quota: quota, status: status };
  }

  function err(e) {
    var x = new Error(e.head + (e.detail ? '：' + String(e.detail).slice(0, 120) : ''));
    x.status = e.status; x.reason = e.reason; x.quota = e.quota;
    if (e.status === 400 || e.status === 401 || e.status === 403) x.needKey = /API key|credential/i.test(e.detail || '');
    return x;
  }

  /* ── 使えるモデルを調べる ── */
  function listModels() {
    var key = getKey();
    if (!key) return Promise.reject(new Error('先に設定でGemini APIキーを入れてください'));
    return fetch(BASE + '/models?key=' + encodeURIComponent(key) + '&pageSize=200')
      .catch(function () { throw new Error('通信できませんでした。電波の良い場所でお試しください'); })
      .then(function (r) {
        if (!r.ok) return r.text().then(function (b) { throw err(explain(r.status, b)); });
        return r.json();
      }).then(function (j) {
        var all = (j.models || []).filter(function (m) {
          var meth = m.supportedGenerationMethods || m.supportedActions || [];
          return meth.indexOf('generateContent') >= 0;
        }).map(function (m) {
          return { name: String(m.name || '').replace(/^models\//, ''), label: m.displayName || '' };
        }).filter(function (m) {
          if (!m.name) return false;
          return !/embedding|aqa|imagen|image-generation|tts|-live-|veo|learnlm/i.test(m.name);
        });
        // 画像を読める見込みが高い順に並べる（flash系→新しい世代）
        var num = function (s) {
          var m = s.match(/(\d+(?:\.\d+)?)/);
          return m ? parseFloat(m[1]) : 0;
        };
        all.sort(function (a, b) {
          var af = /flash/i.test(a.name) ? 0 : 1, bf = /flash/i.test(b.name) ? 0 : 1;
          if (af !== bf) return af - bf;
          var al = /lite/i.test(a.name) ? 1 : 0, bl = /lite/i.test(b.name) ? 1 : 0;
          if (al !== bl) return al - bl;
          var ap = /preview|exp/i.test(a.name) ? 1 : 0, bp = /preview|exp/i.test(b.name) ? 1 : 0;
          if (ap !== bp) return ap - bp;
          return num(b.name) - num(a.name);
        });
        ls(K_LIST, JSON.stringify(all.slice(0, 40)));
        return all;
      });
  }

  /* 試す順番：保存済み → 調べた一覧 → 予備 */
  function candidates() {
    var out = [], seen = {};
    var push = function (n) { if (n && !seen[n]) { seen[n] = 1; out.push(n); } };
    push(getModel());
    cachedList().forEach(function (m) { push(m.name); });
    FALLBACK.forEach(push);
    return out;
  }

  function askOnce(model, img, key) {
    return fetch(BASE + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: img.mime, data: img.data } }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
      })
    }).catch(function () {
      throw new Error('通信できませんでした。電波の良い場所でお試しください');
    }).then(function (r) {
      if (!r.ok) {
        return r.text().catch(function () { return ''; }).then(function (b) {
          throw err(explain(r.status, b));
        });
      }
      return r.json();
    });
  }

  var OCR = {
    labels: LABELS,
    fortunes: FORTUNES,
    getKey: getKey, setKey: setKey, hasKey: hasKey,
    getModel: getModel, setModel: setModel,
    listModels: listModels, cachedList: cachedList,
    online: function () { return navigator.onLine !== false; },
    available: function () { return OCR.online() && hasKey(); },

    /** 写真から読み取る。使えないモデルは自動で次を試す */
    run: function (blob, onProgress) {
      var report = function (p, m) { if (onProgress) onProgress(p, m); };
      if (!OCR.online()) return Promise.reject(new Error('電波のある場所で読み取れます'));
      var key = getKey();
      if (!key) {
        var e0 = new Error('先に設定でGemini APIキーを入れてください');
        e0.needKey = true;
        return Promise.reject(e0);
      }

      report(8, '写真を整えています');
      return toBase64(blob, 1024).then(function (img) {
        var list = candidates();
        // 一覧をまだ持っていなければ、先に調べる
        var pre = cachedList().length ? Promise.resolve() :
          listModels().then(function () { list = candidates(); }).catch(function () {});
        return pre.then(function () {
          var lastErr = null, tried = [];
          var step = function (i) {
            if (i >= list.length) {
              throw lastErr || new Error('使えるモデルが見つかりませんでした。設定でモデルを選び直してください');
            }
            var model = list[i];
            tried.push(model);
            report(30 + Math.min(40, i * 12), 'おみくじを送っています（' + model + '）');
            return askOnce(model, img, key).then(function (j) {
              setModel(model);                       // うまくいったモデルを覚える
              return j;
            }).catch(function (e) {
              lastErr = e;
              // モデル都合（提供終了・無料枠0）なら次の候補へ
              var skip = (e.status === 404) || (e.status === 429 && String(e.quota) === '0');
              if (skip) return step(i + 1);
              throw e;
            });
          };
          return step(0);
        });
      }).then(function (j) {
        report(85, '内容を整えています');
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
        var obj;
        try { obj = toJson(text); }
        catch (e) { throw new Error('読み取り結果を解釈できませんでした。手で入力してください'); }
        report(100, '読み取りました');
        var out = shape(obj);
        out.model = getModel();
        return out;
      });
    }
  };

  global.OCR = OCR;
})(window);
