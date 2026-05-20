'use strict';

// デプロイ / 破棄、ステータスポーリング、起動後 SSH コンフィグ自動投入、
// トポロジーの JSON エクスポート / インポート。
// core.js / topology.js / detail.js / cli.js (_updateBroadcastBtn) に依存。

// ── デプロイ / 破棄 ───────────────────────────────────────────────────────
$('btn-deploy').addEventListener('click', async () => {
  $('btn-deploy').disabled = true;
  state.deploying = true;
  updateStatusBadge();
  log('デプロイ開始...', 'info');
  try {
    const res = await api('POST', '/api/deploy');
    if (res.success) {
      log('コンテナ起動完了 — VM 起動待機中... (数分かかります)', 'ok');
      if (res.node_count !== undefined) log(`ノード数: ${res.node_count}, リンク数: ${res.link_count}`, 'info');
      state.deployed = true;
      state.deploying = false;
      await refreshStatus();
      startPolling();
    } else {
      log('デプロイ失敗:\n' + res.output, 'error');
      state.deploying = false;
      updateStatusBadge();
    }
  } catch (e) {
    log(`デプロイエラー: ${e.message}`, 'error');
    state.deploying = false;
    updateStatusBadge();
  } finally {
    $('btn-deploy').disabled = false;
  }
});

$('btn-destroy').addEventListener('click', async () => {
  if (!confirm('ラボを破棄しますか？')) return;
  $('btn-destroy').disabled = true;
  log('ラボを破棄中...', 'warn');
  try {
    const res = await api('POST', '/api/destroy');
    if (res.success) {
      log('ラボを破棄しました', 'warn');
      state.deployed = false;
      state.deployedNodes = {};
      stopPolling();
      updateStatusBadge();
      updateNodeColors();
      renderDetailPanel(state.selectedNodeId);
      renderDeployedList();
    } else { log('破棄失敗:\n' + res.output, 'error'); }
  } catch (e) { log(`破棄エラー: ${e.message}`, 'error'); }
  finally { $('btn-destroy').disabled = false; }
});

// ── ステータス更新 ─────────────────────────────────────────────────────────
let _lastMclagStatus = '';
async function refreshStatus() {
  try {
    const s = await api('GET', '/api/status');
    state.deployed = s.deployed;
    state.deployedNodes = s.deployed_nodes;
    if (s.mclag_status && s.mclag_status !== _lastMclagStatus) {
      const lvl = s.mclag_status.includes('完了') ? 'ok'
                : s.mclag_status.includes('タイムアウト') ? 'error' : 'info';
      log(`[MCLAG] ${s.mclag_status}`, lvl);
      _lastMclagStatus = s.mclag_status;
    }
    updateStatusBadge();
    updateNodeColors();
    renderDeployedList();
    _updateBroadcastBtn();
    if (state.selectedNodeId) renderDetailPanel(state.selectedNodeId, 'node');
    else if (state.selectedEdgeId) renderDetailPanel(state.selectedEdgeId, 'edge');
  } catch (e) { log(`ステータス取得エラー: ${e.message}`, 'error'); }
}

function allNodesReady() {
  if (!state.deployed) return false;
  const nodes = visNodes.get();
  if (nodes.length === 0) return false;
  return nodes.every(vn => {
    const nd  = _nodeData.get(vn.id);
    const dep = state.deployedNodes?.[nd?.name];
    return dep && dep.mgmt_ip;
  });
}

function updateStatusBadge() {
  elStatus.className = '';
  if (state.deploying) {
    elStatus.textContent = 'デプロイ中...';
    elStatus.classList.add('deploying');
  } else if (state.deployed && !allNodesReady()) {
    elStatus.textContent = '起動待機中...';
    elStatus.classList.add('waiting');
  } else if (state.deployed) {
    elStatus.textContent = 'デプロイ済み';
    elStatus.classList.add('deployed');
  } else {
    elStatus.textContent = '未デプロイ';
  }
}

// ── ポーリング ────────────────────────────────────────────────────────────
let _pollTimer = null;

function startPolling() {
  if (_pollTimer) return;
  _pollTimer = setInterval(async () => {
    await refreshStatus();
    if (allNodesReady()) {
      log('全ノード準備完了', 'ok');
      stopPolling();
      if (state.pendingConfigPush) {
        state.pendingConfigPush = false;
        log('テンプレートコンフィグを SSH で投入中...', 'info');
        applyConfigsWithRetry();  // fire-and-forget: VM 起動完了まで自動リトライ
      }
    }
  }, 5000);
}

function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// SSH コンフィグ投入（VM 起動完了まで最大 10 回リトライ）
async function applyConfigsWithRetry() {
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`SSH コンフィグ投入 (試行 ${attempt}/${maxAttempts})...`, 'info');
    try {
      const res = await api('POST', '/api/apply-configs');
      const results = res.results || {};
      const names = Object.keys(results);
      if (names.length === 0) {
        log('投入するコンフィグがありません', 'warn');
        return;
      }
      const hasError = Object.values(results).some(r => r.error);
      for (const [name, r] of Object.entries(results)) {
        if (r.error) log(`コンフィグ投入失敗 [${name}]: ${r.error}`, 'warn');
        else log(`コンフィグ投入完了 [${name}]`, 'ok');
      }
      if (!hasError) {
        log('─────────────────────────────', 'info');
        log('構築完了 — 全ノードへのコンフィグ投入が完了しました', 'ok');
        log('─────────────────────────────', 'info');
        return;
      }
    } catch (e) {
      log(`コンフィグ投入エラー: ${e.message}`, 'warn');
    }
    if (attempt < maxAttempts) {
      log('30秒後に再試行します...', 'info');
      await new Promise(r => setTimeout(r, 30000));
    }
  }
  log('コンフィグ投入の最大試行回数に達しました。手動で再試行してください。', 'error');
}

// ── トポロジー保存 / 読み込み ─────────────────────────────────────────────
$('btn-save').addEventListener('click', async () => {
  try {
    const data = await api('GET', '/api/topology/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `clab-topology-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    const cfgCount = Object.keys(data.configs || {}).length;
    const cfgMsg = cfgCount > 0 ? `（コンフィグ含む: ${cfgCount} ノード）` : '（トポロジーのみ）';
    log(`トポロジーを保存しました ${cfgMsg}`, 'ok');
  } catch (e) {
    log(`保存エラー: ${e.message}`, 'error');
  }
});

$('btn-load').addEventListener('click', () => $('file-input-topo').click());

$('file-input-topo').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!confirm('現在のトポロジーを上書きして読み込みますか？')) return;
    const topo = await api('POST', '/api/topology/import', { data });
    applyTopology(topo);
    const cfgCount = Object.keys(data.configs || {}).length;
    log(`トポロジーを読み込みました (ノード: ${topo.nodes.length}, リンク: ${topo.links.length})`, 'ok');
    if (cfgCount > 0) {
      state.pendingConfigPush = true;
      log(`コンフィグあり: ${cfgCount} ノード — デプロイ後に SSH で自動投入されます`, 'ok');
    } else {
      log('コンフィグなし — デプロイ後は初期状態になります', 'warn');
    }
  } catch (e) {
    log(`読み込みエラー: ${e.message}`, 'error');
  }
});
