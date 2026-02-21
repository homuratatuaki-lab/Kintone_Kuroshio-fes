(function() {
  'use strict';

  var MODE_EXISTENCE = 'existence';
  var MODE_COPY = 'copy';
  var APP_LIST_LIMIT = 100;

  var cache = {
    appList: [],
    parentFields: [],
    contactFields: [],
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
      mode: 'parent',
      childAppSettings: [],
      parentGroupIdField: '',
      contactAppId: '',
      contactGroupIdField: '',
      contactTargetField: '',
      contactAppReadOnlyFields: [],
      contactAppListViewFilter: false,
      contactListViewDefault: 'all'
    };
  }

  function clearFieldErrors() {
    document.querySelectorAll('.config-input-error').forEach(function(el) { el.classList.remove('config-input-error'); });
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

  function fillSelect(selectEl, options, selectedValue, emptyLabel, allowEmpty) {
    if (!selectEl) return;
    if (allowEmpty === undefined) allowEmpty = true;
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
    if (!allowEmpty && selectEl.options[0]) selectEl.options[0].disabled = true;
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
  function addChildRow(tbody, rowData, appList, parentFields, contactFields) {
    rowData = rowData || {
      appId: '',
      groupIdFieldCode: '',
      mode: MODE_EXISTENCE,
      copySourceFieldCode: '',
      targetFieldCode: '',
      contactTargetField: ''
    };
    contactFields = contactFields || cache.contactFields || [];
    var tr = document.createElement('tr');
    var appSelect = document.createElement('select');
    appSelect.className = 'child-app-id';
    var groupSelect = document.createElement('select');
    groupSelect.className = 'child-group-id-field';
    var copySelect = document.createElement('select');
    copySelect.className = 'child-copy-source';
    var targetSelect = document.createElement('select');
    targetSelect.className = 'child-target-field';
    var contactTargetSelect = document.createElement('select');
    contactTargetSelect.className = 'child-contact-target-field';

    tr.appendChild(document.createElement('td')).appendChild(appSelect);
    tr.appendChild(document.createElement('td')).appendChild(groupSelect);
    var modeTd = tr.insertCell(-1);
    modeTd.className = 'mode-cell';
    modeTd.innerHTML =
      '<select class="child-mode">' +
        '<option value="' + MODE_EXISTENCE + '"' + (rowData.mode === MODE_EXISTENCE ? ' selected' : '') + '>提出チェック</option>' +
        '<option value="' + MODE_COPY + '"' + (rowData.mode === MODE_COPY ? ' selected' : '') + '>内容取得</option>' +
      '</select>';
    var copyTd = document.createElement('td');
    copyTd.className = 'copy-source-cell' + (rowData.mode === MODE_EXISTENCE ? ' grayed-out' : '');
    if (rowData.mode === MODE_EXISTENCE) copySelect.disabled = true;
    copyTd.appendChild(copySelect);
    tr.appendChild(copyTd);
    tr.appendChild(document.createElement('td')).appendChild(targetSelect);
    tr.appendChild(document.createElement('td')).appendChild(contactTargetSelect);
    var removeTd = tr.insertCell(-1);
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove-row';
    removeBtn.setAttribute('title', '行を削除');
    removeBtn.setAttribute('aria-label', '行を削除');
    removeBtn.textContent = '−';
    removeTd.appendChild(removeBtn);

    fillSelect(appSelect, appList, rowData.appId, '申請書アプリを選択', false);
    fillSelect(groupSelect, [], rowData.groupIdFieldCode, '紐付けキー', false);
    fillSelect(copySelect, [], rowData.copySourceFieldCode, '取得する欄', false);
    fillSelect(targetSelect, parentFields, rowData.targetFieldCode, '表示する欄を選択', false);
    fillSelect(contactTargetSelect, contactFields, rowData.contactTargetField, '—');

    function updateCopyCellGrayed() {
      var modeSel = tr.querySelector('.child-mode');
      var isExistence = modeSel && modeSel.value === MODE_EXISTENCE;
      copyTd.classList.toggle('grayed-out', isExistence);
      copySelect.disabled = isExistence;
    }
    modeTd.querySelector('.child-mode').addEventListener('change', updateCopyCellGrayed);

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
          fillSelect(groupSelect, fields, null, '紐付けキー', false);
          fillSelect(copySelect, fields, null, '取得する欄', false);
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
          fillSelect(groupSelect, fields, rowData.groupIdFieldCode, '紐付けキー', false);
          fillSelect(copySelect, fields, rowData.copySourceFieldCode, '取得する欄', false);
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
      var contactEl = tr.querySelector('.child-contact-target-field');
      rows.push({
        appId: (tr.querySelector('.child-app-id') && tr.querySelector('.child-app-id').value) || '',
        groupIdFieldCode: (tr.querySelector('.child-group-id-field') && tr.querySelector('.child-group-id-field').value) || '',
        mode: (tr.querySelector('.child-mode') && tr.querySelector('.child-mode').value) || MODE_EXISTENCE,
        copySourceFieldCode: (tr.querySelector('.child-copy-source') && tr.querySelector('.child-copy-source').value) || '',
        targetFieldCode: (tr.querySelector('.child-target-field') && tr.querySelector('.child-target-field').value) || '',
        contactTargetField: (contactEl && contactEl.value) ? contactEl.value.trim() : ''
      });
    }
    return rows;
  }

  function fillAllContactTargetSelects(contactFields) {
    cache.contactFields = contactFields || [];
    var tbody = document.getElementById('child-app-tbody');
    if (!tbody) return;
    var selects = tbody.querySelectorAll('.child-contact-target-field');
    for (var i = 0; i < selects.length; i++) {
      var sel = selects[i];
      var current = (sel.value || '').trim();
      fillSelect(sel, contactFields, current || null, '—');
    }
  }

  function getPluginId() {
    if (typeof kintone !== 'undefined' && typeof kintone.$PLUGIN_ID !== 'undefined') return kintone.$PLUGIN_ID;
    if (typeof location !== 'undefined' && location.search) {
      var m = location.search.match(/pluginId=([^&]+)/);
      if (m) return m[1];
    }
    return null;
  }

  function switchModeUI() {
    var isContact = document.getElementById('config-mode-contact') && document.getElementById('config-mode-contact').checked;
    var parentBlock = document.getElementById('parent-mode-config');
    var contactBlock = document.getElementById('contact-mode-config');
    if (parentBlock) parentBlock.style.display = isContact ? 'none' : 'block';
    if (contactBlock) contactBlock.style.display = isContact ? 'block' : 'none';
  }

  function fillContactReadOnlyFields(fields, selectedCodes) {
    selectedCodes = selectedCodes || [];
    var container = document.getElementById('contact-readonly-fields');
    if (!container) return;
    container.innerHTML = '';
    (fields || []).forEach(function(f) {
      var code = f.code || f.value;
      var label = f.label || f.name || code;
      var labelEl = document.createElement('label');
      labelEl.className = 'checkbox-label';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.fieldCode = code;
      if (selectedCodes.indexOf(code) !== -1) cb.checked = true;
      labelEl.appendChild(cb);
      labelEl.appendChild(document.createTextNode(label + (f.code ? ' (' + f.code + ')' : '')));
      container.appendChild(labelEl);
    });
  }

  function addContactViewRow(tbody, fields, rowData) {
    rowData = rowData || { name: '', fieldCode: '' };
    var tr = document.createElement('tr');
    var nameCell = document.createElement('td');
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'field-input';
    nameInput.placeholder = '例: 〇〇申請書';
    nameInput.value = rowData.name || '';
    nameCell.appendChild(nameInput);
    tr.appendChild(nameCell);
    var fieldCell = document.createElement('td');
    var fieldSelect = document.createElement('select');
    fieldSelect.className = 'field-input contact-view-field-select';
    fillSelect(fieldSelect, fields || [], rowData.fieldCode || null, '— 選択 —');
    fieldCell.appendChild(fieldSelect);
    tr.appendChild(fieldCell);
    var delCell = document.createElement('td');
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-ghost btn-del';
    delBtn.textContent = '−';
    delBtn.setAttribute('aria-label', '削除');
    delBtn.addEventListener('click', function() {
      if (tr.parentNode) tr.parentNode.removeChild(tr);
    });
    delCell.appendChild(delBtn);
    tr.appendChild(delCell);
    tbody.appendChild(tr);
  }

  function fillContactViewSettingsTable(fields, viewSettings) {
    var tbody = document.getElementById('contact-view-settings-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    (viewSettings || []).forEach(function(row) {
      addContactViewRow(tbody, fields, { name: row.name || '', fieldCode: row.fieldCode || '' });
    });
  }

  function collectContactViewSettings(tbody) {
    var rows = [];
    if (!tbody) return rows;
    var trs = tbody.querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      var tr = trs[i];
      var nameInput = tr.querySelector('input[type="text"]');
      var fieldSelect = tr.querySelector('.contact-view-field-select');
      var name = (nameInput && nameInput.value) ? String(nameInput.value).trim() : '';
      var fieldCode = (fieldSelect && fieldSelect.value) ? String(fieldSelect.value).trim() : '';
      if (name || fieldCode) rows.push({ name: name, fieldCode: fieldCode });
    }
    return rows;
  }

  var contactAppSelectListenerAttached = false;

  function attachContactAppSelectListener() {
    var contactAppSelect = document.getElementById('contact-app-id');
    var contactGroupSelect = document.getElementById('contact-group-id-field');
    if (!contactAppSelect || contactAppSelectListenerAttached) return;
    contactAppSelectListenerAttached = true;
    contactAppSelect.addEventListener('change', function() {
      var appId = (contactAppSelect.value || '').trim();
      contactGroupSelect.innerHTML = '<option value="">読み込み中…</option>';
      contactGroupSelect.disabled = true;
      if (!appId || appId === 'undefined') {
        contactGroupSelect.innerHTML = '<option value="">— 選択 —</option>';
        contactGroupSelect.disabled = false;
        fillAllContactTargetSelects([]);
        return;
      }
      fetchFormFields(appId)
        .then(function(fields) {
          fillSelect(contactGroupSelect, fields, null, '紐付けキー');
          fillAllContactTargetSelects(fields);
        })
        .catch(function(err) {
          showError('連絡先アプリのフィールド取得に失敗しました: ' + (err.message || err));
          contactGroupSelect.innerHTML = '<option value="">— 選択 —</option>';
          fillAllContactTargetSelects([]);
        })
        .then(function() {
          contactGroupSelect.disabled = false;
        });
    });
  }

  /**
   * 団体一覧モード用のドロップダウン（アプリ一覧・紐付けキー等）を取得して表示する。
   * 初回 loadConfig で parent のときと、「このアプリの役割」を連絡先→団体一覧に切り替えたときに使用。
   * @returns {Promise} 処理完了の Promise（loading 非表示に利用）
   */
  function loadParentModeData(c) {
    c = c || getDefaultConfig();
    var parentAppId = getParentAppId();
    var tbody = document.getElementById('child-app-tbody');
    var parentGroupSelect = document.getElementById('parent-group-id-field');
    var contactAppSelect = document.getElementById('contact-app-id');
    var contactGroupSelect = document.getElementById('contact-group-id-field');
    if (!tbody || !contactAppSelect) return Promise.resolve();

    if (parentGroupSelect) parentGroupSelect.innerHTML = '<option value="">— 選択 —</option>';
    contactAppSelect.innerHTML = '<option value="">— 選択 —</option>';
    if (contactGroupSelect) contactGroupSelect.innerHTML = '<option value="">— 選択 —</option>';
    var hadRows = tbody.querySelectorAll('tr').length > 0;
    if (!hadRows) tbody.innerHTML = '';

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

    var loadContactFields = (c.contactAppId && String(c.contactAppId) !== 'undefined')
      ? fetchFormFields(c.contactAppId).then(function(fields) {
          cache.contactFields = fields;
          fillSelect(contactGroupSelect, fields, c.contactGroupIdField, '紐付けキー');
          fillAllContactTargetSelects(fields);
          return fields;
        }).catch(function(err) {
          showError('連絡先アプリのフィールド取得に失敗しました: ' + (err.message || err));
          cache.contactFields = [];
          return [];
        })
      : Promise.resolve([]);

    return fetchAppList()
      .then(function(appList) {
        cache.appList = appList;
        fillSelect(contactAppSelect, appList.map(function(a) { return { id: a.id, name: a.name }; }), c.contactAppId, '連絡先アプリを選択');
        attachContactAppSelectListener();
        return loadParentFields.then(function(parentFields) {
          return loadContactFields.then(function(contactFields) {
            var cf = contactFields || cache.contactFields || [];
            var appOpts = appList.map(function(a) { return { id: a.id, name: a.name }; });
            if (!hadRows) {
              if (!c.childAppSettings || !c.childAppSettings.length) {
                addChildRow(tbody, null, appOpts, parentFields, cf);
              } else {
                c.childAppSettings.forEach(function(row) {
                  addChildRow(tbody, row, appOpts, parentFields, cf);
                });
              }
            } else {
              fillAllContactTargetSelects(cache.contactFields || []);
            }
          });
        });
      })
      .catch(function(err) {
        showError('アプリ一覧の取得に失敗しました。権限を確認してください。' + (err.message ? '\n' + err.message : ''));
      });
  }

  function loadConfig() {
    clearError();
    clearFieldErrors();
    var loadingEl = document.getElementById('config-loading');
    if (loadingEl) loadingEl.style.display = 'block';

    var pluginId = getPluginId();
    var raw = (pluginId && kintone.plugin.app.getConfig) ? kintone.plugin.app.getConfig(pluginId) : null;
    var config = (raw && raw.config) ? (function() { try { return JSON.parse(raw.config); } catch (e) { return null; } })() : null;
    var c = config || getDefaultConfig();
    var mode = c.mode === 'contact' ? 'contact' : 'parent';
    if (!c.childAppSettings || !Array.isArray(c.childAppSettings)) c.childAppSettings = [];
    if (c.parentTargetField && c.childAppSettings.length > 0 && !c.childAppSettings[0].targetFieldCode) {
      c.childAppSettings[0].targetFieldCode = c.parentTargetField;
    }

    var parentRadio = document.getElementById('config-mode-parent');
    var contactRadio = document.getElementById('config-mode-contact');
    if (parentRadio) parentRadio.checked = (mode === 'parent');
    if (contactRadio) contactRadio.checked = (mode === 'contact');
    switchModeUI();

    var parentAppId = getParentAppId();
    var tbody = document.getElementById('child-app-tbody');
    var parentGroupSelect = document.getElementById('parent-group-id-field');
    var contactAppSelect = document.getElementById('contact-app-id');
    var contactGroupSelect = document.getElementById('contact-group-id-field');
    var contactListViewFilter = document.getElementById('contact-listview-filter');
    var contactListViewDefaultEl = document.getElementById('contact-listview-default');
    var contactListViewDefaultContactEl = document.getElementById('contact-listview-default-contact');

    if (contactListViewFilter) contactListViewFilter.checked = !!c.contactAppListViewFilter;
    var defaultView = (c.contactListViewDefault === 'submitted' || c.contactListViewDefault === 'not_submitted') ? c.contactListViewDefault : 'all';
    if (contactListViewDefaultEl) contactListViewDefaultEl.value = defaultView;
    if (contactListViewDefaultContactEl) contactListViewDefaultContactEl.value = defaultView;

    if (mode === 'contact') {
      fetchFormFields(parentAppId)
        .then(function(fields) {
          cache.contactFormFields = fields;
          fillContactReadOnlyFields(fields, c.contactAppReadOnlyFields || []);
          fillContactViewSettingsTable(fields, c.contactViewSettings || []);
        })
        .catch(function(err) {
          showError('このアプリのフィールド取得に失敗しました: ' + (err.message || err));
          cache.contactFormFields = [];
          fillContactReadOnlyFields([], []);
          fillContactViewSettingsTable([], []);
        })
        .then(function() {
          if (loadingEl) loadingEl.style.display = 'none';
        });
      return;
    }

    if (tbody) tbody.innerHTML = '';
    loadParentModeData(c)
      .then(function() { if (loadingEl) loadingEl.style.display = 'none'; })
      .catch(function() { if (loadingEl) loadingEl.style.display = 'none'; });
  }

  function saveConfig() {
    clearError();
    clearFieldErrors();

    var isContact = document.getElementById('config-mode-contact') && document.getElementById('config-mode-contact').checked;

    if (isContact) {
      var readonlyCodes = [];
      document.querySelectorAll('#contact-readonly-fields input[type="checkbox"]:checked').forEach(function(cb) {
        var code = cb.dataset && cb.dataset.fieldCode;
        if (code) readonlyCodes.push(code);
      });
      var listViewFilter = !!(document.getElementById('contact-listview-filter') && document.getElementById('contact-listview-filter').checked);
      var defaultEl = document.getElementById('contact-listview-default-contact');
      var listViewDefault = (defaultEl && (defaultEl.value === 'submitted' || defaultEl.value === 'not_submitted')) ? defaultEl.value : 'all';
      var viewSettingsTbody = document.getElementById('contact-view-settings-tbody');
      var contactViewSettings = viewSettingsTbody ? collectContactViewSettings(viewSettingsTbody) : [];
      var config = {
        mode: 'contact',
        contactAppReadOnlyFields: readonlyCodes,
        contactAppListViewFilter: listViewFilter,
        contactListViewDefault: listViewDefault,
        contactViewSettings: contactViewSettings
      };
      try {
        kintone.plugin.app.setConfig({ config: JSON.stringify(config) }, function() {
          clearError();
          alert('設定を保存しました。');
        });
      } catch (e) {
        showError('保存に失敗しました: ' + (e.message || e));
      }
      return;
    }

    var parentGroupSelect = document.getElementById('parent-group-id-field');
    var parentGroupIdField = (parentGroupSelect && parentGroupSelect.value) ? parentGroupSelect.value.trim() : '';
    var ok = true;
    if (!parentGroupIdField) {
      if (parentGroupSelect) parentGroupSelect.classList.add('config-input-error');
      showError('1. 団体管理の紐付けで「紐付けキー」を選択してください。');
      ok = false;
    }
    var tbody = document.getElementById('child-app-tbody');
    var childRows = tbody ? collectChildRows(tbody) : [];
    for (var i = 0; i < childRows.length; i++) {
      var row = childRows[i];
      if (row.appId && String(row.appId) !== 'undefined') {
        if (!row.groupIdFieldCode || !row.targetFieldCode) {
          showError('3. 申請書の指定で、申請書を選んだ行は「紐付けキー」と「→ 団体管理に表示」を選択してください。');
          ok = false;
          break;
        }
      }
    }
    var contactAppSelect = document.getElementById('contact-app-id');
    var contactGroupSelect = document.getElementById('contact-group-id-field');
    var contactAppId = (contactAppSelect && contactAppSelect.value) ? contactAppSelect.value.trim() : '';
    var contactGroupIdField = (contactGroupSelect && contactGroupSelect.value) ? contactGroupSelect.value.trim() : '';
    if (contactAppId && String(contactAppId) !== 'undefined') {
      if (!contactGroupIdField) {
        if (contactGroupSelect) contactGroupSelect.classList.add('config-input-error');
        showError('2. 連絡先の設定で「紐付けキー」を選択してください。');
        ok = false;
      }
    }
    if (!ok) return;

    var defaultEl = document.getElementById('contact-listview-default');
    var listViewDefault = (defaultEl && (defaultEl.value === 'submitted' || defaultEl.value === 'not_submitted')) ? defaultEl.value : 'all';
    var config = {
      mode: 'parent',
      childAppSettings: childRows,
      parentGroupIdField: parentGroupIdField,
      contactAppId: contactAppId,
      contactGroupIdField: contactGroupIdField,
      contactTargetField: '',
      contactAppReadOnlyFields: [],
      contactAppListViewFilter: false,
      contactListViewDefault: listViewDefault
    };
    try {
      kintone.plugin.app.setConfig({ config: JSON.stringify(config) }, function() {
        clearError();
        alert('設定を保存しました。');
      });
    } catch (e) {
      showError('保存に失敗しました: ' + (e.message || e));
    }
  }

  function init() {
    var addRowBtn = document.getElementById('add-child-row');
    if (addRowBtn) {
      addRowBtn.addEventListener('click', function() {
        var parentFields = cache.parentFields.length ? cache.parentFields : [];
        var appList = cache.appList.map(function(a) { return { id: a.id, name: a.name }; });
        var contactFields = cache.contactFields || [];
        addChildRow(document.getElementById('child-app-tbody'), null, appList, parentFields, contactFields);
      });
    }
    var addContactViewBtn = document.getElementById('add-contact-view-row');
    if (addContactViewBtn) {
      addContactViewBtn.addEventListener('click', function() {
        var tbody = document.getElementById('contact-view-settings-tbody');
        if (tbody) addContactViewRow(tbody, cache.contactFormFields || [], null);
      });
    }

    var parentRadio = document.getElementById('config-mode-parent');
    var contactRadio = document.getElementById('config-mode-contact');
    function onModeChange() {
      switchModeUI();
      if (document.getElementById('config-mode-contact') && document.getElementById('config-mode-contact').checked) {
        var container = document.getElementById('contact-readonly-fields');
        if (container && container.children.length === 0) {
          fetchFormFields(getParentAppId()).then(function(fields) {
            fillContactReadOnlyFields(fields, []);
          }).catch(function() {});
        }
      } else {
        /* 団体一覧に切り替えたときは、ドロップダウンを取得して表示する（連絡先で開いた場合は未取得のため） */
        var pluginId = getPluginId();
        var raw = (pluginId && kintone.plugin.app.getConfig) ? kintone.plugin.app.getConfig(pluginId) : null;
        var c = (raw && raw.config) ? (function() { try { return JSON.parse(raw.config); } catch (e) { return null; } })() : null;
        if (!c || !c.childAppSettings) c = getDefaultConfig();
        loadParentModeData(c);
      }
    }
    if (parentRadio) parentRadio.addEventListener('change', onModeChange);
    if (contactRadio) contactRadio.addEventListener('change', onModeChange);

    var configContainer = document.getElementById('config-container');
    if (configContainer) configContainer.addEventListener('change', clearFieldErrors);

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
