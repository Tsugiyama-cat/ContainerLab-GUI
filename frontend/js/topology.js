'use strict';

// ノードパレット、ノード/リンクの追加・編集・削除、モード制御、YAML 表示。
// core.js (state, _nodeData, _edgeData, visNodes, visEdges, network, $, api, log,
// escapeHtml, updateHint) と detail.js (renderDetailPanel, _renderNodeDetail) に依存。

// ── ノードタイプ ───────────────────────────────────────────────────────────
async function loadNodeTypes() {
  const data = await api('GET', '/api/node-types');
  state.nodeTypes = data.types;
  renderPalette();
}
function getNodeType(typeId) {
  return state.nodeTypes.find(t => t.id === typeId);
}
function renderPalette() {
  const palette = $('node-palette');
  palette.innerHTML = '';
  for (const t of state.nodeTypes) {
    const card = document.createElement('div');
    card.className = 'node-card';
    card.dataset.type = t.id;
    const color = escapeHtml(t.color);
    card.innerHTML = `
      <div class="node-card-icon" style="background:${color}20;color:${color}">&#9632;</div>
      <div class="node-card-info">
        <div class="node-card-name">${escapeHtml(t.name)}</div>
        <div class="node-card-kind">${escapeHtml(t.kind)}</div>
      </div>`;
    card.addEventListener('click', () => enterAddMode(t.id));
    palette.appendChild(card);
  }
}

// ── ノード追加モード ──────────────────────────────────────────────────────
function enterAddMode(typeId) {
  if (state.connectMode) exitConnectMode();
  state.addMode = typeId;
  state.selectedNodeId = null;
  network.unselectAll();
  renderDetailPanel(null);
  const t = getNodeType(typeId);
  showModeIndicator(`${t.name} を配置 — キャンバスをクリック`);
  elCanvas.style.cursor = 'crosshair';
  document.querySelectorAll('.node-card').forEach(c => c.classList.remove('active'));
  document.querySelector(`.node-card[data-type="${typeId}"]`)?.classList.add('active');
}
function exitAddMode() {
  state.addMode = null;
  state.pendingPos = null;
  elCanvas.style.cursor = '';
  hideModeIndicator();
  document.querySelectorAll('.node-card').forEach(c => c.classList.remove('active'));
}

// ── 接続モード ────────────────────────────────────────────────────────────
function enterConnectMode() {
  if (state.addMode) exitAddMode();
  state.connectMode = true;
  state.connectSource = null;
  $('btn-connect').classList.add('active');
  showModeIndicator('接続元ノードをクリック');
  elCanvas.style.cursor = 'pointer';
}
function exitConnectMode() {
  state.connectMode = false;
  state.connectSource = null;
  $('btn-connect').classList.remove('active');
  hideModeIndicator();
  elCanvas.style.cursor = '';
  const updates = [];
  visNodes.forEach(n => updates.push({ id: n.id, borderWidth: 2, borderWidthSelected: 3 }));
  if (updates.length) visNodes.update(updates);
}

// ── モードインジケーター ───────────────────────────────────────────────────
function showModeIndicator(text) { elModeInd.textContent = text; elModeInd.classList.add('visible'); }
function hideModeIndicator()     { elModeInd.classList.remove('visible'); }

// ── ノード追加ダイアログ ───────────────────────────────────────────────────
let _addType = null;

function showAddModal(typeId, pos) {
  _addType = typeId;
  state.pendingPos = pos;
  const t = getNodeType(typeId);
  $('modal-add-title').textContent = `${t.name} を追加`;
  $('input-node-name').value = '';
  $('input-node-image').value = t.default_image || '';
  $('input-node-image-hint').textContent = t.image_hint || '';
  elModalAdd.classList.add('visible');
  $('input-node-name').focus();
}

$('btn-add-cancel').addEventListener('click', () => { elModalAdd.classList.remove('visible'); exitAddMode(); });
$('btn-add-confirm').addEventListener('click', confirmAddNode);
$('input-node-name').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAddNode(); });

async function confirmAddNode() {
  const name  = $('input-node-name').value.trim() || null;
  const image = $('input-node-image').value.trim() || null;
  if (!image) {
    $('input-node-image').focus();
    $('input-node-image').style.borderColor = 'var(--danger)';
    setTimeout(() => { $('input-node-image').style.borderColor = ''; }, 2000);
    return;
  }
  elModalAdd.classList.remove('visible');
  try {
    const node = await api('POST', '/api/topology/node', { node_type: _addType, label: name, image });
    addVisNode(node, state.pendingPos);
    log(`ノード追加: ${node.name} (${node.kind})`, 'ok');
    if (state.deployed) {
      log('⚠ デプロイ済みのため、再デプロイしないとラボに反映されません', 'warn');
    }
    updateHint();
  } catch (e) {
    log(`ノード追加エラー: ${e.message}`, 'error');
  }
  exitAddMode();
}

function addVisNode(node, pos) {
  const t = getNodeType(node.type);
  const color = t ? t.color : '#888';
  _nodeData.set(node.id, node);
  visNodes.add({
    id: node.id,
    label: node.name,
    color: {
      background: color + '33', border: color,
      highlight: { background: color + '55', border: color },
      hover:      { background: color + '44', border: color },
    },
    font: { color: '#d4d8e2' },
    x: pos ? pos.x : undefined,
    y: pos ? pos.y : undefined,
  });
}

// ── 複数リンク対応: エッジの曲率を自動計算 ───────────────────────────────
function computeEdgeSmooth(fromId, toId) {
  let count = 0;
  visEdges.forEach(e => {
    if ((e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId)) count++;
  });
  if (count === 0) return { enabled: true, type: 'curvedCW', roundness: 0.15 };
  const level = Math.floor(count / 2);
  return {
    enabled:   true,
    type:      count % 2 === 1 ? 'curvedCCW' : 'curvedCW',
    roundness: 0.15 + level * 0.2,
  };
}

// ── トポロジー全体をキャンバスに適用（import / template ロード共通） ────
function applyTopology(topo) {
  visNodes.clear();
  visEdges.clear();
  _nodeData.clear();
  _edgeData.clear();
  for (const node of topo.nodes) addVisNode(node, null);
  for (const link of topo.links) {
    _edgeData.set(link.id, link);
    visEdges.add({
      id:     link.id,
      from:   link.source_id,
      to:     link.target_id,
      label:  `${link.source_iface} ↔ ${link.target_iface}`,
      smooth: computeEdgeSmooth(link.source_id, link.target_id),
    });
  }
  state.deployed      = topo.deployed;
  state.deployedNodes = topo.deployed_nodes;
  updateStatusBadge();
  updateNodeColors();
  renderDeployedList();
  renderDetailPanel(null);
  updateHint();
}

// ── リンク追加 ────────────────────────────────────────────────────────────
async function createLink(srcId, tgtId, srcPort, tgtPort) {
  try {
    const body = { source_id: srcId, target_id: tgtId };
    if (srcPort !== undefined && !isNaN(srcPort)) body.source_port = srcPort;
    if (tgtPort !== undefined && !isNaN(tgtPort)) body.target_port = tgtPort;
    const link = await api('POST', '/api/topology/link', body);
    const srcNode = _nodeData.get(srcId);
    const tgtNode = _nodeData.get(tgtId);

    let pairCount = 0;
    visEdges.forEach(e => {
      if ((e.from === srcId && e.to === tgtId) || (e.from === tgtId && e.to === srcId)) pairCount++;
    });
    if (pairCount > 0) log(`同一ノード間 ${pairCount + 1} 本目のリンクを追加します`, 'warn');

    _edgeData.set(link.id, link);
    visEdges.add({
      id:     link.id,
      from:   srcId,
      to:     tgtId,
      label:  `${link.source_iface} ↔ ${link.target_iface}`,
      smooth: computeEdgeSmooth(srcId, tgtId),
    });
    log(`接続: ${srcNode?.name}:${link.source_iface} ↔ ${tgtNode?.name}:${link.target_iface}`, 'ok');
    if (state.deployed) {
      log('⚠ デプロイ済みのため、再デプロイしないとラボに反映されません', 'warn');
    }
  } catch (e) {
    log(`接続エラー: ${e.message}`, 'error');
  }
}

// ── リンクポート選択モーダル ───────────────────────────────────────────────
let _linkSrcId = null;
let _linkTgtId = null;

function nextAvailablePort(nodeId, ifaceStart) {
  const used = new Set();
  visEdges.forEach(e => {
    const lk = _edgeData.get(e.id);
    if (!lk) return;
    if (e.from === nodeId) used.add(lk.source_port);
    if (e.to   === nodeId) used.add(lk.target_port);
  });
  let p = ifaceStart;
  while (used.has(p)) p++;
  return p;
}

function showLinkModal(srcId, tgtId) {
  _linkSrcId = srcId;
  _linkTgtId = tgtId;
  const src = _nodeData.get(srcId);
  const tgt = _nodeData.get(tgtId);
  if (!src || !tgt) return;
  $('link-src-label').textContent = src.name;
  $('link-src-prefix').textContent = src.iface_fmt.replace('{n}', '');
  $('link-src-port').value = nextAvailablePort(srcId, src.iface_start);
  $('link-tgt-label').textContent = tgt.name;
  $('link-tgt-prefix').textContent = tgt.iface_fmt.replace('{n}', '');
  $('link-tgt-port').value = nextAvailablePort(tgtId, tgt.iface_start);
  elModalLink.classList.add('visible');
  $('link-src-port').focus();
}

$('btn-link-cancel').addEventListener('click', () => elModalLink.classList.remove('visible'));
$('btn-link-confirm').addEventListener('click', confirmLink);
$('link-tgt-port').addEventListener('keydown', e => { if (e.key === 'Enter') confirmLink(); });

async function confirmLink() {
  const sp = parseInt($('link-src-port').value, 10);
  const tp = parseInt($('link-tgt-port').value, 10);
  elModalLink.classList.remove('visible');
  if (isNaN(sp) || isNaN(tp)) { log('無効なポート番号です', 'error'); return; }
  const srcName = _nodeData.get(_linkSrcId)?.name || _linkSrcId;
  const tgtName = _nodeData.get(_linkTgtId)?.name || _linkTgtId;
  log(`リンク作成中: ${srcName} ↔ ${tgtName}`, 'info');
  await createLink(_linkSrcId, _linkTgtId, sp, tp);
}

// ── 削除 ──────────────────────────────────────────────────────────────────
async function deleteSelected() {
  const sel = network.getSelection();
  for (const nid of sel.nodes) await deleteNode(nid);
  for (const eid of sel.edges) { if (visEdges.get(eid)) await deleteEdge(eid); }
}
async function deleteNode(visId) {
  try {
    await api('DELETE', `/api/topology/node/${visId}`);
    network.getConnectedEdges(visId).forEach(eid => { visEdges.remove(eid); _edgeData.delete(eid); });
    visNodes.remove(visId);
    _nodeData.delete(visId);
    log(`ノード削除: ${visId}`, 'warn');
    if (state.selectedNodeId === visId) { state.selectedNodeId = null; renderDetailPanel(null); }
    updateHint();
  } catch (e) { log(`削除エラー: ${e.message}`, 'error'); }
}
async function deleteEdge(visId) {
  try {
    await api('DELETE', `/api/topology/link/${visId}`);
    visEdges.remove(visId);
    _edgeData.delete(visId);
    log(`リンク削除: ${visId}`, 'warn');
    if (state.selectedEdgeId === visId) { state.selectedEdgeId = null; renderDetailPanel(null); }
  } catch (e) { log(`削除エラー: ${e.message}`, 'error'); }
}

function selectEdge(eid) {
  network.selectEdges([eid]);
  state.selectedEdgeId = eid;
  state.selectedNodeId = null;
  renderDetailPanel(eid, 'edge');
}

// ── ノード編集 ────────────────────────────────────────────────────────────
let _editNodeId = null;

function showEditModal(visId) {
  _editNodeId = visId;
  const nd = _nodeData.get(visId);
  $('edit-node-name').value  = nd?.name  || '';
  $('edit-node-image').value = nd?.image || '';
  elModalEdit.classList.add('visible');
  $('edit-node-name').focus();
}
$('btn-edit-cancel').addEventListener('click',  () => elModalEdit.classList.remove('visible'));
$('btn-edit-confirm').addEventListener('click', confirmEdit);

async function confirmEdit() {
  const name  = $('edit-node-name').value.trim()  || null;
  const image = $('edit-node-image').value.trim() || null;
  elModalEdit.classList.remove('visible');
  try {
    const node = await api('PATCH', `/api/topology/node/${_editNodeId}`, { name, image });
    _nodeData.set(_editNodeId, node);
    visNodes.update({ id: _editNodeId, label: node.name });
    log(`ノード更新: ${node.name}`, 'ok');
    renderDetailPanel(_editNodeId, 'node');
  } catch (e) { log(`更新エラー: ${e.message}`, 'error'); }
}

// ── YAML 表示 ─────────────────────────────────────────────────────────────
$('btn-yaml').addEventListener('click', async () => {
  try {
    const data = await api('GET', '/api/topology/yaml');
    $('yaml-content').textContent = data.yaml;
    elModalYaml.classList.add('visible');
  } catch (e) { log(`YAMLエラー: ${e.message}`, 'error'); }
});
$('btn-yaml-close').addEventListener('click', () => elModalYaml.classList.remove('visible'));

// ── ノード色更新 ──────────────────────────────────────────────────────────
function updateNodeColors() {
  visNodes.forEach(vn => {
    const nd    = _nodeData.get(vn.id);
    const t     = getNodeType(nd?.type);
    const color = t ? t.color : '#888';
    const dep   = state.deployedNodes?.[nd?.name];
    const isRunning = dep?.state === 'running';
    const borderColor = state.deployed
      ? (dep?.mgmt_ip ? (isRunning ? '#4caf7d' : '#f0a940') : '#4a5060')
      : color;
    visNodes.update({
      id: vn.id,
      color: {
        background: color + '33', border: borderColor,
        highlight: { background: color + '55', border: borderColor },
        hover:      { background: color + '44', border: borderColor },
      },
    });
  });
}

// ── vis.js イベント ───────────────────────────────────────────────────────
network.on('click', params => {
  hideContextMenu();

  if (state.addMode) {
    if (params.nodes.length === 0 && params.edges.length === 0) {
      showAddModal(state.addMode, params.pointer.canvas);
    } else { exitAddMode(); }
    return;
  }

  if (state.connectMode) {
    const nodeId = params.nodes[0];
    if (!nodeId) { exitConnectMode(); return; }
    if (!state.connectSource) {
      state.connectSource = nodeId;
      visNodes.update({ id: nodeId, borderWidth: 4, borderWidthSelected: 4 });
      showModeIndicator('接続先ノードをクリック');
    } else if (nodeId !== state.connectSource) {
      const src = state.connectSource;
      exitConnectMode();
      showLinkModal(src, nodeId);
    }
    return;
  }

  if (params.nodes.length > 0) {
    state.selectedNodeId = params.nodes[0];
    state.selectedEdgeId = null;
    const _nd = _nodeData.get(state.selectedNodeId);
    log(`選択: ${_nd ? _nd.name : state.selectedNodeId}`, 'info');
    renderDetailPanel(state.selectedNodeId, 'node');
    renderDeployedList();
  } else if (params.edges.length > 0) {
    state.selectedNodeId = null;
    state.selectedEdgeId = params.edges[0];
    renderDetailPanel(state.selectedEdgeId, 'edge');
  } else {
    state.selectedNodeId = null;
    state.selectedEdgeId = null;
    renderDetailPanel(null);
  }
});

network.on('doubleClick', params => {
  if (params.nodes.length > 0) {
    const nd = _nodeData.get(params.nodes[0]);
    if (nd && state.deployed) openCLITab(nd.name, nd.ssh_port);
  }
});

// ── 接続モード ボタン ────────────────────────────────────────────────────
$('btn-connect').addEventListener('click', () => {
  if (state.connectMode) exitConnectMode(); else enterConnectMode();
});
$('btn-delete').addEventListener('click', deleteSelected);
