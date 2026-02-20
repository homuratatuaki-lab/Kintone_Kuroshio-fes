(function() {
  'use strict';

  var overlayId = 'festival-sync-overlay';

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

  kintone.events.on('app.record.index.show', function() {
    if (document.querySelector('.festival-sync-toolbar')) return;
    addSyncButton();
  });
})();
