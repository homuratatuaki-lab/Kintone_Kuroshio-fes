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

  function showError(msg) {
    var el = document.getElementById('config-error-message');
    if (el) {
      el.textContent = msg;
      el.style.display = msg ? 'block' : 'none';
    }
    if (msg && typeof console !== 'undefined' && console.error) console.error('[プラグイン設定]', msg);
  }

  function clearError() {
    showError('');
  }

  function getApiBasePath() {
    try {
      if (typeof location !== 'undefined' && location.pathname.indexOf('/guest/') !== -1) {
        var m = location.pathname.match(/\/guest\/(\d+)\//);
        if (m) return '/k/guest/' + m[1] + '/v1';
      }
    } catch (e) {}
    return '/k/v1';
  }

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
   * アプリ一覧を取得（REST API）。ゲストスペース時はパスを切り替え。
   */
  function fetchAppList() {
    var base = getApiBasePath();
    return new Promise(function(resolve, reject) {
      try {
        var all = [];
        var offset = 0;
        function next() {
          var url = kintone.api.url(base + '/apps', true) + '?limit=' + APP_LIST_LIMIT + '&offset=' + offset;
          kintone.api(url, 'GET', {}, function(resp) {
            try {
              var list = resp.apps || [];
              list.forEach(function(a) {
                var appId = a.id != null ? a.id : a.appId;
                if (appId == null || String(appId) === 'undefined') return;
                all.push({ id: String(appId), name: a.name || ('アプリ' + appId) });
              });
              if (list.length < APP_LIST_LIMIT) {
                resolve(all);
                return;
              }
              offset += APP_LIST_LIMIT;
              next();
            } catch (e) {
              reject(e);
            }
          }, function(err) {
            reject(err && err.message ? err : new Error('アプリ一覧の取得に失敗しました'));
          });
        }
        next();
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * 指定アプリのフォームフィールド一覧を取得。appId が無効な場合は reject。
   */
  function fetchFormFields(appId) {
    if (appId == null || String(appId).trim() === '' || String(appId) === 'undefined') {
      return Promise.reject(new Error('アプリが選択されていません'));
    }
    var key = String(appId);
    if (cache.fieldCache[key]) return Promise.resolve(cache.fieldCache[key]);
    var base = getApiBasePath();
    return new Promise(function(resolve, reject) {
      try {
        var url = kintone.api.url(base + '/app/form/fields', true) + '?app=' + encodeURIComponent(key);
        kintone.api(url, 'GET', {}, function(resp) {
          try {
            var list = [];
            var props = resp.properties || {};
            Object.keys(props).forEach(function(code) {
              var p = props[code];
              if (p && p.type && code.indexOf('__') !== 0) {
                list.push({ code: code, label: p.label || code });
              }
            });
            list.sort(function(a, b) { return (a.label || '').localeCompare(b.label || ''); });
            cache.fieldCache[key] = list;
            resolve(list);
          } catch (e) {
            reject(e);
          }
        }, function(err) {
          var msg = (err && err.message) ? err.message : 'フィールド一覧の取得に失敗しました';
          reject(new Error(msg));
        });
      } catch (e) {
        reject(e);
      }
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
        '<option value="' + MODE_EXISTENCE + '"' + (rowData.mode === MODE_EXISTENCE ? ' selected' : '') + '>提出されたかチェックする</option>' +
        '<option value="' + MODE_COPY + '"' + (rowData.mode === MODE_COPY ? ' selected' : '') + '>提出内容をコピーする</option>' +
      '</select>';
    tr.appendChild(document.createElement('td')).appendChild(copySelect);
    tr.appendChild(document.createElement('td')).appendChild(targetSelect);
    var removeTd = tr.insertCell(-1);
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove-row';
    removeBtn.textContent = '削除';
    removeTd.appendChild(removeBtn);

    fillSelect(appSelect, appList, rowData.appId, '申請書アプリを選択');
    fillSelect(groupSelect, [], rowData.groupIdFieldCode, '紐付けキー');
    fillSelect(copySelect, [], rowData.copySourceFieldCode, 'コピー元（使用時のみ）');
    fillSelect(targetSelect, parentFields, rowData.targetFieldCode, '表示する欄を選択');

    removeBtn.addEventListener('click', function() { tr.remove(); });

    function setFieldSelectsLoading(loading) {
      groupSelect.disabled = copySelect.disabled = loading;
      if (loading) {
        groupSelect.innerHTML = '<option value="">読み込み中…</option>';
        copySelect.innerHTML = '<option value="">読み込み中…</option>';
      }
    }

    appSelect.addEventListener('change', function() {
      var appId = (appSelect.value || '').trim();
      groupSelect.innerHTML = '<option value="">— 選択 —</option>';
      copySelect.innerHTML = '<option value="">— 選択 —</option>';
      if (!appId || appId === 'undefined') return;
      setFieldSelectsLoading(true);
      fetchFormFields(appId)
        .then(function(fields) {
          fillSelect(groupSelect, fields, null, '紐付けキー');
          fillSelect(copySelect, fields, null, 'コピー元');
        })
        .catch(function(err) {
          showError('参照先アプリのフィールド取得に失敗しました: ' + (err.message || err));
        })
        .then(function() { setFieldSelectsLoading(false); });
    });

    tbody.appendChild(tr);
    if (rowData.appId && String(rowData.appId) !== 'undefined') {
      setFieldSelectsLoading(true);
      fetchFormFields(rowData.appId)
        .then(function(fields) {
          fillSelect(groupSelect, fields, rowData.groupIdFieldCode, '紐付けキー');
          fillSelect(copySelect, fields, rowData.copySourceFieldCode, 'コピー元');
        })
        .catch(function(err) {
          showError('子アプリのフィールド取得に失敗しました: ' + (err.message || err));
        })
        .then(function() { setFieldSelectsLoading(false); });
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
    clearError();
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
          fillSelect(parentGroupSelect, fields, c.parentGroupIdField, '紐付けキーを選択');
          return fields;
        }).catch(function(err) {
          showError('団体一覧アプリのフィールド取得に失敗しました: ' + (err.message || err));
          return [];
        })
      : Promise.resolve([]);

    fetchAppList()
      .then(function(appList) {
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
          if (c.contactAppId && String(c.contactAppId) !== 'undefined') {
            return fetchFormFields(c.contactAppId).then(function(fields) {
              fillSelect(contactGroupSelect, fields, c.contactGroupIdField, '紐付けキー');
              fillSelect(contactTargetSelect, fields, c.contactTargetField, '表示する欄');
            }).catch(function(err) {
              showError('連絡先アプリのフィールド取得に失敗しました: ' + (err.message || err));
            });
          }
        });
      })
      .catch(function(err) {
        showError('アプリ一覧の取得に失敗しました。権限を確認してください。' + (err.message ? '\n' + err.message : ''));
      })
      .then(function() {
        if (loadingEl) loadingEl.style.display = 'none';
      });

    if (contactAppSelect) {
      contactAppSelect.addEventListener('change', function() {
        var appId = (contactAppSelect.value || '').trim();
        contactGroupSelect.innerHTML = '<option value="">読み込み中…</option>';
        contactTargetSelect.innerHTML = '<option value="">読み込み中…</option>';
        contactGroupSelect.disabled = contactTargetSelect.disabled = true;
        if (!appId || appId === 'undefined') {
          contactGroupSelect.innerHTML = '<option value="">— 選択 —</option>';
          contactTargetSelect.innerHTML = '<option value="">— 選択 —</option>';
          contactGroupSelect.disabled = contactTargetSelect.disabled = false;
          updateContactAppNameDisplay('');
          return;
        }
        fetchFormFields(appId)
          .then(function(fields) {
            fillSelect(contactGroupSelect, fields, null, '紐付けキー');
            fillSelect(contactTargetSelect, fields, null, '表示する欄');
          })
          .catch(function(err) {
            showError('連絡先アプリのフィールド取得に失敗しました: ' + (err.message || err));
            contactGroupSelect.innerHTML = '<option value="">— 選択 —</option>';
            contactTargetSelect.innerHTML = '<option value="">— 選択 —</option>';
          })
          .then(function() {
            contactGroupSelect.disabled = contactTargetSelect.disabled = false;
            updateContactAppNameDisplay(appId);
          });
      });
    }
    if (c.contactAppId && String(c.contactAppId) !== 'undefined') updateContactAppNameDisplay(c.contactAppId);
  }

  function updateContactAppNameDisplay(appId) {
    var el = document.getElementById('contact-app-name-display');
    if (!el) return;
    if (!appId || appId === 'undefined') {
      el.textContent = '';
      return;
    }
    var name = '';
    for (var i = 0; i < cache.appList.length; i++) {
      if (String(cache.appList[i].id) === String(appId)) {
        name = cache.appList[i].name || '';
        break;
      }
    }
    el.textContent = name ? '✓ ' + name : '';
  }

  function saveConfig() {
    clearError();
    var parentGroupIdField = document.getElementById('parent-group-id-field').value.trim();
    if (!parentGroupIdField) {
      showError('「2. 共通の紐付けキー」で団体一覧アプリの紐付けキーを選択してください。');
      return;
    }
    var childRows = collectChildRows(document.getElementById('child-app-tbody'));
    for (var i = 0; i < childRows.length; i++) {
      var row = childRows[i];
      if (row.appId && String(row.appId) !== 'undefined') {
        if (!row.groupIdFieldCode || !row.targetFieldCode) {
          showError('1. チェックする申請書の' + (i + 1) + '行目で、申請書アプリを選んだら「紐付けキー」と「表示する欄」を選択してください。');
          return;
        }
      }
    }
    var contactAppId = document.getElementById('contact-app-id').value.trim();
    var contactGroupIdField = document.getElementById('contact-group-id-field').value.trim();
    var contactTargetField = document.getElementById('contact-target-field').value.trim();
    if (contactAppId && String(contactAppId) !== 'undefined') {
      if (!contactGroupIdField || !contactTargetField) {
        showError('3. 連絡先を利用する場合は「紐付けキー」と「表示する欄」を選択してください。');
        return;
      }
    }
    var config = {
      childAppSettings: childRows,
      parentGroupIdField: parentGroupIdField,
      contactAppId: contactAppId,
      contactGroupIdField: contactGroupIdField,
      contactTargetField: contactTargetField
    };
    try {
      var toSave = { config: JSON.stringify(config) };
      kintone.plugin.app.setConfig(toSave, function() {
        clearError();
        alert('設定を保存しました。');
      });
    } catch (e) {
      showError('保存に失敗しました: ' + (e.message || e));
    }
  }

  function init() {
    document.getElementById('add-child-row').addEventListener('click', function() {
      var parentAppId = getParentAppId();
      var parentFields = cache.parentFields.length ? cache.parentFields : [];
      var appList = cache.appList.map(function(a) { return { id: a.id, name: a.name }; });
      addChildRow(document.getElementById('child-app-tbody'), null, appList, parentFields);
    });

    var contactVerifyBtn = document.getElementById('contact-app-verify');
    if (contactVerifyBtn) {
      contactVerifyBtn.addEventListener('click', function() {
        var contactAppSelect = document.getElementById('contact-app-id');
        var appId = (contactAppSelect && contactAppSelect.value) ? contactAppSelect.value.trim() : '';
        updateContactAppNameDisplay(appId && appId !== 'undefined' ? appId : '');
      });
    }

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
