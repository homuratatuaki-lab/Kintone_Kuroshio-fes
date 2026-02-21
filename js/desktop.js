(function() {
  'use strict';

  var overlayId = 'festival-sync-overlay';

  // プラグイン読み込み時に PLUGIN_ID を保持（アプリ画面で getConfig するため。複数プラグイン時も自プラグインIDを確実に使う）
  var DESKTOP_PLUGIN_ID = null;
  try {
    if (typeof kintone !== 'undefined' && typeof kintone.$PLUGIN_ID !== 'undefined' && kintone.$PLUGIN_ID) {
      DESKTOP_PLUGIN_ID = String(kintone.$PLUGIN_ID);
    }
  } catch (e) {}

  function getPluginId() {
    if (DESKTOP_PLUGIN_ID) return DESKTOP_PLUGIN_ID;
    try {
      if (typeof kintone !== 'undefined' && typeof kintone.$PLUGIN_ID !== 'undefined' && kintone.$PLUGIN_ID) {
        return String(kintone.$PLUGIN_ID);
      }
      if (typeof location !== 'undefined' && location.search) {
        var m = location.search.match(/pluginId=([^&]+)/);
        if (m) return m[1];
      }
    } catch (e) {}
    return null;
  }

  function getConfig() {
    try {
      var pluginId = getPluginId();
      if (!pluginId || typeof kintone === 'undefined' || typeof kintone.plugin === 'undefined' || typeof kintone.plugin.app.getConfig !== 'function') {
        return null;
      }
      var raw = kintone.plugin.app.getConfig(pluginId);
      if (!raw) return null;
      if (typeof raw === 'string') return JSON.parse(raw);
      if (raw && typeof raw.config === 'string') return JSON.parse(raw.config);
      return raw;
    } catch (e) {
      return null;
    }
  }

  function showOverlay(progressText, onCancelClick) {
    var el = document.getElementById(overlayId);
    if (el) {
      var txt = el.querySelector('.festival-sync-overlay-text');
      if (txt) txt.textContent = progressText || '処理中…';
      var cancelBtn = el.querySelector('.festival-sync-cancel-btn');
      if (cancelBtn && typeof onCancelClick === 'function') {
        cancelBtn.onclick = onCancelClick;
        cancelBtn.style.display = '';
      }
      return;
    }
    el = document.createElement('div');
    el.id = overlayId;
    el.className = 'festival-sync-overlay';
    el.innerHTML =
      '<div class="festival-sync-overlay-inner">' +
        '<div class="festival-sync-spinner"></div>' +
        '<p class="festival-sync-overlay-text">' + (progressText || '処理中…') + '</p>' +
        '<button type="button" class="festival-sync-cancel-btn" style="margin-top:12px;">中止</button>' +
      '</div>';
    document.body.appendChild(el);
    var cancelBtn = el.querySelector('.festival-sync-cancel-btn');
    if (cancelBtn && typeof onCancelClick === 'function') cancelBtn.onclick = onCancelClick;
  }

  function updateOverlayProgress(text) {
    var el = document.getElementById(overlayId);
    if (el) {
      var txt = el.querySelector('.festival-sync-overlay-text');
      if (txt) txt.textContent = text;
    }
  }

  function hideOverlay() {
    var el = document.getElementById(overlayId);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function addSyncButton() {
    var header = kintone.app.getHeaderSpaceElement();
    if (!header) return;

    var toolbar = document.createElement('div');
    toolbar.className = 'festival-sync-toolbar';
    toolbar.innerHTML =
      '<button type="button" class="btn-sync">一括同期を実行</button>' +
      '<div class="sync-message" id="festival-sync-message"></div>';
    header.appendChild(toolbar);

    var btn = toolbar.querySelector('.btn-sync');
    var msgEl = document.getElementById('festival-sync-message');

    function setMessage(text, isError) {
      if (msgEl) {
        msgEl.textContent = text;
        msgEl.className = 'sync-message' + (isError ? ' error' : ' success');
      }
    }

    btn.addEventListener('click', function() {
      if (!window.FestivalSync || !window.FestivalSync.runSync) {
        setMessage('同期スクリプトの読み込みに失敗しています。', true);
        alert('エラー: 同期スクリプトの読み込みに失敗しています。');
        return;
      }
      var isCancelled = false;
      btn.disabled = true;
      setMessage('', false);
      showOverlay('同期を実行しています…', function() {
        isCancelled = true;
      });

      var onProgress = function(phase, current, total, contactUpdated) {
        var text = phase || '処理中…';
        if (total > 0) {
          text += ' ' + current + ' / ' + total + ' 件';
        }
        if (contactUpdated > 0) {
          text += '（連絡先 ' + contactUpdated + ' 件更新済）';
        }
        text += '…';
        updateOverlayProgress(text);
      };

      var getIsCancelled = function() { return isCancelled; };

      window.FestivalSync.runSync(onProgress, getIsCancelled)
        .then(function(result) {
          if (isCancelled) return;
          updateOverlayProgress(
            '完了: 団体管理 ' + (result.updated || 0) + ' 件、連絡先 ' + (result.contactUpdated || 0) + ' 件更新'
          );
          setTimeout(function() {
            hideOverlay();
            setMessage(
              '同期完了: 団体管理 ' + (result.updated || 0) + ' 件更新、連絡先 ' + (result.contactUpdated || 0) + ' 件更新',
              false
            );
            btn.disabled = false;
            location.reload();
          }, 800);
        })
        .catch(function(err) {
          hideOverlay();
          var msg = err && err.message ? err.message : String(err);
          setMessage('エラー: ' + msg, true);
          btn.disabled = false;
          if (msg === 'CANCELLED') {
            alert('処理を中断しました');
          } else {
            alert('エラー: ' + msg);
          }
        });
    });
  }

  function addContactListViewFilter(config) {
    var header = kintone.app.getHeaderSpaceElement();
    if (!header || !config) return;

    var viewSettings = Array.isArray(config.contactViewSettings) ? config.contactViewSettings : [];
    var hasViewSettings = viewSettings.length > 0 && viewSettings.some(function(v) { return v.fieldCode; });
    if (!hasViewSettings) return;

    var ROW_ID_PREFIX = 'festival-filter-row-';
    var rowCounter = 0;
    var appId = null;
    try {
      if (typeof kintone !== 'undefined' && kintone.app && typeof kintone.app.getId === 'function') {
        appId = kintone.app.getId();
      }
    } catch (e) {}

    function escapeQueryValue(s) {
      if (s == null) return '';
      s = String(s);
      return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function unescapeQueryValue(s) {
      if (s == null) return '';
      s = String(s);
      return s.replace(/\\\\/g, '\u0000').replace(/\\"/g, '"').replace(/\u0000/g, '\\');
    }

    function loadFieldValues(fieldCode, done) {
      if (!appId || !fieldCode || typeof kintone === 'undefined' || typeof kintone.api !== 'function') {
        if (typeof done === 'function') done([]);
        return;
      }
      var url = kintone.api.url('/k/v1/records', true);
      var params = { app: appId, query: 'limit 500', fields: [fieldCode] };
      kintone.api(url, 'GET', params).then(function(resp) {
        var set = {};
        var list = [];
        (resp.records || []).forEach(function(r) {
          var f = r[fieldCode];
          var raw = (f && f.value != null) ? (Array.isArray(f.value) ? f.value[0] : f.value) : null;
          if (raw === null || raw === undefined) return;
          var v = (typeof raw === 'object' && raw !== null && ('code' in raw || 'value' in raw))
            ? (raw.code != null ? raw.code : raw.value)
            : raw;
          v = (v != null && v !== '') ? String(v).trim() : '';
          if (v && !set[v]) { set[v] = true; list.push(v); }
        });
        list.sort();
        if (typeof done === 'function') done(list);
      }).catch(function() {
        if (typeof done === 'function') done([]);
      });
    }

    function buildQueryFromTable() {
      var tbody = document.getElementById('festival-filter-tbody');
      if (!tbody) return '';
      var rows = [];
      [].forEach.call(tbody.querySelectorAll('tr'), function(tr) {
        var fieldSel = tr.querySelector('.festival-filter-field');
        var opSel = tr.querySelector('.festival-filter-op');
        var condSel = tr.querySelector('.festival-filter-cond');
        var joinSel = tr.querySelector('.festival-filter-join');
        if (!fieldSel || !condSel || fieldSel.value === '' || condSel.value === '') return;
        var idx = parseInt(fieldSel.value, 10);
        if (isNaN(idx) || !viewSettings[idx] || !viewSettings[idx].fieldCode) return;
        var op = (opSel && opSel.value === 'neq') ? '!=' : '=';
        var val = condSel.value;
        var cond = viewSettings[idx].fieldCode + ' ' + op + ' "' + escapeQueryValue(val) + '"';
        rows.push({ cond: cond, join: joinSel ? joinSel.value : 'and' });
      });
      if (rows.length === 0) return '';
      if (rows.length === 1) return rows[0].cond;
      var acc = rows[0].cond;
      for (var i = 1; i < rows.length; i++) {
        var prevJoin = rows[i - 1].join;
        if (prevJoin === 'or') acc = '(' + acc + ') or ' + rows[i].cond;
        else acc = acc + ' and ' + rows[i].cond;
      }
      return acc;
    }

    function applyFilterByUrl(queryString) {
      var url = typeof location !== 'undefined' ? (location.pathname || '') + (location.search || '') : '';
      var base = url.split('?')[0] || '';
      var params = new URLSearchParams(url.indexOf('?') !== -1 ? url.substring(url.indexOf('?') + 1) : '');
      if (queryString) params.set('query', queryString);
      else params.delete('query');
      var newSearch = params.toString();
      var newUrl = base + (newSearch ? '?' + newSearch : '');
      if (newUrl !== url) location.assign(newUrl);
    }

    function parseQueryToRows(query) {
      if (!query || !query.trim()) return [];
      var rows = [];
      var orParts = query.split(/\s+or\s+/i);
      orParts.forEach(function(part, orIdx) {
        part = part.replace(/^\s*\(\s*|\s*\)\s*$/g, '').trim();
        var andParts = part.split(/\s+and\s+/i);
        andParts.forEach(function(andPart, andIdx) {
          var m = andPart.trim().match(/^(\S+)\s*(!?=)\s*"((?:[^"\\]|\\.)*)"\s*$/);
          if (!m) return;
          var fieldCode = m[1];
          var op = (m[2] === '!=') ? 'neq' : 'eq';
          var val = unescapeQueryValue(m[3]);
          var idx = viewSettings.findIndex(function(v) { return v && v.fieldCode === fieldCode; });
          if (idx === -1) return;
          var join = (andIdx < andParts.length - 1) ? 'and' : (orIdx < orParts.length - 1 ? 'or' : 'and');
          rows.push({ fieldIdx: idx, op: op, cond: val, join: join });
        });
      });
      if (rows.length > 0) rows[rows.length - 1].join = 'and';
      return rows;
    }

    function getQueryFromUrl() {
      try {
        if (typeof location !== 'undefined' && location.search) {
          var params = new URLSearchParams(location.search);
          return (params.get('query') || '').trim();
        }
      } catch (e) {}
      return '';
    }

    function fillCondSelect(condSel, values, selectedValue) {
      if (!condSel) return;
      condSel.innerHTML = '<option value="">—</option>';
      var found = false;
      (values || []).forEach(function(v) {
        var opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        if (selectedValue !== undefined && selectedValue !== null && String(v) === String(selectedValue)) {
          opt.selected = true;
          found = true;
        }
        condSel.appendChild(opt);
      });
      if (selectedValue !== undefined && selectedValue !== null && !found) {
        var extra = document.createElement('option');
        extra.value = selectedValue;
        extra.textContent = selectedValue;
        extra.selected = true;
        condSel.appendChild(extra);
      }
    }

    function createRow(data) {
      data = data || {};
      var tr = document.createElement('tr');
      tr.className = 'festival-filter-row';
      var fieldOpts = '<option value="">指定しない</option>';
      viewSettings.forEach(function(v, i) {
        if (!v.fieldCode) return;
        var label = (v.name && v.name.trim()) ? v.name.trim() : ('提出物' + (i + 1));
        var selected = data.fieldIdx === i ? ' selected' : '';
        fieldOpts += '<option value="' + i + '"' + selected + '>' + escapeHtml(label) + '</option>';
      });
      var joinVal = data.join === 'or' ? 'or' : 'and';
      var opVal = data.op === 'neq' ? 'neq' : 'eq';
      tr.innerHTML =
        '<td class="kintoneplugin-table-td-control"><div class="kintoneplugin-table-td-control-value"><select class="festival-filter-field">' + fieldOpts + '</select></div></td>' +
        '<td class="kintoneplugin-table-td-control"><div class="kintoneplugin-table-td-control-value festival-filter-cond-cell"><select class="festival-filter-op"><option value="eq"' + (opVal === 'eq' ? ' selected' : '') + '>＝</option><option value="neq"' + (opVal === 'neq' ? ' selected' : '') + '>≠</option></select><select class="festival-filter-cond"><option value="">—</option></select></div></td>' +
        '<td class="kintoneplugin-table-td-control festival-filter-join-cell"><div class="kintoneplugin-table-td-control-value"><select class="festival-filter-join"><option value="and"' + (joinVal === 'and' ? ' selected' : '') + '>AND</option><option value="or"' + (joinVal === 'or' ? ' selected' : '') + '>OR</option></select></div></td>' +
        '<td class="kintoneplugin-table-td-operation"><button type="button" class="festival-filter-add festival-filter-btn-circle festival-filter-btn-add" title="行を追加">＋</button><button type="button" class="festival-filter-del festival-filter-btn-circle festival-filter-btn-del" title="行を削除">−</button></td>';
      var fieldSel = tr.querySelector('.festival-filter-field');
      var condSel = tr.querySelector('.festival-filter-cond');
      fieldSel.addEventListener('change', function() {
        var idx = fieldSel.value === '' ? -1 : parseInt(fieldSel.value, 10);
        condSel.innerHTML = '<option value="">—</option>';
        condSel.disabled = true;
        if (idx < 0 || !viewSettings[idx] || !viewSettings[idx].fieldCode) {
          condSel.disabled = false;
          return;
        }
        condSel.innerHTML = '<option value="">読み込み中…</option>';
        loadFieldValues(viewSettings[idx].fieldCode, function(list) {
          fillCondSelect(condSel, list);
          condSel.disabled = false;
        });
      });
      if (data.fieldIdx !== undefined && data.fieldIdx !== '' && viewSettings[data.fieldIdx] && viewSettings[data.fieldIdx].fieldCode) {
        condSel.innerHTML = '<option value="">読み込み中…</option>';
        condSel.disabled = true;
        loadFieldValues(viewSettings[data.fieldIdx].fieldCode, function(list) {
          fillCondSelect(condSel, list, data.cond);
          condSel.disabled = false;
        });
      }
      var addBtn = tr.querySelector('.festival-filter-add');
      var delBtn = tr.querySelector('.festival-filter-del');
      addBtn.addEventListener('click', function() {
        var next = tr.nextSibling;
        var newRow = createRow({});
        if (next) tbody.insertBefore(newRow, next);
        else tbody.appendChild(newRow);
        updateLastRowJoinColumn(tbody);
      });
      delBtn.addEventListener('click', function() {
        tr.remove();
        if (tbody.querySelectorAll('tr').length === 0) tbody.appendChild(createRow({}));
        updateLastRowJoinColumn(tbody);
      });
      return tr;
    }

    function getJoinCellHtml(val) {
      var v = (val === 'or') ? 'or' : 'and';
      return '<div class="kintoneplugin-table-td-control-value"><select class="festival-filter-join"><option value="and"' + (v === 'and' ? ' selected' : '') + '>AND</option><option value="or"' + (v === 'or' ? ' selected' : '') + '>OR</option></select></div>';
    }

    function updateLastRowJoinColumn(tbodyEl) {
      if (!tbodyEl) return;
      var rows = tbodyEl.querySelectorAll('tr');
      for (var i = 0; i < rows.length; i++) {
        var joinCell = rows[i].querySelector('.festival-filter-join-cell');
        if (!joinCell) continue;
        if (i === rows.length - 1) {
          joinCell.innerHTML = '<div class="kintoneplugin-table-td-control-value"><span class="festival-filter-join-last">—</span></div>';
        } else {
          var sel = joinCell.querySelector('select.festival-filter-join');
          var currentVal = sel ? sel.value : 'and';
          joinCell.innerHTML = getJoinCellHtml(currentVal);
        }
      }
    }

    function setTableFromUrl() {
      var query = getQueryFromUrl();
      var tbody = document.getElementById('festival-filter-tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      var rows = parseQueryToRows(query);
      if (rows.length === 0) {
        tbody.appendChild(createRow({}));
      } else {
        rows.forEach(function(r) { tbody.appendChild(createRow(r)); });
      }
      updateLastRowJoinColumn(tbody);
    }

    var wrap = document.createElement('div');
    wrap.className = 'festival-contact-filter';
    var table = document.createElement('table');
    table.className = 'festival-filter-table kintoneplugin-table';
    table.innerHTML =
      '<thead><tr><th class="kintoneplugin-table-th"><span class="title">絞り込み</span></th>' +
      '<th class="kintoneplugin-table-th"><span class="title">条件</span></th>' +
      '<th class="kintoneplugin-table-th"><span class="title">次の行との結合</span></th>' +
      '<th class="kintoneplugin-table-th-blankspace"></th></tr></thead>' +
      '<tbody id="festival-filter-tbody"></tbody>';
    var tbody = table.querySelector('#festival-filter-tbody');
    tbody.appendChild(createRow({}));
    updateLastRowJoinColumn(tbody);

    var actions = document.createElement('div');
    actions.className = 'festival-contact-filter-actions';
    var applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.textContent = '絞り込み';
    applyBtn.className = 'festival-filter-apply kintoneplugin-button-normal';
    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.textContent = '全件';
    allBtn.className = 'festival-filter-all kintoneplugin-button-normal';
    actions.appendChild(applyBtn);
    actions.appendChild(allBtn);
    applyBtn.addEventListener('click', function() {
      applyFilterByUrl(buildQueryFromTable());
    });
    allBtn.addEventListener('click', function() {
      tbody.innerHTML = '';
      tbody.appendChild(createRow({}));
      applyFilterByUrl('');
    });

    wrap.appendChild(table);
    wrap.appendChild(actions);
    header.appendChild(wrap);

    setTableFromUrl();
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  kintone.events.on('app.record.index.show', function() {
    var config = getConfig();
    var isContact = config && config.mode === 'contact';

    if (!isContact) {
      if (!document.querySelector('.festival-sync-toolbar')) addSyncButton();
    } else {
      if (config) addContactListViewFilter(config);
    }
  });

  /**
   * 設定から編集不可にするフィールドコード一覧を取得する。
   * 団体管理アプリ: Config の反映先フィールド（targetFieldCode）
   * 連絡先アプリ: Config の連絡先アプリ側の反映先フィールド（contactAppReadOnlyFields）
   * プラグイン未設定時は空配列を返し、エラーにしない。
   */
  function getReadOnlyFieldCodes(config) {
    if (!config) return [];
    if (config.mode === 'contact') {
      return Array.isArray(config.contactAppReadOnlyFields) ? config.contactAppReadOnlyFields : [];
    }
    if (config.mode === 'parent' && config.childAppSettings && config.childAppSettings.length) {
      var codes = [];
      config.childAppSettings.forEach(function(row) {
        if (row && row.targetFieldCode && String(row.targetFieldCode).trim()) {
          codes.push(String(row.targetFieldCode).trim());
        }
      });
      return codes.filter(function(c, i, a) { return a.indexOf(c) === i; });
    }
    return [];
  }

  /**
   * 1つのフィールドの入力要素を無効化する。wrap がラッパー要素。
   */
  function disableInputsInWrap(wrap) {
    if (!wrap || !wrap.querySelectorAll) return;
    var inputs = wrap.querySelectorAll('input:not([type="hidden"]), select, textarea');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].disabled = true;
      inputs[i].setAttribute('readonly', 'readonly');
    }
  }

  /**
   * 指定フィールドの入力要素を DOM で disabled にする（API が効かない場合のフォールバック）。
   * 編集画面では getFieldElement が使えないことがあるため、data-field-code / id でも検索する。
   */
  function disableFieldsByDom(codes) {
    if (!codes || codes.length === 0) return;
    codes.forEach(function(code) {
      try {
        var wrap = null;
        var rec = typeof kintone !== 'undefined' && kintone.app && kintone.app.record ? kintone.app.record : null;
        var getEl = rec && (rec.getFieldElement || rec.getRecordFieldElement);
        if (typeof getEl === 'function') wrap = getEl.call(rec, code);
        if (!wrap && typeof document !== 'undefined') {
          wrap = document.querySelector('[data-field-code="' + code + '"]') ||
            document.querySelector('[id="' + code + '"]') ||
            document.querySelector('[id*="' + code + '"]');
        }
        if (wrap) disableInputsInWrap(wrap);
      } catch (e) {}
    });
  }

  /**
   * レコード編集系イベントで、プラグインにより自動更新されるフィールドを編集不可（disabled）にする。
   * 1) event.record[コード].disabled + set() + return event（API 仕様）
   * 2) 描画後に DOM で input/select/textarea を disabled（プラグインで API が効かない場合のフォールバック）
   */
  function setReadOnlyFieldsDisabled(ev) {
    if (!ev || !ev.record) return ev;
    var config = getConfig();
    var codes = getReadOnlyFieldCodes(config);
    if (typeof location !== 'undefined' && location.search && location.search.indexOf('festival_debug=1') !== -1) {
      try { console.log('[黒潮祭プラグイン] 編集不可: config=', config ? '取得済' : 'null', ', 対象フィールド=', codes); } catch (e) {}
    }
    if (codes.length === 0) return ev;

    codes.forEach(function(code) {
      if (ev.record[code]) ev.record[code].disabled = true;
    });
    try {
      if (typeof kintone !== 'undefined' && kintone.app && kintone.app.record && typeof kintone.app.record.set === 'function') {
        kintone.app.record.set({ record: ev.record });
      }
    } catch (e) {}

    setTimeout(function() { disableFieldsByDom(codes); }, 300);

    return ev;
  }

  [
    'app.record.create.show',
    'app.record.edit.show',
    'app.record.index.edit.show'
  ].forEach(function(eventName) {
    kintone.events.on(eventName, setReadOnlyFieldsDisabled);
  });
})();
