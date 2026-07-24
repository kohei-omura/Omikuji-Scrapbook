/* 御神籤帖 — IndexedDB
   記録（写真Blobを含む）はこの端末の中だけに保存されます。 */
(function (global) {
  'use strict';

  var NAME = 'goshinsencho';
  var VER = 1;
  var STORE = 'omikuji';
  var _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(NAME, VER);
      rq.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var st = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          st.createIndex('date', 'date', { unique: false });
          st.createIndex('shrine', 'shrine', { unique: false });
          st.createIndex('fortune', 'fortune', { unique: false });
        }
      };
      rq.onsuccess = function () { _db = rq.result; res(_db); };
      rq.onerror = function () { rej(rq.error || new Error('データベースを開けません')); };
    });
  }

  function tx(mode) {
    return open().then(function (db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    });
  }

  function wrap(request) {
    return new Promise(function (res, rej) {
      request.onsuccess = function () { res(request.result); };
      request.onerror = function () { rej(request.error || new Error('保存に失敗しました')); };
    });
  }

  var DB = {
    /** 全件取得（新しい日付順） */
    all: function () {
      return tx('readonly').then(function (st) { return wrap(st.getAll()); })
        .then(function (rows) {
          rows.sort(function (a, b) {
            var d = String(b.date || '').localeCompare(String(a.date || ''));
            return d !== 0 ? d : (b.id - a.id);
          });
          return rows;
        });
    },
    get: function (id) {
      return tx('readonly').then(function (st) { return wrap(st.get(Number(id))); });
    },
    /** id があれば更新、無ければ追加 */
    save: function (rec) {
      var r = Object.assign({}, rec);
      if (r.id === '' || r.id === null || r.id === undefined) delete r.id;
      else r.id = Number(r.id);
      r.savedAt = Date.now();
      return tx('readwrite').then(function (st) { return wrap(st.put(r)); });
    },
    remove: function (id) {
      return tx('readwrite').then(function (st) { return wrap(st.delete(Number(id))); });
    },
    clear: function () {
      return tx('readwrite').then(function (st) { return wrap(st.clear()); });
    },
    /** 神社名の候補（登場回数の多い順） */
    shrines: function () {
      return DB.all().then(function (rows) {
        var m = {};
        rows.forEach(function (r) { if (r.shrine) m[r.shrine] = (m[r.shrine] || 0) + 1; });
        return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
      });
    }
  };

  global.DB = DB;
})(window);
