/**
 * 団体管理アプリ（親）→ 子アプリ集計 → 親更新 → 連絡先アプリ一括更新
 * 全レコードを対象に同期する。
 */
(function() {
  'use strict';

  var LIMIT = 500;
  var LABEL_SUBMITTED = '提出済';
  var LABEL_NOT_SUBMITTED = '未提出';

  /**
   * 設定を取得
   */
  function getConfig() {
    var raw = kintone.plugin.app.retrieveConfig();
    if (!raw) return null;
    try {
      if (typeof raw === 'string') return JSON.parse(raw);
      if (raw && typeof raw.config === 'string') return JSON.parse(raw.config);
      return raw;
    } catch (e) {
      return null;
    }
  }

  /**
   * 親アプリの全レコードを取得（オフセットループ）
   */
  function getAllParentRecords(appId, groupIdFieldCode) {
    return new Promise(function(resolve, reject) {
      var all = [];
      var offset = 0;

      function fetch() {
        var params = {
          app: appId,
          query: 'orderBy("$id", "asc") limit(' + LIMIT + ') offset(' + offset + ')',
          totalCount: true
        };
        kintone.api(kintone.api.url('/k/v1/records', true), 'GET', params, function(resp) {
          var list = resp.records || [];
          all = all.concat(list);
          var total = resp.totalCount ? parseInt(resp.totalCount, 10) : list.length;
          if (list.length < LIMIT || all.length >= total) {
            resolve(all);
            return;
          }
          offset += LIMIT;
          fetch();
        }, reject);
      }
      fetch();
    });
  }

  /**
   * 子アプリで団体IDが一致するレコードを取得（作成日時が新しい順・最新1件）
   */
  function getChildRecords(childAppId, groupIdFieldCode, groupIdValue) {
    return new Promise(function(resolve, reject) {
      var escaped = String(groupIdValue).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      var query = groupIdFieldCode + ' = "' + escaped + '" orderBy("作成日時", "desc") limit(1)';
      kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
        app: childAppId,
        query: query
      }, function(resp) {
        var records = resp.records || [];
        resolve(records);
      }, reject);
    });
  }

  /**
   * 1行（1つの子アプリ設定）について、反映値を算出
   */
  function computeValueForOneRow(record, childSetting) {
    var groupIdValue = record[childSetting.groupIdFieldCode] ? record[childSetting.groupIdFieldCode].value : '';
    if (groupIdValue === undefined || groupIdValue === null) groupIdValue = '';

    return getChildRecords(
      childSetting.appId,
      childSetting.groupIdFieldCode,
      groupIdValue
    ).then(function(childRecords) {
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
      return { targetFieldCode: childSetting.targetFieldCode, value: value };
    });
  }

  /**
   * 1件の親レコードについて、全子アプリ行の結果を集計し、反映先フィールドごとの値のオブジェクトを返す
   * 戻り値: { id, groupIdValue, valuesByField: { フィールドコード: 値, ... } }
   */
  function computeAllValuesForParent(record, childSettings) {
    var groupIdValue = record[childSettings[0].groupIdFieldCode] ? record[childSettings[0].groupIdFieldCode].value : '';
    if (groupIdValue === undefined || groupIdValue === null) groupIdValue = '';

    var promises = childSettings
      .filter(function(s) { return s.targetFieldCode; })
      .map(function(childSetting) {
        return computeValueForOneRow(record, childSetting);
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
   * 連絡先アプリで団体IDが一致するレコードID一覧を全件取得（500件ずつループ）
   */
  function getContactRecordIds(contactAppId, contactGroupIdField, groupIdValue) {
    return new Promise(function(resolve, reject) {
      var escaped = String(groupIdValue).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      var q = contactGroupIdField + ' = "' + escaped + '"';
      var allIds = [];
      var offset = 0;

      function fetch() {
        kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
          app: contactAppId,
          query: q + ' limit(' + LIMIT + ') offset(' + offset + ')'
        }, function(resp) {
          var records = resp.records || [];
          records.forEach(function(r) { allIds.push(r.$id.value); });
          if (records.length < LIMIT) {
            resolve(allIds);
            return;
          }
          offset += LIMIT;
          fetch();
        }, reject);
      }
      fetch();
    });
  }

  var PUT_RECORDS_LIMIT = 100;

  /**
   * 連絡先アプリのレコードを一括更新（PUT・100件ずつに分割）
   */
  function updateContactRecords(contactAppId, contactTargetField, recordIds, value) {
    if (recordIds.length === 0) return Promise.resolve();
    function toRecords(ids, fieldCode, val) {
      return ids.map(function(id) {
        var rec = {};
        rec[fieldCode] = { value: val };
        return { id: id, record: rec };
      });
    }
    var chain = Promise.resolve();
    for (var i = 0; i < recordIds.length; i += PUT_RECORDS_LIMIT) {
      var recs = toRecords(recordIds.slice(i, i + PUT_RECORDS_LIMIT), contactTargetField, value);
      (function(records) {
        chain = chain.then(function() {
          return new Promise(function(resolve, reject) {
            kintone.api(kintone.api.url('/k/v1/records', true), 'PUT', {
              app: contactAppId,
              records: records
            }, resolve, reject);
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
    var record = {};
    Object.keys(valuesByField).forEach(function(fieldCode) {
      record[fieldCode] = { value: valuesByField[fieldCode] };
    });
    return new Promise(function(resolve, reject) {
      kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
        app: appId,
        id: recordId,
        record: record
      }, resolve, reject);
    });
  }

  /**
   * 一括同期のメイン処理
   * @param {function(number, number)} onProgress - (処理済み件数, 連絡先更新累計) のコールバック
   */
  function runSync(onProgress) {
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
    var contactTargetField = config.contactTargetField;

    if (!parentGroupIdField) {
      return Promise.reject(new Error('親アプリの「団体ID」フィールドを設定してください。'));
    }

    var validChildSettings = childSettings.filter(function(s) { return s.targetFieldCode; });
    if (validChildSettings.length === 0) {
      return Promise.reject(new Error('子アプリ設定のいずれかに「親アプリ 反映先フィールドコード」を入力してください。'));
    }

    var appId = kintone.app.getId();
    var chain = Promise.resolve();
    var updated = 0;
    var contactUpdated = 0;

    function reportProgress() {
      if (typeof onProgress === 'function') onProgress(updated, contactUpdated);
    }

    return getAllParentRecords(appId, parentGroupIdField)
      .then(function(records) {
        if (records.length === 0) {
          return { updated: 0, contactUpdated: 0 };
        }
        records.forEach(function(record) {
          chain = chain.then(function() {
            return computeAllValuesForParent(record, childSettings);
          }).then(function(result) {
            return updateParentRecord(appId, result.id, result.valuesByField)
              .then(function() {
                updated++;
                if (contactAppId && contactGroupIdField && contactTargetField) {
                  var contactValue = validChildSettings[0] && result.valuesByField[validChildSettings[0].targetFieldCode] !== undefined
                    ? result.valuesByField[validChildSettings[0].targetFieldCode]
                    : '';
                  return getContactRecordIds(contactAppId, contactGroupIdField, result.groupIdValue)
                    .then(function(ids) {
                      if (ids.length === 0) return;
                      return updateContactRecords(contactAppId, contactTargetField, ids, contactValue)
                        .then(function() { contactUpdated += ids.length; reportProgress(); });
                    });
                } else {
                  reportProgress();
                }
              });
          });
        });
        return chain.then(function() {
          return { updated: updated, contactUpdated: contactUpdated };
        });
      });
  }

  window.FestivalSync = {
    runSync: runSync,
    getConfig: getConfig
  };
})();
