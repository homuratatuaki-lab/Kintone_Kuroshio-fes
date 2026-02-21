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
      contactAppListViewFilter: false
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

  function fillSelect(selectEl, options, selectedValue, emptyLabel, allowEmpty) {
    if (!selectEl) return;
    emptyLabel = emptyLabel || '— 選択 —';
    var emptyOption = '<option value="">' + escapeHtml(emptyLabel) + '</option>';
    if (allowEmpty !== true) {
      emptyOption = '<option value="" disabled>' + escapeHtml(emptyLabel) + '</option>';
    }
    selectEl.innerHTML = emptyOption;
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
    var isCopyMode = rowData.mode === MODE_COPY;
    var modeSelect = document.createElement('select');
    modeSelect.className = 'child-mode';
    modeSelect.innerHTML =
      '<option value="' + MODE_EXISTENCE + '"' + (!isCopyMode ? ' selected' : '') + '>提出チェック</option>' +
      '<option value="' + MODE_COPY + '"' + (isCopyMode ? ' selected' : '') + '>内容取得</option>';
    modeTd.appendChild(modeSelect);
    var copyTd = tr.insertCell(-1);
    copyTd.className = 'copy-source-cell' + (isCopyMode ? '' : ' grayed-out');
    copyTd.appendChild(copySelect);
    copySelect.disabled = !isCopyMode;
    tr.appendChild(document.createElement('td')).appendChild(targetSelect);
    tr.appendChild(document.createElement('td')).appendChild(contactTargetSelect);
    var removeTd = tr.insertCell(-1);
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove-row';
    removeBtn.textContent = '削除';
    removeTd.appendChild(removeBtn);

    fillSelect(appSelect, appList, rowData.appId, '申請書アプリを選択', false);
    fillSelect(groupSelect, [], rowData.groupIdFieldCode, '紐付けキー', false);
    fillSelect(copySelect, [], rowData.copySourceFieldCode, '取得する欄を選択', false);
    fillSelect(targetSelect, parentFields, rowData.targetFieldCode, '表示する欄を選択', false);
    fillSelect(contactTargetSelect, contactFields, rowData.contactTargetField, '—', true);

    removeBtn.addEventListener('click', function() { tr.remove(); });

    modeSelect.addEventListener('change', function() {
      var mode = modeSelect.value;
      var isCopy = (mode === MODE_COPY);
      copySelect.disabled = !isCopy;
      if (isCopy) copyTd.classList.remove('grayed-out'); else copyTd.classList.add('grayed-out');
    });

    function setFieldSelectsLoading(loading) {
      groupSelect.disabled = copySelect.disabled = loading;
      if (loading) {
        groupSelect.innerHTML = '<option value="">読み込み中…</option>';
        copySelect.innerHTML = '<option value="">読み込み中…</option>';
      }
    }

    appSelect.addEventListener('change', function() {
      var appId = (appSelect.value || '').trim();
      groupSelect.innerHTML = '<option value="" disabled>— 選択 —</option>';
      copySelect.innerHTML = '<option value="" disabled>— 選択 —</option>';
      if (!appId || appId === 'undefined') return;
      setFieldSelectsLoading(true);
      fetchFormFields(appId)
        .then(function(fields) {
          fillSelect(groupSelect, fields, null, '紐付けキー');
          fillSelect(copySelect, fields, null, '取得する欄を選択');
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
          fillSelect(copySelect, fields, rowData.copySourceFieldCode, '取得する欄を選択');
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
      fillSelect(sel, contactFields, current || null, '—', true);
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

  function switchModeUI(mode) {
    var parentBlock = document.getElementById('parent-mode-config');
    var contactBlock = document.getElementById('contact-mode-config');
    var isContact = (mode === 'contact');
    if (parentBlock) parentBlock.style.display = isContact ? 'none' : '';
    if (contactBlock) contactBlock.style.display = isContact ? '' : 'none';
  }

  function fillContactReadOnlyFields(fields, selectedCodes) {
    var container = document.getElementById('contact-readonly-fields');
    if (!container) return;
    container.innerHTML = '';
    selectedCodes = selectedCodes || [];
    (fields || []).forEach(function(f) {
      var label = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'contact-readonly-field-cb';
      cb.dataset.fieldCode = f.code;
      cb.checked = selectedCodes.indexOf(f.code) !== -1;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + (f.label || f.code)));
      container.appendChild(label);
    });
  }

  function loadConfig() {
    clearError();
    var loadingEl = document.getElementById('config-loading');
    if (loadingEl) loadingEl.style.display = 'block';

    var pluginId = getPluginId();
    var raw = (pluginId && kintone.plugin.app.getConfig) ? kintone.plugin.app.getConfig(pluginId) : null;
    var config = (raw && raw.config) ? (function() { try { return JSON.parse(raw.config); } catch (e) { return null; } })() : null;
    var c = config || getDefaultConfig();
    var mode = (c.mode === 'contact') ? 'contact' : 'parent';
    if (!c.contactAppReadOnlyFields || !Array.isArray(c.contactAppReadOnlyFields)) c.contactAppReadOnlyFields = [];
    if (!c.childAppSettings || !Array.isArray(c.childAppSettings)) {
      c.childAppSettings = [];
    }
    if (c.parentTargetField && c.childAppSettings.length > 0 && !c.childAppSettings[0].targetFieldCode) {
      c.childAppSettings[0].targetFieldCode = c.parentTargetField;
    }

    var parentAppId = getParentAppId();
    var modeParent = document.getElementById('config-mode-parent');
    var modeContact = document.getElementById('config-mode-contact');
    if (modeParent) modeParent.checked = (mode === 'parent');
    if (modeContact) modeContact.checked = (mode === 'contact');
    switchModeUI(mode);

    if (mode === 'contact') {
      var listFilterCb = document.getElementById('contact-listview-filter');
      if (listFilterCb) listFilterCb.checked = !!c.contactAppListViewFilter;
      var contactAppIdForFields = parentAppId || (typeof kintone !== 'undefined' && kintone.app && kintone.app.getId ? kintone.app.getId() : null);
      fetchFormFields(contactAppIdForFields).then(function(fields) {
        fillContactReadOnlyFields(fields, c.contactAppReadOnlyFields);
      }).catch(function() {
        fillContactReadOnlyFields([], c.contactAppReadOnlyFields);
      }).then(function() {
        if (loadingEl) loadingEl.style.display = 'none';
      });
    }

    if (mode !== 'parent') {
      if (loadingEl) loadingEl.style.display = 'none';
      return;
    }

    var tbody = document.getElementById('child-app-tbody');
    var parentGroupSelect = document.getElementById('parent-group-id-field');
    var contactAppSelect = document.getElementById('contact-app-id');
    var contactGroupSelect = document.getElementById('contact-group-id-field');
    var contactTargetSelect = document.getElementById('contact-target-field');

    if (parentGroupSelect) parentGroupSelect.innerHTML = '<option value="">— 選択 —</option>';
    if (contactAppSelect) contactAppSelect.innerHTML = '<option value="">— 選択 —</option>';
    if (contactGroupSelect) contactGroupSelect.innerHTML = '<option value="">— 選択 —</option>';
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

    fetchAppList()
      .then(function(appList) {
        cache.appList = appList;
        fillSelect(contactAppSelect, appList.map(function(a) { return { id: a.id, name: a.name }; }), c.contactAppId, '連絡先を選択');

        return loadParentFields.then(function(parentFields) {
          return loadContactFields.then(function(contactFields) {
            var cf = contactFields || cache.contactFields || [];
            var appOpts = appList.map(function(a) { return { id: a.id, name: a.name }; });
            if (c.childAppSettings.length === 0) {
              addChildRow(tbody, null, appOpts, parentFields, cf);
            } else {
              c.childAppSettings.forEach(function(row) {
                addChildRow(tbody, row, appOpts, parentFields, cf);
              });
            }
          });
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
  }

  function clearFieldErrors() {
    document.querySelectorAll('.config-input-error').forEach(function(el) {
      el.classList.remove('config-input-error');
    });
  }

  function saveConfig() {
    clearError();
    clearFieldErrors();
    var modeParent = document.getElementById('config-mode-parent');
    var modeContact = document.getElementById('config-mode-contact');
    var isContactMode = modeContact && modeContact.checked;

    if (isContactMode) {
      var readOnlyCodes = [];
      var checkboxes = document.querySelectorAll('.contact-readonly-field-cb:checked');
      for (var i = 0; i < checkboxes.length; i++) {
        var code = checkboxes[i].dataset.fieldCode;
        if (code) readOnlyCodes.push(code);
      }
      var listFilterCb = document.getElementById('contact-listview-filter');
      var config = {
        mode: 'contact',
        contactAppReadOnlyFields: readOnlyCodes,
        contactAppListViewFilter: !!(listFilterCb && listFilterCb.checked)
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

    var parentGroupEl = document.getElementById('parent-group-id-field');
    var parentGroupIdField = parentGroupEl ? parentGroupEl.value.trim() : '';
    if (!parentGroupIdField) {
      showError('「団体一覧の紐付け」で紐付けキーを選択してください。');
      if (parentGroupEl) parentGroupEl.classList.add('config-input-error');
      return;
    }
    var contactAppEl = document.getElementById('contact-app-id');
    var contactGroupEl = document.getElementById('contact-group-id-field');
    var contactAppId = contactAppEl ? contactAppEl.value.trim() : '';
    var contactGroupIdField = contactGroupEl ? contactGroupEl.value.trim() : '';
    if (!contactAppId || String(contactAppId) === 'undefined') {
      showError('「連絡先の設定」で連絡先アプリを選択してください。');
      if (contactAppEl) contactAppEl.classList.add('config-input-error');
      if (contactGroupEl) contactGroupEl.classList.add('config-input-error');
      return;
    }
    if (!contactGroupIdField) {
      showError('「連絡先の設定」で紐付けキーを選択してください。');
      if (contactGroupEl) contactGroupEl.classList.add('config-input-error');
      return;
    }
    var tbody = document.getElementById('child-app-tbody');
    var childRows = collectChildRows(tbody);
    for (var i = 0; i < childRows.length; i++) {
      var row = childRows[i];
      if (row.appId && String(row.appId) !== 'undefined') {
        if (!row.groupIdFieldCode || !row.targetFieldCode) {
          showError('「申請書の指定」の' + (i + 1) + '行目で、紐付けキーと表示する欄を選択してください。');
          var tr = tbody && tbody.rows[i];
          if (tr) {
            var appSel = tr.querySelector('.child-app-id');
            var groupSel = tr.querySelector('.child-group-id-field');
            var targetSel = tr.querySelector('.child-target-field');
            if (appSel) appSel.classList.add('config-input-error');
            if (groupSel) groupSel.classList.add('config-input-error');
            if (targetSel) targetSel.classList.add('config-input-error');
          }
          return;
        }
      }
    }
    var config = {
      mode: 'parent',
      childAppSettings: childRows,
      parentGroupIdField: parentGroupIdField,
      contactAppId: contactAppId,
      contactGroupIdField: contactGroupIdField,
      contactTargetField: ''
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
    var modeParent = document.getElementById('config-mode-parent');
    var modeContact = document.getElementById('config-mode-contact');
    if (modeParent) {
      modeParent.addEventListener('change', function() {
        switchModeUI('parent');
      });
    }
    if (modeContact) {
      modeContact.addEventListener('change', function() {
        switchModeUI('contact');
        var container = document.getElementById('contact-readonly-fields');
        if (container && container.children.length === 0) {
          var appId = (typeof kintone !== 'undefined' && kintone.app && kintone.app.getId) ? kintone.app.getId() : null;
          if (appId) {
            fetchFormFields(appId).then(function(fields) {
              fillContactReadOnlyFields(fields, []);
            }).catch(function() {});
          }
        }
      });
    }

    var addRowBtn = document.getElementById('add-child-row');
    if (addRowBtn) {
      addRowBtn.addEventListener('click', function() {
        var parentFields = cache.parentFields.length ? cache.parentFields : [];
        var appList = cache.appList.map(function(a) { return { id: a.id, name: a.name }; });
        var contactFields = cache.contactFields || [];
        addChildRow(document.getElementById('child-app-tbody'), null, appList, parentFields, contactFields);
      });
    }

    document.getElementById('btn-save').addEventListener('click', saveConfig);
    document.getElementById('btn-cancel').addEventListener('click', function() { history.back(); });

    function removeErrorOnChange(el) {
      if (el && el.addEventListener) {
        el.addEventListener('change', function() {
          this.classList.remove('config-input-error');
        });
      }
    }
    removeErrorOnChange(document.getElementById('parent-group-id-field'));
    removeErrorOnChange(document.getElementById('contact-app-id'));
    removeErrorOnChange(document.getElementById('contact-group-id-field'));
    var childTbody = document.getElementById('child-app-tbody');
    if (childTbody) {
      childTbody.addEventListener('change', function(e) {
        if (e.target && e.target.classList && e.target.classList.contains('config-input-error')) {
          e.target.classList.remove('config-input-error');
        }
      });
    }

    loadConfig();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
