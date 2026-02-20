(function() {
  'use strict';

  var MODE_EXISTENCE = 'existence';
  var MODE_COPY = 'copy';
  var APP_LIST_LIMIT = 100;

  var cache = {
    appList: [],
    parentFields: [],
    fieldCache: {}
  };

  function getDefaultConfig() {
    return {
      childAppSettings: [],
      parentGroupIdField: '',
      contactAppId: '',
      contactGroupIdField: '',
      contactTargetField: ''
    };
  }

  /**
   * アプリ一覧を取得（REST API）
   */
  function fetchAppList() {
    return new Promise(function(resolve, reject) {
      var all = [];
      var offset = 0;
      function next() {
        var url = kintone.api.url('/k/v1/apps', true) + '?limit=' + APP_LIST_LIMIT + '&offset=' + offset;
        kintone.api(url, 'GET', {}, function(resp) {
          var list = resp.apps || [];
          list.forEach(function(a) {
            all.push({ id: String(a.id), name: a.name || ('アプリ' + a.id) });
          });
          if (list.length < APP_LIST_LIMIT) {
            resolve(all);
            return;
          }
          offset += APP_LIST_LIMIT;
          next();
        }, reject);
      }
      next();
    });
  }

  /**
   * 指定アプリのフォームフィールド一覧を取得
   */
  function fetchFormFields(appId) {
    if (cache.fieldCache[appId]) return Promise.resolve(cache.fieldCache[appId]);
    return new Promise(function(resolve, reject) {
      var url = kintone.api.url('/k/v1/app/form/fields', true) + '?app=' + encodeURIComponent(appId);
      kintone.api(url, 'GET', {}, function(resp) {
        var list = [];
        var props = resp.properties || {};
        Object.keys(props).forEach(function(code) {
          var p = props[code];
          if (p && p.type && code.indexOf('__') !== 0) {
            list.push({ code: code, label: p.label || code });
          }
        });
        list.sort(function(a, b) { return (a.label || '').localeCompare(b.label || ''); });
        cache.fieldCache[appId] = list;
        resolve(list);
      }, reject);
    });
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function fillSelect(selectEl, options, selectedValue, emptyLabel) {
    if (!selectEl) return;
    emptyLabel = emptyLabel || '— 選択 —';
    selectEl.innerHTML = '<option value="">' + escapeHtml(emptyLabel) + '</option>';
    options.forEach(function(opt) {
      var val = (opt.value != null ? opt.value : opt.code || opt.id);
      var label;
      if (opt.label != null && opt.code != null) label = opt.label + ' (' + opt.code + ')';
      else if (opt.name != null && opt.id != null) label = opt.name + ' (ID: ' + opt.id + ')';
      else label = opt.label || opt.name || String(val);
      var op = document.createElement('option');
      op.value = String(val);
      op.textContent = label;
      if (selectedValue != null && String(val) === String(selectedValue)) op.selected = true;
      selectEl.appendChild(op);
    });
  }

  function getParentAppId() {
    try {
      return kintone.app.getId();
    } catch (e) {
      return null;
    }
  }

  /**
   * 子アプリ行を1行追加（select は後から API で埋める）
   */
  function addChildRow(tbody, rowData, appList, parentFields) {
    rowData = rowData || {
      appId: '',
      groupIdFieldCode: '',
      mode: MODE_EXISTENCE,
      copySourceFieldCode: '',
      targetFieldCode: ''
    };
    var tr = document.createElement('tr');
    var appSelect = document.createElement('select');
    appSelect.className = 'child-app-id';
    var groupSelect = document.createElement('select');
    groupSelect.className = 'child-group-id-field';
    var copySelect = document.createElement('select');
    copySelect.className = 'child-copy-source';
    var targetSelect = document.createElement('select');
    targetSelect.className = 'child-target-field';

    tr.appendChild(document.createElement('td')).appendChild(appSelect);
    tr.appendChild(document.createElement('td')).appendChild(groupSelect);
    var modeTd = tr.insertCell(-1);
    modeTd.className = 'mode-cell';
    modeTd.innerHTML =
      '<select class="child-mode">' +
        '<option value="' + MODE_EXISTENCE + '"' + (rowData.mode === MODE_EXISTENCE ? ' selected' : '') + '>存在確認</option>' +
        '<option value="' + MODE_COPY + '"' + (rowData.mode === MODE_COPY ? ' selected' : '') + '>値のコピー</option>' +
      '</select>';
    tr.appendChild(document.createElement('td')).appendChild(copySelect);
    tr.appendChild(document.createElement('td')).appendChild(targetSelect);
    var removeTd = tr.insertCell(-1);
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove-row';
    removeBtn.textContent = '削除';
    removeTd.appendChild(removeBtn);

    fillSelect(appSelect, appList, rowData.appId, 'アプリを選択');
    fillSelect(groupSelect, [], rowData.groupIdFieldCode);
    fillSelect(copySelect, [], rowData.copySourceFieldCode, '値のコピー時のみ');
    fillSelect(targetSelect, parentFields, rowData.targetFieldCode, '親の反映先を選択');

    removeBtn.addEventListener('click', function() { tr.remove(); });

    appSelect.addEventListener('change', function() {
      var appId = appSelect.value;
      groupSelect.innerHTML = '<option value="">— 選択 —</option>';
      copySelect.innerHTML = '<option value="">— 選択 —</option>';
      if (!appId) return;
      fetchFormFields(appId).then(function(fields) {
        fillSelect(groupSelect, fields, null, '団体IDフィールド');
        fillSelect(copySelect, fields, null, 'コピー元（値のコピー時）');
      });
    });

    tbody.appendChild(tr);
    if (rowData.appId) {
      fetchFormFields(rowData.appId).then(function(fields) {
        fillSelect(groupSelect, fields, rowData.groupIdFieldCode, '団体IDフィールド');
        fillSelect(copySelect, fields, rowData.copySourceFieldCode, 'コピー元（値のコピー時）');
      });
    }
  }

  function collectChildRows(tbody) {
    var rows = [];
    var trs = tbody.querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      var tr = trs[i];
      rows.push({
        appId: (tr.querySelector('.child-app-id') && tr.querySelector('.child-app-id').value) || '',
        groupIdFieldCode: (tr.querySelector('.child-group-id-field') && tr.querySelector('.child-group-id-field').value) || '',
        mode: (tr.querySelector('.child-mode') && tr.querySelector('.child-mode').value) || MODE_EXISTENCE,
        copySourceFieldCode: (tr.querySelector('.child-copy-source') && tr.querySelector('.child-copy-source').value) || '',
        targetFieldCode: (tr.querySelector('.child-target-field') && tr.querySelector('.child-target-field').value) || ''
      });
    }
    return rows;
  }

  function getPluginId() {
    if (typeof kintone !== 'undefined' && typeof kintone.$PLUGIN_ID !== 'undefined') return kintone.$PLUGIN_ID;
    if (typeof location !== 'undefined' && location.search) {
      var m = location.search.match(/pluginId=([^&]+)/);
      if (m) return m[1];
    }
    return null;
  }

  function loadConfig() {
    var loadingEl = document.getElementById('config-loading');
    if (loadingEl) loadingEl.style.display = 'block';

    var pluginId = getPluginId();
    var raw = (pluginId && kintone.plugin.app.getConfig) ? kintone.plugin.app.getConfig(pluginId) : null;
    var config = (raw && raw.config) ? (function() { try { return JSON.parse(raw.config); } catch (e) { return null; } })() : null;
    var c = config || getDefaultConfig();
    if (!c.childAppSettings || !Array.isArray(c.childAppSettings)) {
      c.childAppSettings = [];
    }
    if (c.parentTargetField && c.childAppSettings.length > 0 && !c.childAppSettings[0].targetFieldCode) {
      c.childAppSettings[0].targetFieldCode = c.parentTargetField;
    }

    var parentAppId = getParentAppId();
    var tbody = document.getElementById('child-app-tbody');
    var parentGroupSelect = document.getElementById('parent-group-id-field');
    var contactAppSelect = document.getElementById('contact-app-id');
    var contactGroupSelect = document.getElementById('contact-group-id-field');
    var contactTargetSelect = document.getElementById('contact-target-field');

    if (parentGroupSelect) parentGroupSelect.innerHTML = '<option value="">— 選択 —</option>';
    if (contactAppSelect) contactAppSelect.innerHTML = '<option value="">— 選択 —</option>';
    if (contactGroupSelect) contactGroupSelect.innerHTML = '<option value="">— 選択 —</option>';
    if (contactTargetSelect) contactTargetSelect.innerHTML = '<option value="">— 選択 —</option>';
    if (tbody) tbody.innerHTML = '';

    var loadParentFields = parentAppId
      ? fetchFormFields(parentAppId).then(function(fields) {
          cache.parentFields = fields;
          fillSelect(parentGroupSelect, fields, c.parentGroupIdField, '団体IDフィールドを選択');
          return fields;
        }).catch(function(err) {
          alert('親アプリのフィールド取得に失敗しました: ' + (err.message || err));
          return [];
        })
      : Promise.resolve([]);

    fetchAppList().then(function(appList) {
      cache.appList = appList;
      fillSelect(contactAppSelect, appList.map(function(a) { return { id: a.id, name: a.name }; }), c.contactAppId, '連絡先アプリを選択');

      return loadParentFields.then(function(parentFields) {
        var appOpts = appList.map(function(a) { return { id: a.id, name: a.name }; });
        if (c.childAppSettings.length === 0) {
          addChildRow(tbody, null, appOpts, parentFields);
        } else {
          c.childAppSettings.forEach(function(row) {
            addChildRow(tbody, row, appOpts, parentFields);
          });
        }
        if (c.contactAppId) {
          return fetchFormFields(c.contactAppId).then(function(fields) {
            fillSelect(contactGroupSelect, fields, c.contactGroupIdField, '団体IDフィールド');
            fillSelect(contactTargetSelect, fields, c.contactTargetField, '反映先フィールド');
          });
        }
      });
    }).catch(function(err) {
      alert('アプリ一覧の取得に失敗しました。権限を確認してください。\n' + (err.message || err));
    }).then(function() {
      if (loadingEl) loadingEl.style.display = 'none';
    });

    if (contactAppSelect) {
      contactAppSelect.addEventListener('change', function() {
        var appId = contactAppSelect.value;
        contactGroupSelect.innerHTML = '<option value="">— 選択 —</option>';
        contactTargetSelect.innerHTML = '<option value="">— 選択 —</option>';
        if (!appId) return;
        fetchFormFields(appId).then(function(fields) {
          fillSelect(contactGroupSelect, fields, null, '団体IDフィールド');
          fillSelect(contactTargetSelect, fields, null, '反映先フィールド');
        }).catch(function(err) {
          alert('フィールドの取得に失敗しました: ' + (err.message || err));
        });
      });
    }
  }

  function saveConfig() {
    var childRows = collectChildRows(document.getElementById('child-app-tbody'));
    var config = {
      childAppSettings: childRows,
      parentGroupIdField: document.getElementById('parent-group-id-field').value.trim(),
      contactAppId: document.getElementById('contact-app-id').value.trim(),
      contactGroupIdField: document.getElementById('contact-group-id-field').value.trim(),
      contactTargetField: document.getElementById('contact-target-field').value.trim()
    };

    var toSave = { config: JSON.stringify(config) };
    kintone.plugin.app.setConfig(toSave, function() {
      alert('設定を保存しました。');
    });
  }

  function init() {
    document.getElementById('add-child-row').addEventListener('click', function() {
      var parentAppId = getParentAppId();
      var parentFields = cache.parentFields.length ? cache.parentFields : [];
      var appList = cache.appList.map(function(a) { return { id: a.id, name: a.name }; });
      addChildRow(document.getElementById('child-app-tbody'), null, appList, parentFields);
    });

    document.getElementById('btn-save').addEventListener('click', saveConfig);
    document.getElementById('btn-cancel').addEventListener('click', function() { history.back(); });

    loadConfig();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
