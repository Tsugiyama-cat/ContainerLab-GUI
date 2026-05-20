'use strict';

// 全モジュールロード後に走る初期化、グローバル UI ハンドラ
// (コンテキストメニュー / キーボード / ボトムパネルリサイズ)。

// ── ボトムパネル リサイズ ──────────────────────────────────────────────────
(function () {
  const panel  = $('bottom-panel');
  const handle = $('bottom-resize-handle');
  let dragging = false, startY = 0, startH = 0;

  handle.addEventListener('mousedown', e => {
    dragging = true;
    startY   = e.clientY;
    startH   = panel.offsetHeight;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dy  = startY - e.clientY;
    const newH = Math.max(80, Math.min(window.innerHeight * 0.7, startH + dy));
    panel.style.height = newH + 'px';
    if (_broadcastMode) {
      for (const s of _broadcastPopupSessions) s.fitAddon.fit();
    } else if (_activeTab !== 'log' && _cliSessions[_activeTab]) {
      _cliSessions[_activeTab].fitAddon.fit();
    }
  });
  document.addEventListener('mouseup', () => { dragging = false; });
})();

// ── コンテキストメニュー ──────────────────────────────────────────────────
network.on('oncontext', params => {
  params.event.preventDefault();
  const nodeId = network.getNodeAt(params.pointer.DOM);
  const edgeId = !nodeId ? network.getEdgeAt(params.pointer.DOM) : null;
  if (!nodeId && !edgeId) { hideContextMenu(); return; }

  state.contextTargetId = nodeId || edgeId;
  $('ctx-cli').className  = (state.deployed && nodeId) ? '' : 'disabled';
  $('ctx-edit').className = nodeId ? '' : 'disabled';
  $('ctx-cli').style.display  = nodeId ? '' : 'none';
  $('ctx-edit').style.display = nodeId ? '' : 'none';
  $('ctx-delete').className = 'danger';
  showContextMenu(params.event.clientX, params.event.clientY);
});

function showContextMenu(x, y) {
  elCtxMenu.style.left = x + 'px';
  elCtxMenu.style.top  = y + 'px';
  elCtxMenu.classList.add('visible');
}
function hideContextMenu() { elCtxMenu.classList.remove('visible'); }
document.addEventListener('click', hideContextMenu);

$('ctx-cli').addEventListener('click', () => {
  if ($('ctx-cli').classList.contains('disabled')) return;
  const nd = _nodeData.get(state.contextTargetId);
  if (nd) openCLITab(nd.name, nd.ssh_port);
});
$('ctx-edit').addEventListener('click', () => {
  if ($('ctx-edit').classList.contains('disabled')) return;
  showEditModal(state.contextTargetId);
});
$('ctx-delete').addEventListener('click', async () => {
  const visId = state.contextTargetId;
  if (visNodes.get(visId)) await deleteNode(visId);
  else if (visEdges.get(visId)) await deleteEdge(visId);
});

// ── キーボード ────────────────────────────────────────────────────────────
document.addEventListener('keydown', async e => {
  if (e.key === 'Escape') {
    if (state.addMode) exitAddMode();
    if (state.connectMode) exitConnectMode();
    hideContextMenu();
    elModalAdd.classList.remove('visible');
    elModalEdit.classList.remove('visible');
    elModalYaml.classList.remove('visible');
    elModalLink.classList.remove('visible');
    $('modal-bulk-cmd').classList.remove('visible');
    $('modal-ping').classList.remove('visible');
    $('modal-broadcast-select').classList.remove('visible');
    closeTplModal();
  }
  if (e.key === 'Escape' && e.shiftKey && _broadcastMode) {
    _broadcastSyncOn = !_broadcastSyncOn;
    _updateBroadcastSyncIndicator();
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !isInputFocused()) {
    await deleteSelected();
  }
});

// ── 初期化 ────────────────────────────────────────────────────────────────
async function init() {
  try {
    await loadNodeTypes();
    await loadTemplates();
    // ブラウザリロード後もバックエンドのトポロジーを復元
    const topo = await api('GET', '/api/topology');
    applyTopology(topo);
    if (topo.nodes.length > 0) {
      log(`トポロジーを復元しました (ノード: ${topo.nodes.length}, リンク: ${topo.links.length})`, 'ok');
    }
    await refreshStatus();
    if (state.deployed && !allNodesReady()) startPolling();
    updateHint();
    log('ContainerLab GUI 起動しました', 'info');
  } catch (e) {
    log(`初期化エラー: ${e.message}`, 'error');
    console.error('init error:', e);
  }
}

init();
