(function() {
  'use strict';

  var overlayId = 'festival-sync-overlay';

  function showOverlay(progressText) {
    var el = document.getElementById(overlayId);
    if (el) {
      var txt = el.querySelector('.festival-sync-overlay-text');
      if (txt) txt.textContent = progressText || '処理中…';
      return;
    }
    el = document.createElement('div');
    el.id = overlayId;
    el.className = 'festival-sync-overlay';
    el.innerHTML =
      '<div class="festival-sync-overlay-inner">' +
        '<div class="festival-sync-spinner"></div>' +
        '<p class="festival-sync-overlay-text">' + (progressText || '処理中…') + '</p>' +
      '</div>';
    document.body.appendChild(el);
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
        return;
      }
      btn.disabled = true;
      setMessage('', false);
      showOverlay('同期を実行しています…');

      var onProgress = function(processed, contactUpdated) {
        updateOverlayProgress(processed + ' 件処理中…（連絡先 ' + contactUpdated + ' 件更新済）');
      };

      window.FestivalSync.runSync(onProgress)
        .then(function(result) {
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
          setMessage('エラー: ' + (err.message || String(err)), true);
          btn.disabled = false;
        });
    });
  }

  kintone.events.on('app.record.index.show', function() {
    if (document.querySelector('.festival-sync-toolbar')) return;
    addSyncButton();
  });
})();
