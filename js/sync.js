/**
 * 団体管理アプリ（親）→ 子アプリ集計 → 親更新 → 連絡先アプリ一括更新
 * 全レコードを対象に同期する。
 */
(function() {
  'use strict';

  var LIMIT = 500;
  var LABEL_SUBMITTED = '提出済';
  var LABEL_NOT_SUBMITTED = '未提出';
  var CANCELLED_MSG = 'CANCELLED';

  // アプリ画面では Kintone がプラグイン読み込み直後に $PLUGIN_ID をセットする。
  // 複数プラグイン利用時は後から上書きされるため、読み込み時に一度だけ保持する。
  var CAPTURED_PLUGIN_ID = null;
  try {
    if (typeof kintone !== 'undefined' && typeof kintone.$PLUGIN_ID !== 'undefined') {
      CAPTURED_PLUGIN_ID = kintone.$PLUGIN_ID;
    }
  } catch (e) {}

  function getPluginId() {
    if (CAPTURED_PLUGIN_ID) return CAPTURED_PLUGIN_ID;
    try {
      if (typeof location !== 'undefined' && location.search) {
        var m = location.search.match(/pluginId=([^&]+)/);
        if (m) return m[1];
      }
    } catch (e) {}
    return null;
  }

  /**
   * 設定を取得（アプリ画面では getConfig(pluginId) に pluginId 必須）
   */
  function getConfig() {
    try {
      var pluginId = getPluginId();
      if (!pluginId || typeof kintone.plugin.app.getConfig !== 'function') return null;
      var raw = kintone.plugin.app.getConfig(pluginId);
      if (!raw) return null;
      if (typeof raw === 'string') return JSON.parse(raw);
      if (raw && typeof raw.config === 'string') return JSON.parse(raw.config);
      return raw;
    } catch (e) {
      return null;
    }
  }

  /**
   * 親アプリの全レコードを取得（オフセットループ）。無限ループ防止のため最大100回まで。
   */
  function getAllParentRecords(appId, groupIdFieldCode) {
    return new Promise(function(resolve, reject) {
      try {
        if (typeof console !== 'undefined' && console.log) console.log('[同期] 親レコード取得開始 appId=' + appId);
        var all = [];
        var offset = 0;
        var maxRounds = 100;
        var round = 0;

        function fetch() {
          round++;
          if (round > maxRounds) {
            reject(new Error('親レコード取得のループ上限に達しました'));
            return;
          }
          var params = {
            app: appId,
            query: 'order by $id asc limit ' + LIMIT + ' offset ' + offset,
            totalCount: true
          };
          kintone.api(kintone.api.url('/k/v1/records', true), 'GET', params, function(resp) {
            try {
              var list = resp.records || [];
              all = all.concat(list);
              var total = resp.totalCount != null ? parseInt(resp.totalCount, 10) : list.length;
              if (list.length < LIMIT || (total > 0 && all.length >= total)) {
                if (typeof console !== 'undefined' && console.log) console.log('[同期] 親レコード取得完了 件数=' + all.length);
                resolve(all);
                return;
              }
              offset += LIMIT;
              fetch();
            } catch (e) {
              reject(e);
            }
          }, function(err) {
            reject(err && err.message ? err : new Error('親レコード取得に失敗しました'));
          });
        }
        fetch();
      } catch (e) {
        reject(e);
      }
    });
  }

  /** 子アプリの in クエリで一度に指定する団体IDの最大数（URL長・API制限対策） */
  var CHILD_IN_CLAUSE_CHUNK = 100;

  /**
   * 子アプリで団体IDが一致するレコードを取得（作成日時が新しい順・最新1件）
   * ※ 一括取得キャッシュを使わない場合のフォールバック用
   */
  function getChildRecords(childAppId, groupIdFieldCode, groupIdValue) {
    return new Promise(function(resolve, reject) {
      try {
        var escaped = String(groupIdValue).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        var query = groupIdFieldCode + ' = "' + escaped + '" order by 作成日時 desc limit 1';
        kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
          app: childAppId,
          query: query
        }, function(resp) {
          try {
            var records = (resp && resp.records) ? resp.records : [];
            resolve(records);
          } catch (e) {
            reject(e);
          }
        }, function(err) {
          reject(err && err.message ? err : new Error('子アプリレコード取得に失敗しました'));
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * 子アプリから複数団体分のレコードを一括取得（団体ID in ("ID1","ID2",...)）
   * 戻り値: { "団体ID1": [rec,...], "団体ID2": [...] } 各配列は作成日時 desc で先頭が最新
   */
  function fetchChildRecordsBulk(childAppId, groupIdFieldCode, groupIdValues) {
    var list = [];
    var seen = {};
    for (var i = 0; i < groupIdValues.length; i++) {
      var v = (groupIdValues[i] != null) ? String(groupIdValues[i]).trim() : '';
      if (v !== '' && !seen[v]) { seen[v] = true; list.push(v); }
    }
    if (list.length === 0) return Promise.resolve({});

    function escapeForQuery(val) {
      return String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    var chunks = [];
    for (var c = 0; c < list.length; c += CHILD_IN_CLAUSE_CHUNK) {
      chunks.push(list.slice(c, c + CHILD_IN_CLAUSE_CHUNK));
    }

    var allRecords = [];
    var chunkIndex = 0;

    function fetchNextChunk() {
      if (chunkIndex >= chunks.length) {
        var byGroup = {};
        allRecords.forEach(function(rec) {
          var gv = (rec[groupIdFieldCode] && rec[groupIdFieldCode].value != null) ? String(rec[groupIdFieldCode].value).trim() : '';
          if (gv === '') return;
          if (!byGroup[gv]) byGroup[gv] = [];
          byGroup[gv].push(rec);
        });
        var createdField = '作成日時';
        Object.keys(byGroup).forEach(function(gv) {
          byGroup[gv].sort(function(a, b) {
            var t1 = (a[createdField] && a[createdField].value) ? a[createdField].value : '';
            var t2 = (b[createdField] && b[createdField].value) ? b[createdField].value : '';
            return t2 > t1 ? 1 : t2 < t1 ? -1 : 0;
          });
        });
        return Promise.resolve(byGroup);
      }
      var chunk = chunks[chunkIndex];
      chunkIndex++;
      var inPart = chunk.map(function(id) { return '"' + escapeForQuery(id) + '"'; }).join(',');
      var baseQuery = groupIdFieldCode + ' in (' + inPart + ')';
      var offset = 0;
      function fetchPage() {
        var query = baseQuery + ' limit ' + LIMIT + ' offset ' + offset;
        return new Promise(function(resolvePage, rejectPage) {
          kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
            app: childAppId,
            query: query
          }, function(resp) {
            try {
              var records = (resp && resp.records) ? resp.records : [];
              records.forEach(function(r) { allRecords.push(r); });
              if (records.length < LIMIT) {
                resolvePage(fetchNextChunk());
              } else {
                offset += LIMIT;
                resolvePage(fetchPage());
              }
            } catch (e) {
              rejectPage(e);
            }
          }, function(err) {
            rejectPage(err && err.message ? err : new Error('子アプリ一括取得に失敗しました'));
          });
        });
      }
      return fetchPage();
    }

    return fetchNextChunk();
  }

  function childCacheKey(s) {
    return (s.appId || '') + '\t' + (s.groupIdFieldCode || '');
  }

  /**
   * 1行（1つの子アプリ設定）について、反映値を算出
   * @param {object} record - 親レコード
   * @param {object} childSetting - 子アプリ設定
   * @param {object} [cacheByGroupId] - 団体ID -> レコード配列（作成日時 desc）。省略時は getChildRecords で取得
   * @param {string} [parentGroupIdValue] - 親レコードの団体ID（キャッシュ参照用。未指定時は record から childSetting.groupIdFieldCode で取得＝親アプリでは別名の可能性あり）
   */
  function computeValueForOneRow(record, childSetting, cacheByGroupId, parentGroupIdValue) {
    var groupIdValue = (parentGroupIdValue != null && parentGroupIdValue !== '') ? parentGroupIdValue : (record[childSetting.groupIdFieldCode] ? record[childSetting.groupIdFieldCode].value : '');
    if (groupIdValue === undefined || groupIdValue === null) groupIdValue = '';
    var gvStr = String(groupIdValue).trim();

    var childRecords;
    if (cacheByGroupId && typeof cacheByGroupId === 'object') {
      childRecords = cacheByGroupId[gvStr] || cacheByGroupId[groupIdValue] || [];
      if (typeof console !== 'undefined' && console.log) {
        console.log('[同期] 子アプリ反映 団体ID=' + gvStr + ' 子レコード数=' + childRecords.length + ' 反映先=' + (childSetting.targetFieldCode || ''));
      }
      var value = computeValueFromChildRecords(childRecords, childSetting);
      return Promise.resolve({ targetFieldCode: childSetting.targetFieldCode, value: value });
    }
    return getChildRecords(childSetting.appId, childSetting.groupIdFieldCode, groupIdValue)
      .then(function(recs) { return computeValueFromChildRecords(recs, childSetting); })
      .then(function(value) { return { targetFieldCode: childSetting.targetFieldCode, value: value }; });
  }

  function computeValueFromChildRecords(childRecords, childSetting) {
    var value;
    if (childSetting.mode === 'existence') {
      value = childRecords.length > 0 ? LABEL_SUBMITTED : LABEL_NOT_SUBMITTED;
    } else {
      if (childRecords.length === 0) {
        value = '';
      } else {
        var latest = childRecords[0];
        var field = childSetting.copySourceFieldCode;
        if (field && latest[field]) {
          var v = latest[field].value;
          value = v != null ? String(v) : '';
        } else {
          value = '';
        }
      }
    }
    return value;
  }

  /**
   * 1件の親レコードについて、全子アプリ行の結果を集計（キャッシュ利用時はAPI呼び出しなし）
   * @param {string} parentGroupIdField - 親アプリの団体IDフィールドコード（ここから団体IDを読む）
   * 戻り値: Promise<{ id, groupIdValue, valuesByField }>
   */
  function computeAllValuesForParent(record, childSettings, childRecordsCache, parentGroupIdField) {
    var groupIdValue = (parentGroupIdField && record[parentGroupIdField]) ? record[parentGroupIdField].value : (record[childSettings[0] && childSettings[0].groupIdFieldCode] ? record[childSettings[0].groupIdFieldCode].value : '');
    if (groupIdValue === undefined || groupIdValue === null) groupIdValue = '';
    var gvStr = String(groupIdValue).trim();

    var valid = childSettings.filter(function(s) { return s.targetFieldCode; });
    if (childRecordsCache && typeof childRecordsCache === 'object') {
      var valuesByField = {};
      var promisesForCache = valid.map(function(childSetting) {
        var cacheByGroupId = childRecordsCache[childCacheKey(childSetting)];
        return computeValueForOneRow(record, childSetting, cacheByGroupId, gvStr || groupIdValue);
      });
      return Promise.all(promisesForCache).then(function(results) {
        var valuesByFieldSync = {};
        results.forEach(function(r) {
          if (r && r.targetFieldCode) valuesByFieldSync[r.targetFieldCode] = r.value;
        });
        return {
          id: record.$id.value,
          groupIdValue: groupIdValue,
          valuesByField: valuesByFieldSync
        };
      });
    }

    var promises = valid.map(function(childSetting) {
      return computeValueForOneRow(record, childSetting, null, gvStr || groupIdValue);
    });
    return Promise.all(promises).then(function(results) {
      var valuesByField = {};
      results.forEach(function(r) {
        if (r.targetFieldCode) valuesByField[r.targetFieldCode] = r.value;
      });
      return {
        id: record.$id.value,
        groupIdValue: groupIdValue,
        valuesByField: valuesByField
      };
    });
  }

  /**
   * 連絡先アプリで団体IDが一致するレコードID一覧を全件取得（500件ずつ、最大100回で打ち切り）
   * 団体IDが空の場合は検索せず空配列を返す（空文字検索はAPIで400になるため）
   */
  function getContactRecordIds(contactAppId, contactGroupIdField, groupIdValue) {
    var trimmed = (groupIdValue != null) ? String(groupIdValue).trim() : '';
    if (trimmed === '') {
      return Promise.resolve([]);
    }
    return new Promise(function(resolve, reject) {
      try {
        var escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        var q = contactGroupIdField + ' = "' + escaped + '"';
        var allIds = [];
        var offset = 0;
        var maxRounds = 100;
        var round = 0;

        function fetch() {
          round++;
          if (round > maxRounds) {
            reject(new Error('連絡先レコード取得のループ上限に達しました'));
            return;
          }
          kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
            app: contactAppId,
            query: q + ' limit ' + LIMIT + ' offset ' + offset
          }, function(resp) {
            try {
              var records = resp.records || [];
              records.forEach(function(r) { allIds.push(r.$id.value); });
              if (records.length < LIMIT) {
                resolve(allIds);
                return;
              }
              offset += LIMIT;
              fetch();
            } catch (e) {
              reject(e);
            }
          }, function(err) {
            reject(err && err.message ? err : new Error('連絡先レコード取得に失敗しました'));
          });
        }
        fetch();
      } catch (e) {
        reject(e);
      }
    });
  }

  var PUT_RECORDS_LIMIT = 100;

  /**
   * 連絡先アプリのレコードを一括更新（PUT・100件ずつ、1レコードあたり複数フィールド）
   * @param {object} valuesByField - { フィールドコード: 値, ... }
   */
  function updateContactRecords(contactAppId, recordIds, valuesByField, getIsCancelled) {
    if (recordIds.length === 0 || !valuesByField || Object.keys(valuesByField).length === 0) return Promise.resolve();
    function toRecords(ids, byField) {
      return ids.map(function(id) {
        var rec = {};
        Object.keys(byField).forEach(function(fc) {
          rec[fc] = { value: byField[fc] };
        });
        return { id: id, record: rec };
      });
    }
    var chain = Promise.resolve();
    for (var i = 0; i < recordIds.length; i += PUT_RECORDS_LIMIT) {
      if (getIsCancelled && getIsCancelled()) return Promise.reject(new Error(CANCELLED_MSG));
      var recs = toRecords(recordIds.slice(i, i + PUT_RECORDS_LIMIT), valuesByField);
      (function(records) {
        chain = chain.then(function() {
          if (getIsCancelled && getIsCancelled()) return Promise.reject(new Error(CANCELLED_MSG));
          return new Promise(function(resolve, reject) {
            try {
              kintone.api(kintone.api.url('/k/v1/records', true), 'PUT', {
                app: contactAppId,
                records: records
              }, resolve, function(err) {
                reject(err && err.message ? err : new Error('連絡先レコード更新に失敗しました'));
              });
            } catch (e) {
              reject(e);
            }
          });
        });
      })(recs);
    }
    return chain;
  }

  /**
   * 親アプリの1レコードを更新（複数フィールドを一括）
   * @param {object} valuesByField - { フィールドコード: 値, ... }
   */
  function updateParentRecord(appId, recordId, valuesByField) {
    if (Object.keys(valuesByField).length === 0) return Promise.resolve();
    try {
      var record = {};
      Object.keys(valuesByField).forEach(function(fieldCode) {
        record[fieldCode] = { value: valuesByField[fieldCode] };
      });
      return new Promise(function(resolve, reject) {
        kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
          app: appId,
          id: recordId,
          record: record
        }, resolve, function(err) {
          reject(err && err.message ? err : new Error('親レコード更新に失敗しました'));
        });
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  /**
   * 一括同期のメイン処理
   * @param {function(string, number, number, number)} onProgress - (処理内容, 処理済み件数, 全体件数, 連絡先更新累計) のコールバック
   * @param {function(): boolean} getIsCancelled - 中止フラグ取得（省略可）
   */
  function runSync(onProgress, getIsCancelled) {
    var config = getConfig();
    if (!config) {
      return Promise.reject(new Error('プラグイン設定が取得できません。設定画面で保存してください。'));
    }

    var childSettings = config.childAppSettings || [];
    if (childSettings.length === 0) {
      return Promise.reject(new Error('子アプリ設定が1件以上必要です。'));
    }

    var parentGroupIdField = config.parentGroupIdField;
    var contactAppId = config.contactAppId;
    var contactGroupIdField = config.contactGroupIdField;

    if (!parentGroupIdField) {
      return Promise.reject(new Error('親アプリの「団体ID」フィールドを設定してください。'));
    }

    var validChildSettings = childSettings.filter(function(s) { return s.targetFieldCode; });
    if (validChildSettings.length === 0) {
      return Promise.reject(new Error('子アプリ設定のいずれかに「親アプリ 反映先フィールドコード」を入力してください。'));
    }

    var appId = kintone.app.getId();

    /**
     * 作業開始前に親アプリ・連絡先アプリ・子アプリへの参照権限をチェックする
     */
    function checkPermissions() {
      var checks = [];
      checks.push(
        new Promise(function(resolve, reject) {
          kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
            app: appId,
            query: 'limit 1'
          }, function() { resolve(); }, function(err) {
            reject(new Error('親アプリ（団体管理）の参照権限がありません。' + (err && err.message ? err.message : '')));
          });
        })
      );
      if (contactAppId && String(contactAppId) !== 'undefined') {
        checks.push(
          new Promise(function(resolve, reject) {
            kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
              app: contactAppId,
              query: 'limit 1'
            }, function() { resolve(); }, function(err) {
              reject(new Error('連絡先アプリの参照権限がありません。' + (err && err.message ? err.message : '')));
            });
          })
        );
      }
      validChildSettings.forEach(function(s) {
        if (s.appId && String(s.appId) !== 'undefined') {
          checks.push(
            new Promise(function(resolve, reject) {
              kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
                app: s.appId,
                query: 'limit 1'
              }, function() { resolve(); }, function(err) {
                reject(new Error('子アプリ（参照先アプリ）の参照権限がありません。アプリID: ' + s.appId + ' ' + (err && err.message ? err.message : '')));
              });
            })
          );
        }
      });
      return Promise.all(checks);
    }

    var chain = Promise.resolve();
    var updated = 0;
    var contactUpdated = 0;
    var totalRecords = 0;

    function reportProgress(phase, current, total, contactCnt) {
      if (typeof onProgress === 'function') onProgress(phase, current, total, contactCnt != null ? contactCnt : contactUpdated);
    }

    function checkCancelled() {
      if (getIsCancelled && getIsCancelled()) return Promise.reject(new Error(CANCELLED_MSG));
      return Promise.resolve();
    }

    reportProgress('権限確認中', 0, 0, 0);

    return checkPermissions()
      .then(function() {
        reportProgress('親レコード取得中', 0, 0, 0);
        return getAllParentRecords(appId, parentGroupIdField);
      })
      .then(function(records) {
        if (records.length === 0) {
          return { updated: 0, contactUpdated: 0 };
        }
        totalRecords = records.length;
        var uniqueGroupIds = [];
        var seenGid = {};
        records.forEach(function(r) {
          var gv = (r[parentGroupIdField] && r[parentGroupIdField].value != null) ? String(r[parentGroupIdField].value).trim() : '';
          if (gv !== '' && !seenGid[gv]) { seenGid[gv] = true; uniqueGroupIds.push(gv); }
        });
        reportProgress('子アプリ一括取得中', 0, totalRecords, 0);
        var childRecordsCache = {};
        var fetchPromises = validChildSettings.map(function(s) {
          return fetchChildRecordsBulk(s.appId, s.groupIdFieldCode, uniqueGroupIds).then(function(byGroupId) {
            childRecordsCache[childCacheKey(s)] = byGroupId;
          });
        });
        return Promise.all(fetchPromises).then(function() {
          if (typeof console !== 'undefined' && console.log) {
            console.log('[同期] 子アプリ一括取得完了 団体数=' + uniqueGroupIds.length + ' 子アプリ数=' + validChildSettings.length);
            validChildSettings.forEach(function(s) {
              var cache = childRecordsCache[childCacheKey(s)];
              var keys = cache ? Object.keys(cache) : [];
              var totalRec = 0;
              keys.forEach(function(k) { totalRec += (cache[k] && cache[k].length) || 0; });
              console.log('[同期] 子アプリ appId=' + s.appId + ' 団体ID種類数=' + keys.length + ' 子レコード総数=' + totalRec + ' 団体ID例=' + (keys.slice(0, 3).join(', ') || '(なし)'));
            });
          }
          reportProgress('団体処理中', 0, totalRecords, 0);
          records.forEach(function(record) {
            chain = chain.then(function() {
              return checkCancelled().then(function() { return computeAllValuesForParent(record, childSettings, childRecordsCache, parentGroupIdField); });
            }).then(function(result) {
            return checkCancelled().then(function() {
              return updateParentRecord(appId, result.id, result.valuesByField);
            }).then(function() {
              updated++;
              if (contactAppId && contactGroupIdField) {
                var gid = (result.groupIdValue != null) ? String(result.groupIdValue).trim() : '';
                if (gid === '') {
                  if (typeof console !== 'undefined' && console.log) console.log('[同期] 団体IDが空のため連絡先更新をスキップ レコードID=' + result.id);
                  reportProgress('団体処理中', updated, totalRecords, contactUpdated);
                  return;
                }
                var contactValuesByField = {};
                validChildSettings.forEach(function(s) {
                  var contactField = (s.contactTargetField != null && String(s.contactTargetField).trim() !== '') ? s.contactTargetField : null;
                  if (!contactField) return;
                  var val = result.valuesByField[s.targetFieldCode];
                  contactValuesByField[contactField] = (val !== undefined && val !== null) ? val : '';
                });
                if (Object.keys(contactValuesByField).length === 0 && config.contactTargetField) {
                  var firstVal = validChildSettings[0] && result.valuesByField[validChildSettings[0].targetFieldCode] !== undefined
                    ? result.valuesByField[validChildSettings[0].targetFieldCode] : '';
                  contactValuesByField[config.contactTargetField] = firstVal;
                }
                if (Object.keys(contactValuesByField).length === 0) {
                  reportProgress('団体処理中', updated, totalRecords, contactUpdated);
                  return;
                }
                if (typeof console !== 'undefined' && console.log) console.log('[同期] 連絡先更新開始 団体ID=' + gid);
                return getContactRecordIds(contactAppId, contactGroupIdField, result.groupIdValue)
                  .then(function(ids) {
                    if (ids.length === 0) {
                      reportProgress('団体処理中', updated, totalRecords, contactUpdated);
                      return;
                    }
                    return updateContactRecords(contactAppId, ids, contactValuesByField, getIsCancelled)
                      .then(function() {
                        contactUpdated += ids.length;
                        reportProgress('団体処理中', updated, totalRecords, contactUpdated);
                      });
                  });
              } else {
                reportProgress('団体処理中', updated, totalRecords, contactUpdated);
              }
            });
          });
          });
          return chain.then(function() {
            return { updated: updated, contactUpdated: contactUpdated };
          });
        });
      });
  }

  window.FestivalSync = {
    runSync: runSync,
    getConfig: getConfig
  };
})();
