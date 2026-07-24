/* 御神籤帖 — 画面まわり */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var RANK = { '大吉': 7, '中吉': 6, '小吉': 5, '吉': 4, '末吉': 3, '凶': 2, '大凶': 1 };
  var KYO = ['凶', '大凶'];
  var LABELS = window.OCR ? window.OCR.labels : [];

  var state = { records: [], photo: null, orig: null, photoUrl: null, urls: [] };

  /* ───────── 共通 ───────── */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var toastTimer = null;
  function toast(msg, bad) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (bad ? ' bad' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, bad ? 4200 : 2600);
  }

  function badgeCls(f) {
    if (!f) return 'mut';
    if (f === '大吉') return 'gold';
    if (KYO.indexOf(f) >= 0) return 'ai';
    if (RANK[f]) return 'shu';
    return 'mut';
  }

  function fmtDate(d) {
    if (!d) return '';
    var p = String(d).split('-');
    if (p.length !== 3) return d;
    return p[0] + '年' + Number(p[1]) + '月' + Number(p[2]) + '日';
  }

  function today() {
    var d = new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function releaseUrls() {
    state.urls.forEach(function (u) { URL.revokeObjectURL(u); });
    state.urls = [];
  }
  function objUrl(blob) {
    var u = URL.createObjectURL(blob);
    state.urls.push(u);
    return u;
  }

  /* ───────── 見た目（夜の帖） ───────── */

  function applyTheme(v) {
    if (v === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', v === 'dark' ? '#1D1A16' : '#B3424A');
  }
  function initTheme() {
    applyTheme(localStorage.getItem('gsc.theme') || 'light');
  }
  function toggleTheme() {
    var next = (localStorage.getItem('gsc.theme') === 'dark') ? 'light' : 'dark';
    localStorage.setItem('gsc.theme', next);
    applyTheme(next);
    toast(next === 'dark' ? '夜の帖にしました' : '昼の帖にしました');
    if ($('#tab-stats').classList.contains('is-on')) renderStats();
  }

  /* ───────── 写真 ───────── */

  /** 長辺1280pxに収めてJPEGへ */
  function shrink(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1280;
        var w = img.naturalWidth, h = img.naturalHeight;
        var sc = Math.min(1, max / Math.max(w, h));
        var cw = Math.round(w * sc), ch = Math.round(h * sc);
        var cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        cv.toBlob(function (b) {
          if (b) res(b); else rej(new Error('写真を変換できませんでした'));
        }, 'image/jpeg', 0.85);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        rej(new Error('写真を読み込めませんでした'));
      };
      img.src = url;
    });
  }

  function setPhoto(blob) {
    state.photo = blob;
    var pv = $('#preview');
    pv.innerHTML = '';
    if (blob) {
      var img = document.createElement('img');
      state.photoUrl = objUrl(blob);
      img.src = state.photoUrl;
      img.alt = 'おみくじの写真';
      pv.appendChild(img);
      pv.classList.add('has');
      $('#rot-btns').hidden = false;
      syncOcrButton();
    } else {
      pv.classList.remove('has');
      $('#rot-btns').hidden = true;
      syncOcrButton();
    }
  }


  /** 写真を90度ずつ回す（読み取りが合わないときの手直し用） */
  function rotatePhoto(deg) {
    var src = state.photo;
    if (!src) return;
    var url = URL.createObjectURL(src);
    var img = new Image();
    img.onload = function () {
      var cv = document.createElement('canvas');
      cv.width = img.naturalHeight; cv.height = img.naturalWidth;
      var c = cv.getContext('2d');
      c.translate(cv.width / 2, cv.height / 2);
      c.rotate(deg * Math.PI / 180);
      c.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      URL.revokeObjectURL(url);
      cv.toBlob(function (b) {
        if (!b) { toast('写真を回せませんでした', true); return; }
        state.orig = b;
        setPhoto(b);
      }, 'image/jpeg', 0.9);
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast('写真を回せませんでした', true); };
    img.src = url;
  }

  function onPick(e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast('画像ファイルを選んでください', true); return; }
    state.orig = f;
    shrink(f).then(setPhoto).catch(function (err) { toast(err.message, true); });
  }

  /* ───────── 記録フォーム ───────── */

  function buildSections() {
    var box = $('#sections');
    box.innerHTML = LABELS.map(function (L) {
      return '<label class="fld"><span>' + esc(L.label) + '</span>' +
        '<input type="text" id="s-' + L.key + '" placeholder="空欄のままでも保存できます"></label>';
    }).join('');
  }

  function fillShrineOptions() {
    return DB.shrines().then(function (list) {
      $('#shrine-list').innerHTML = list.map(function (s) {
        return '<option value="' + esc(s) + '"></option>';
      }).join('');
    });
  }

  function readForm() {
    var fortune = $('#f-fortune').value;
    if (fortune === '__custom') fortune = $('#f-fortune-custom').value.trim();
    var sections = {};
    LABELS.forEach(function (L) {
      var v = $('#s-' + L.key).value.trim();
      if (v) sections[L.key] = v;
    });
    var keepBtn = $('#f-keep .is-on');
    return {
      id: $('#f-id').value,
      date: $('#f-date').value || today(),
      shrine: $('#f-shrine').value.trim(),
      no: $('#f-no').value.trim(),
      fortune: fortune,
      summary: $('#f-summary').value.trim(),
      sections: sections,
      memo: $('#f-memo').value.trim(),
      keep: keepBtn ? keepBtn.dataset.v : '持ち帰った',
      photo: state.photo || null
    };
  }

  function resetForm() {
    $('#form').reset();
    $('#f-id').value = '';
    $('#f-date').value = today();
    $('#fld-custom').hidden = true;
    LABELS.forEach(function (L) { $('#s-' + L.key).value = ''; });
    $$('#f-keep .seg-b').forEach(function (b, i) { b.classList.toggle('is-on', i === 0); });
    setPhoto(null);
    $('#ocr-bar').hidden = true;
  }

  function fillForm(r) {
    $('#f-id').value = r.id;
    $('#f-date').value = r.date || today();
    $('#f-shrine').value = r.shrine || '';
    $('#f-no').value = r.no || '';
    var known = ['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶'];
    if (r.fortune && known.indexOf(r.fortune) < 0) {
      $('#f-fortune').value = '__custom';
      $('#fld-custom').hidden = false;
      $('#f-fortune-custom').value = r.fortune;
    } else {
      $('#f-fortune').value = r.fortune || '';
      $('#fld-custom').hidden = true;
      $('#f-fortune-custom').value = '';
    }
    $('#f-summary').value = r.summary || '';
    LABELS.forEach(function (L) {
      $('#s-' + L.key).value = (r.sections && r.sections[L.key]) || '';
    });
    $('#f-memo').value = r.memo || '';
    $$('#f-keep .seg-b').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.v === (r.keep || '持ち帰った'));
    });
    setPhoto(r.photo || null);
    show('record');
    window.scrollTo(0, 0);
  }

  function submitForm(e) {
    e.preventDefault();
    var rec = readForm();
    if (!rec.date) { toast('参拝日を入れてください', true); return; }
    if (!rec.shrine && !rec.fortune && !rec.summary) {
      toast('神社名か運勢か総評のどれかは入れてください', true); return;
    }
    DB.save(rec).then(function () {
      toast(rec.id ? '書き改めました' : '帖に納めました');
      resetForm();
      return reload();
    }).then(function () {
      show('list');
    }).catch(function (err) {
      toast(err.message || '保存できませんでした', true);
    });
  }

  /* ───────── 読み取り ───────── */

  function runOcr() {
    if (!state.photo) { toast('先に写真を選んでください', true); return; }
    if (!OCR.online()) {
      toast('電波のある場所で読み取れます', true);
      syncOcrButton();
      return;
    }
    if (!OCR.hasKey()) {
      toast('先に設定でGemini APIキーを入れてください', true);
      show('settings');
      setTimeout(function () { var k = $('#f-key'); if (k) k.focus(); }, 200);
      return;
    }

    var bar = $('#ocr-bar'), fill = $('#ocr-fill'), msg = $('#ocr-msg');
    bar.hidden = false; fill.style.width = '0%'; msg.textContent = '準備しています…';
    $('#btn-ocr').disabled = true;

    OCR.run(state.orig || state.photo, function (pct, label) {
      fill.style.width = pct + '%';
      msg.textContent = label + '（' + pct + '％）';
    }).then(function (p) {
      var filled = [];
      if (p.shrine && !$('#f-shrine').value) { $('#f-shrine').value = p.shrine; filled.push('神社名'); }
      if (p.no && !$('#f-no').value) { $('#f-no').value = p.no; filled.push('番号'); }
      if (p.fortune) {
        $('#f-fortune').value = p.fortune;
        $('#fld-custom').hidden = true;
        filled.push('運勢');
      }
      if (p.summary && !$('#f-summary').value) { $('#f-summary').value = p.summary; filled.push('総評'); }
      LABELS.forEach(function (L) {
        if (p.sections[L.key] && !$('#s-' + L.key).value) {
          $('#s-' + L.key).value = p.sections[L.key];
          filled.push(L.label);
        }
      });
      fill.style.width = '100%';
      if (!p.fortune) {
        var sel = $('#f-fortune');
        if (sel) { sel.style.outline = '2px solid var(--kin)'; setTimeout(function () { sel.style.outline = ''; }, 6000); }
      }
      msg.textContent = filled.length
        ? '読み取りました：' + filled.join('・') +
          (p.fortune ? '' : '　※運勢は読めませんでした。選んでください') + '　内容を確かめてください'
        : '項目を読み取れませんでした。向きを直すか、明るい場所で撮り直してお試しください';
      toast(filled.length ? '読み取りました。内容を確かめてください' : '項目を読み取れませんでした', !filled.length);
    }).catch(function (err) {
      bar.hidden = true;
      toast(err.message || '読み取れませんでした', true);
      if (err && err.needKey) {
        show('settings');
        setTimeout(function () { var k = $('#f-key'); if (k) k.focus(); }, 200);
      }
    }).then(function () {
      syncOcrButton();
    });
  }

  /** 電波とAPIキーの状態に応じて読み取りボタンを整える */
  function syncOcrButton() {
    var b = $('#btn-ocr');
    if (!b) return;
    if (!OCR.online()) {
      b.disabled = true;
      b.textContent = '電波のある場所で読み取れます';
      return;
    }
    b.textContent = '写真から文字を読み取る';
    b.disabled = !state.photo;
  }

  /* ───────── APIキー ───────── */

  function renderKeyState() {
    var el = $('#key-state');
    if (!el) return;
    if (OCR.hasKey()) {
      var k = OCR.getKey();
      el.innerHTML = '<span style="color:var(--kin)">保存済み（…' +
        esc(k.slice(-4)) + '）　読み取りが使えます</span>';
    } else {
      el.textContent = 'まだ入っていません。キーを入れると写真の読み取りが使えます。';
    }
  }

  function saveKey() {
    var v = $('#f-key').value.trim();
    if (!v) { toast('キーを入れてください', true); return; }
    OCR.setKey(v);
    $('#f-key').value = '';
    renderKeyState();
    syncOcrButton();
    toast('APIキーを保存しました');
  }

  function clearKey() {
    if (!confirm('保存したAPIキーを消します。よろしいですか？')) return;
    OCR.setKey('');
    $('#f-key').value = '';
    renderKeyState();
    syncOcrButton();
    toast('APIキーを消しました');
  }

  /* ───────── みくじ帖 ───────── */

  function fillFilters() {
    var shrines = {}, fortunes = {}, months = {};
    state.records.forEach(function (r) {
      if (r.shrine) shrines[r.shrine] = 1;
      if (r.fortune) fortunes[r.fortune] = 1;
      if (r.date) months[String(r.date).slice(0, 7)] = 1;
    });
    function opts(sel, keys, fmt) {
      var cur = sel.value;
      sel.innerHTML = '<option value="">すべて</option>' + keys.map(function (k) {
        return '<option value="' + esc(k) + '">' + esc(fmt ? fmt(k) : k) + '</option>';
      }).join('');
      if (keys.indexOf(cur) >= 0) sel.value = cur;
    }
    opts($('#q-shrine'), Object.keys(shrines).sort());
    opts($('#q-fortune'), Object.keys(fortunes).sort(function (a, b) {
      return (RANK[b] || 0) - (RANK[a] || 0);
    }));
    opts($('#q-month'), Object.keys(months).sort().reverse(), function (m) {
      var p = m.split('-'); return p[0] + '年' + Number(p[1]) + '月';
    });
  }

  function filtered() {
    var s = $('#q-shrine').value, f = $('#q-fortune').value,
      m = $('#q-month').value, sort = $('#q-sort').value;
    var rows = state.records.filter(function (r) {
      if (s && r.shrine !== s) return false;
      if (f && r.fortune !== f) return false;
      if (m && String(r.date || '').slice(0, 7) !== m) return false;
      return true;
    });
    rows.sort(function (a, b) {
      var d = String(a.date || '').localeCompare(String(b.date || ''));
      if (d === 0) d = (a.id || 0) - (b.id || 0);
      return sort === 'asc' ? d : -d;
    });
    return rows;
  }

  function renderList() {
    var rows = filtered();
    $('#list-count').textContent = state.records.length
      ? rows.length + '件' + (rows.length !== state.records.length ? '（全' + state.records.length + '件中）' : '')
      : '';
    var box = $('#list');
    if (!rows.length) {
      box.innerHTML = '<p class="empty">' + (state.records.length
        ? '条件に合うおみくじはありません。<br>絞り込みを変えてみてください。'
        : 'まだ記録がありません。<br>「記録」から最初の一枚を納めましょう。') + '</p>';
      return;
    }
    box.innerHTML = '';
    rows.forEach(function (r) {
      var b = document.createElement('button');
      b.className = 'mk';
      b.type = 'button';
      var th = r.photo
        ? '<img src="' + objUrl(r.photo) + '" alt="">'
        : '<span>写真なし</span>';
      b.innerHTML =
        '<span class="mk-th">' + th + '</span>' +
        '<span class="mk-b">' +
          '<span class="mk-d">' + esc(fmtDate(r.date)) + '</span>' +
          '<span class="mk-s">' + esc(r.shrine || '（神社名なし）') + '</span>' +
          (r.fortune ? '<span class="badge ' + badgeCls(r.fortune) + '">' + esc(r.fortune) + '</span>' : '') +
          (r.summary ? '<span class="mk-x">' + esc(r.summary.replace(/\n/g, ' ')) + '</span>' : '') +
        '</span>';
      b.addEventListener('click', function () { openDetail(r.id); });
      box.appendChild(b);
    });
  }

  function openDetail(id) {
    DB.get(id).then(function (r) {
      if (!r) { toast('記録が見つかりません', true); return; }
      var rows = '';
      function row(k, v) {
        if (!v) return '';
        return '<div class="dt-row"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>';
      }
      rows += row('参拝日', fmtDate(r.date));
      rows += row('神社', r.shrine);
      rows += row('番号', r.no);
      rows += row('総評', r.summary);
      LABELS.forEach(function (L) {
        rows += row(L.label, r.sections && r.sections[L.key]);
      });
      rows += row('メモ', r.memo);
      rows += row('行方', r.keep);

      $('#sheet-body').innerHTML =
        (r.photo ? '<img class="dt-img" src="' + objUrl(r.photo) + '" alt="おみくじの写真">' : '') +
        (r.fortune ? '<p style="text-align:center;margin:0 0 16px"><span class="badge big ' +
          badgeCls(r.fortune) + '">' + esc(r.fortune) + '</span></p>' : '') +
        '<dl style="margin:0">' + rows + '</dl>' +
        '<div class="dt-btns">' +
          '<button class="btn btn-line" id="dt-edit">書き直す</button>' +
          '<button class="btn btn-danger" id="dt-del">この記録を消す</button>' +
        '</div>';
      $('#sheet').hidden = false;
      $('#dt-edit').addEventListener('click', function () {
        closeSheet(); fillForm(r);
      });
      $('#dt-del').addEventListener('click', function () {
        if (!confirm('この記録を消します。よろしいですか？')) return;
        DB.remove(r.id).then(function () {
          closeSheet(); toast('記録を消しました'); return reload();
        }).catch(function () { toast('削除できませんでした', true); });
      });
    });
  }

  function closeSheet() { $('#sheet').hidden = true; $('#sheet-body').innerHTML = ''; }

  /* ───────── 指針 ───────── */

  var STOP = ('こと もの これ それ あれ ため よう そう ところ とき 場合 자 事 物 今 人 方 気 心 少し 大変 大切 注意 用心 慎 吉凶 御籤 神様 神社 参拝')
    .split(/\s+/);

  function keywords(rows, limit) {
    var cnt = {};
    rows.forEach(function (r) {
      var txt = [r.summary || ''];
      if (r.sections) Object.keys(r.sections).forEach(function (k) { txt.push(r.sections[k]); });
      var s = txt.join(' ');
      var words = (s.match(/[一-龥]{2,4}|[ァ-ヶー]{3,6}/g) || []);
      words.forEach(function (w) {
        if (STOP.indexOf(w) >= 0) return;
        cnt[w] = (cnt[w] || 0) + 1;
      });
    });
    var min = rows.length >= 8 ? 2 : 1;
    return Object.keys(cnt)
      .filter(function (k) { return cnt[k] >= min; })
      .sort(function (a, b) { return cnt[b] - cnt[a]; })
      .slice(0, limit || 6)
      .map(function (k) { return { word: k, n: cnt[k] }; });
  }

  function trend(rows) {
    var ranked = rows.slice().sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date));
    }).filter(function (r) { return RANK[r.fortune]; });
    if (ranked.length < 4) return { kind: 'few', n: ranked.length };
    var last = ranked.slice(-3), prev = ranked.slice(-6, -3);
    if (!prev.length) return { kind: 'few', n: ranked.length };
    var avg = function (a) {
      return a.reduce(function (s, r) { return s + RANK[r.fortune]; }, 0) / a.length;
    };
    var d = avg(last) - avg(prev);
    return {
      kind: d >= 0.7 ? 'up' : (d <= -0.7 ? 'down' : 'flat'),
      diff: Math.round(d * 10) / 10,
      recent: Math.round(avg(last) * 10) / 10
    };
  }

  function kyoRun(rows) {
    var sorted = rows.slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    });
    var n = 0;
    for (var i = 0; i < sorted.length; i++) {
      if (KYO.indexOf(sorted[i].fortune) >= 0) n++; else break;
    }
    return n;
  }

  var STEPS = {
    wish: '願いごとをひとつだけ紙に書き出して、目に入る場所に置いてみましょう。',
    health: '今日は早めに休む時間をつくり、体をいたわりましょう。',
    love: '気にかけている人へ、短くていいので連絡を取ってみましょう。',
    marriage: '身近な人との縁を大切に、感謝をひとこと伝えてみましょう。',
    work: '手をつけられずにいた仕事を、ひとつだけ片づけましょう。',
    study: '机に向かう時間を15分だけ確保してみましょう。',
    money: '今月の出入りを見返して、ひとつ無駄を減らしてみましょう。',
    travel: '行ってみたい場所を調べて、日付を仮でも決めてみましょう。',
    wait: '待つより先に、こちらから一歩たずねてみましょう。',
    lost: '探しものは、最後に触れた場所をもう一度だけ見てみましょう。'
  };

  function renderGuide() {
    var box = $('#guide');
    var rows = state.records;
    if (!rows.length) {
      box.innerHTML = '<p class="empty">まだ御神託がありません。<br>おみくじを記録すると、ここに指針が現れます。</p>';
      return;
    }
    var latest = rows[0];
    var html = '';

    /* 今の御神託 */
    html += '<div class="oracle">' +
      '<div class="oracle-lb">い ま の 御 神 託</div>' +
      (latest.fortune ? '<span class="badge big ' + badgeCls(latest.fortune) + '">' +
        esc(latest.fortune) + '</span>' : '<span class="badge big mut">記録済</span>') +
      '<div class="oracle-dt">' + esc(fmtDate(latest.date)) +
        (latest.shrine ? '　' + esc(latest.shrine) : '') + '</div>' +
      (latest.summary ? '<p class="oracle-tx">' + esc(latest.summary) + '</p>' : '') +
      '</div>';

    /* 運勢の流れ */
    var t = trend(rows);
    var tText;
    if (t.kind === 'up') tText = '運勢は上向きに転じています。いま動くと流れに乗りやすい時期です。積み上げてきたことを、そのまま前へ進めてください。';
    else if (t.kind === 'down') tText = '運勢はやや下り坂です。新しく広げるより、いま手元にあるものを守り整える時期と読みます。無理をしないことが最良の一手です。';
    else if (t.kind === 'flat') tText = '運勢は安定しています。大きな波がないぶん、地道な積み重ねがそのまま実りにつながります。';
    else tText = 'まだ記録が少なく、流れは読み切れません。数回重ねると、あなたの運勢の傾きが見えてきます。';
    html += '<div class="gd"><h3 class="gd-h">運勢の流れ</h3><p class="gd-b">' + tText + '</p></div>';

    /* 凶が続くとき */
    var kr = kyoRun(rows);
    if (kr >= 2) {
      html += '<div class="gd"><h3 class="gd-h">凶が続いています</h3><p class="gd-b">' +
        '凶が' + kr + '回続いています。おみくじの凶は「戒め」であって、結果を決めるものではありません。' +
        'いまは焦らず基盤を固める時期です。手を広げず、日々の勤めと体調を整えることが、次の吉につながります。' +
        '</p></div>';
    }

    /* 今月のテーマ */
    var kw = keywords(rows, 6);
    if (kw.length) {
      html += '<div class="gd"><h3 class="gd-h">くり返し現れる言葉</h3>' +
        '<p class="gd-b" style="margin-bottom:10px">おみくじが繰り返し告げている言葉です。いまのあなたの主題と読めます。</p>' +
        '<div class="chips">' + kw.map(function (k) {
          return '<span class="chip">' + esc(k.word) + '<b>' + k.n + '</b></span>';
        }).join('') + '</div></div>';
    }

    /* 今日の一歩 */
    var step = null;
    if (latest.sections) {
      var keys = Object.keys(latest.sections);
      if (keys.length) {
        var pick = keys[new Date().getDate() % keys.length];
        var L = LABELS.filter(function (x) { return x.key === pick; })[0];
        if (STEPS[pick]) {
          step = { label: L ? L.label : '', text: STEPS[pick], quote: latest.sections[pick] };
        }
      }
    }
    if (!step) {
      step = { label: '', text: KYO.indexOf(latest.fortune) >= 0
        ? '今日は新しいことを始めず、身のまわりをひとつ整えることに使いましょう。'
        : '今日のうちに、小さくてよいので前に進む用事をひとつ済ませましょう。', quote: '' };
    }
    html += '<div class="gd gd-step"><h3 class="gd-h">今日の一歩' +
      (step.label ? '（' + esc(step.label) + '）' : '') + '</h3>' +
      '<p class="gd-b">' + esc(step.text) + '</p>' +
      (step.quote ? '<p class="note">みくじの言葉：' + esc(step.quote) + '</p>' : '') +
      '</div>';

    box.innerHTML = html;
  }

  /* ───────── 統計（Canvasで自前描画） ───────── */

  function cssVar(n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#999';
  }

  function prep(cv, h) {
    var dpr = window.devicePixelRatio || 1;
    var w = cv.parentNode.clientWidth - 30;
    if (w < 120) w = 120;
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.height = h + 'px';
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    return { c: c, w: w, h: h };
  }

  function colorOf(f) {
    if (f === '大吉') return cssVar('--kin');
    if (KYO.indexOf(f) >= 0) return cssVar('--ai');
    if (RANK[f]) return cssVar('--shu');
    return cssVar('--mut');
  }

  function drawPie(cv, data) {
    var g = prep(cv, 190), c = g.c;
    var total = data.reduce(function (s, d) { return s + d.n; }, 0);
    if (!total) return;
    var cx = g.w / 2, cy = 95, r = 72, a = -Math.PI / 2;
    data.forEach(function (d, i) {
      var sweep = d.n / total * Math.PI * 2;
      c.beginPath();
      c.moveTo(cx, cy);
      c.arc(cx, cy, r, a, a + sweep);
      c.closePath();
      c.fillStyle = colorOf(d.key);
      c.globalAlpha = 1 - (i % 3) * 0.16;
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = cssVar('--paper2');
      c.lineWidth = 2;
      c.stroke();
      a += sweep;
    });
    c.beginPath();
    c.arc(cx, cy, 34, 0, Math.PI * 2);
    c.fillStyle = cssVar('--paper2');
    c.fill();
    c.fillStyle = cssVar('--sumi');
    c.font = '600 17px "Hiragino Mincho ProN", serif';
    c.textAlign = 'center';
    c.fillText(String(total), cx, cy + 1);
    c.font = '10px "Hiragino Mincho ProN", serif';
    c.fillStyle = cssVar('--mut');
    c.fillText('件', cx, cy + 15);
  }

  function drawLine(cv, pts) {
    var g = prep(cv, 190), c = g.c;
    var padL = 30, padR = 12, padT = 14, padB = 30;
    var W = g.w - padL - padR, H = g.h - padT - padB;
    c.strokeStyle = cssVar('--line');
    c.lineWidth = 1;
    [1, 4, 7].forEach(function (v) {
      var y = padT + H - (v - 1) / 6 * H;
      c.beginPath(); c.moveTo(padL, y); c.lineTo(padL + W, y); c.stroke();
      c.fillStyle = cssVar('--mut');
      c.font = '10px "Hiragino Mincho ProN", serif';
      c.textAlign = 'right';
      c.fillText(v === 7 ? '大吉' : (v === 4 ? '吉' : '大凶'), padL - 6, y + 3);
    });
    if (pts.length < 2) {
      c.fillStyle = cssVar('--mut');
      c.textAlign = 'center';
      c.fillText('2か月以上の記録で推移が出ます', padL + W / 2, padT + H / 2);
      return;
    }
    var stepX = W / (pts.length - 1);
    c.beginPath();
    pts.forEach(function (p, i) {
      var x = padL + stepX * i, y = padT + H - (p.v - 1) / 6 * H;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    });
    c.strokeStyle = cssVar('--shu');
    c.lineWidth = 2;
    c.stroke();
    pts.forEach(function (p, i) {
      var x = padL + stepX * i, y = padT + H - (p.v - 1) / 6 * H;
      c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2);
      c.fillStyle = cssVar('--shu'); c.fill();
      if (i === 0 || i === pts.length - 1 || pts.length <= 6) {
        c.fillStyle = cssVar('--mut');
        c.font = '9.5px "Hiragino Mincho ProN", serif';
        c.textAlign = 'center';
        c.fillText(p.label, x, g.h - 10);
      }
    });
  }

  function drawBar(cv, data) {
    var rows = data.slice(0, 6);
    var h = Math.max(120, rows.length * 30 + 20);
    var g = prep(cv, h), c = g.c;
    var max = Math.max.apply(null, rows.map(function (d) { return d.n; }));
    var labelW = Math.min(110, g.w * 0.38);
    rows.forEach(function (d, i) {
      var y = 12 + i * 30;
      c.fillStyle = cssVar('--sumi');
      c.font = '12px "Hiragino Mincho ProN", serif';
      c.textAlign = 'left';
      var name = d.key.length > 7 ? d.key.slice(0, 7) + '…' : d.key;
      c.fillText(name, 0, y + 13);
      var bw = (g.w - labelW - 26) * (d.n / max);
      c.fillStyle = cssVar('--shu');
      c.fillRect(labelW, y + 3, Math.max(2, bw), 13);
      c.fillStyle = cssVar('--mut');
      c.font = '11px "Hiragino Mincho ProN", serif';
      c.fillText(String(d.n), labelW + Math.max(2, bw) + 6, y + 14);
    });
  }

  function renderStats() {
    var box = $('#stats');
    var rows = state.records;
    if (!rows.length) {
      box.innerHTML = '<p class="empty">記録が集まると、ここに運勢の姿が現れます。</p>';
      return;
    }
    var fc = {}, sc = {}, mm = {};
    rows.forEach(function (r) {
      if (r.fortune) fc[r.fortune] = (fc[r.fortune] || 0) + 1;
      if (r.shrine) sc[r.shrine] = (sc[r.shrine] || 0) + 1;
      if (r.date && RANK[r.fortune]) {
        var k = String(r.date).slice(0, 7);
        (mm[k] = mm[k] || []).push(RANK[r.fortune]);
      }
    });
    var fData = Object.keys(fc).sort(function (a, b) {
      return (RANK[b] || 0) - (RANK[a] || 0);
    }).map(function (k) { return { key: k, n: fc[k] }; });
    var sData = Object.keys(sc).sort(function (a, b) { return sc[b] - sc[a]; })
      .map(function (k) { return { key: k, n: sc[k] }; });
    var mData = Object.keys(mm).sort().map(function (k) {
      var a = mm[k];
      return {
        label: Number(k.split('-')[1]) + '月',
        v: a.reduce(function (s, v) { return s + v; }, 0) / a.length
      };
    });

    box.innerHTML =
      '<div class="chart"><h3>運勢の分布</h3><canvas id="cv-pie"></canvas>' +
        '<div class="legend">' + fData.map(function (d) {
          return '<span><i style="background:' + colorOf(d.key) + '"></i>' +
            esc(d.key) + ' ' + d.n + '</span>';
        }).join('') + '</div></div>' +
      '<div class="chart"><h3>月ごとの運勢の推移</h3><canvas id="cv-line"></canvas></div>' +
      '<div class="chart"><h3>神社ごとの参拝回数</h3><canvas id="cv-bar"></canvas></div>';

    drawPie($('#cv-pie'), fData);
    drawLine($('#cv-line'), mData);
    drawBar($('#cv-bar'), sData);
  }

  /* ───────── 控え（書き出し・読み込み） ───────── */

  function blobToDataUrl(b) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error('写真を書き出せませんでした')); };
      fr.readAsDataURL(b);
    });
  }

  function exportAll() {
    DB.all().then(function (rows) {
      if (!rows.length) { toast('書き出す記録がありません', true); return null; }
      return Promise.all(rows.map(function (r) {
        var o = Object.assign({}, r);
        delete o.photo;
        if (!r.photo) return Promise.resolve(o);
        return blobToDataUrl(r.photo).then(function (d) { o.photoData = d; return o; });
      })).then(function (list) {
        var data = {
          app: '御神籤帖', version: 1,
          exportedAt: new Date().toISOString(),
          count: list.length, records: list
        };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'goshinsencho-' + today() + '.json';
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
        toast(list.length + '件を書き出しました');
      });
    }).catch(function (err) { toast(err.message || '書き出せませんでした', true); });
  }

  function importAll(file) {
    if (!file) return;
    file.text().then(function (txt) {
      var data = JSON.parse(txt);
      var list = data && data.records;
      if (!Array.isArray(list)) throw new Error('この形式のファイルは読み込めません');
      return list.reduce(function (chain, r) {
        return chain.then(function () {
          var o = Object.assign({}, r);
          delete o.id;
          var p = Promise.resolve(null);
          if (o.photoData) {
            p = fetch(o.photoData).then(function (res) { return res.blob(); }).catch(function () { return null; });
          }
          delete o.photoData;
          return p.then(function (blob) {
            if (blob) o.photo = blob;
            return DB.save(o);
          });
        });
      }, Promise.resolve()).then(function () { return list.length; });
    }).then(function (n) {
      toast(n + '件を読み込みました');
      return reload();
    }).catch(function (err) {
      toast(err.message || '読み込めませんでした', true);
    });
  }

  function clearAll() {
    if (!confirm('すべての記録と写真を消します。よろしいですか？')) return;
    if (!confirm('元に戻せません。本当に消してよろしいですか？')) return;
    DB.clear().then(function () {
      toast('すべて消しました');
      return reload();
    }).catch(function () { toast('削除できませんでした', true); });
  }

  /* ───────── 初回の案内 ───────── */

  var TOUR = [
    { n: '其の一', t: 'おみくじを写す', x: 'おみくじを撮るか、アルバムから選びます。写真は端末の中だけに保存され、外へは出ません。' },
    { n: '其の二', t: '文字を読み取る', x: '「写真から文字を読み取る」を押すと、運勢や項目を下書きします。読み違いがあるので、目で確かめて直してください。' },
    { n: '其の三', t: '指針を受け取る', x: '記録が重なると、「指針」に運勢の流れとくり返し現れる言葉、そして今日の一歩が現れます。' }
  ];
  var tourAt = 0;

  function showTour(i) {
    tourAt = i;
    var s = TOUR[i];
    $('#tour-body').innerHTML =
      '<div class="tour-n">' + esc(s.n) + '</div>' +
      '<h3 class="tour-t">' + esc(s.t) + '</h3>' +
      '<p class="tour-x">' + esc(s.x) + '</p>';
    $('#tour-dots').innerHTML = TOUR.map(function (_, k) {
      return '<i class="' + (k === i ? 'is-on' : '') + '"></i>';
    }).join('');
    $('#tour-next').textContent = (i === TOUR.length - 1) ? 'はじめる' : '次へ';
    $('#tour').hidden = false;
  }
  function endTour() {
    $('#tour').hidden = true;
    localStorage.setItem('gsc.tour', '1');
  }

  /* ───────── タブ ───────── */

  function show(name) {
    $$('.tab').forEach(function (t) { t.classList.toggle('is-on', t.id === 'tab-' + name); });
    $$('.tb').forEach(function (b) { b.classList.toggle('is-on', b.dataset.tab === name); });
    if (name === 'guide') renderGuide();
    if (name === 'stats') renderStats();
    if (name === 'list') { fillFilters(); renderList(); }
    window.scrollTo(0, 0);
  }

  function reload() {
    releaseUrls();
    return DB.all().then(function (rows) {
      state.records = rows;
      fillFilters();
      renderList();
      return fillShrineOptions();
    });
  }

  /* ───────── 起動 ───────── */

  function init() {
    initTheme();
    buildSections();
    $('#f-date').value = today();

    $('#pick-camera').addEventListener('change', onPick);
    $('#pick-album').addEventListener('change', onPick);
    $('#btn-ocr').addEventListener('click', runOcr);
    $('#rot-l').addEventListener('click', function () { rotatePhoto(-90); });
    $('#rot-r').addEventListener('click', function () { rotatePhoto(90); });
    $('#form').addEventListener('submit', submitForm);
    $('#btn-reset').addEventListener('click', function () {
      resetForm(); toast('入力を消しました');
    });
    $('#f-fortune').addEventListener('change', function () {
      $('#fld-custom').hidden = this.value !== '__custom';
    });
    $$('#f-keep .seg-b').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#f-keep .seg-b').forEach(function (x) { x.classList.remove('is-on'); });
        b.classList.add('is-on');
      });
    });

    ['#q-shrine', '#q-fortune', '#q-month', '#q-sort'].forEach(function (s) {
      $(s).addEventListener('change', renderList);
    });

    $('#nav').addEventListener('click', function (e) {
      var b = e.target.closest('.tb');
      if (b) show(b.dataset.tab);
    });

    $('#sheet-close').addEventListener('click', closeSheet);
    $('#sheet').addEventListener('click', function (e) {
      if (e.target === this) closeSheet();
    });

    $('#btn-key-save').addEventListener('click', saveKey);
    $('#btn-key-clear').addEventListener('click', clearKey);
    renderKeyState();
    syncOcrButton();
    $('#btn-theme').addEventListener('click', toggleTheme);
    $('#btn-export').addEventListener('click', exportAll);
    $('#btn-import').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      importAll(f);
    });
    $('#btn-clear').addEventListener('click', clearAll);
    $('#btn-guide-again').addEventListener('click', function () { showTour(0); });

    $('#tour-skip').addEventListener('click', endTour);
    $('#tour-next').addEventListener('click', function () {
      if (tourAt >= TOUR.length - 1) endTour(); else showTour(tourAt + 1);
    });

    window.addEventListener('resize', function () {
      if ($('#tab-stats').classList.contains('is-on')) renderStats();
    });
    window.addEventListener('offline', function () {
      syncOcrButton();
      toast('オフラインになりました。読み取りは使えませんが、記録はできます');
    });
    window.addEventListener('online', function () { syncOcrButton(); });

    reload().then(function () {
      if (!localStorage.getItem('gsc.tour')) showTour(0);
    }).catch(function (err) {
      toast(err.message || '記録を読み込めませんでした', true);
    });

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
