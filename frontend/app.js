'use strict';

// ── 状態 ───────────────────────────────────────────────────────────────────
const state = {
  nodeTypes: [],
  templates: [],
  addMode: null,
  connectMode: false,
  connectSource: null,
  selectedNodeId: null,
  selectedEdgeId: null,
  pendingPos: null,
  deployed: false,
  deploying: false,
  deployedNodes: {},
  contextTargetId: null,
  pendingConfigPush: false,  // デプロイ後に SSH コンフィグ投入が必要
};

// ── ノード/エッジ API データを別管理 ──────────────────────────────────────
const _nodeData = new Map();  // nodeId -> API node object
const _edgeData = new Map();  // edgeId -> API link object

// ── vis.js データ ──────────────────────────────────────────────────────────
const visNodes = new vis.DataSet();
const visEdges = new vis.DataSet();

// ── DOM 参照 ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const elCanvas     = $('network-canvas');
const elHint       = $('canvas-hint');
const elModeInd    = $('mode-indicator');
const elStatus     = $('status-badge');
const elLogContent = $('log-content');
const elCtxMenu    = $('context-menu');
const elModalAdd   = $('modal-add');
const elModalEdit  = $('modal-edit');
const elModalYaml  = $('modal-yaml');
const elModalLink  = $('modal-link');

// ── vis.js ネットワーク初期化 ──────────────────────────────────────────────
const network = new vis.Network(elCanvas, { nodes: visNodes, edges: visEdges }, {
  nodes: {
    shape: 'box',
    margin: { top: 8, right: 14, bottom: 8, left: 14 },
    font: { size: 13, color: '#ffffff', face: 'Consolas, monospace' },
    borderWidth: 2,
    shadow: { enabled: true, size: 6, x: 0, y: 3 },
  },
  edges: {
    width: 2,
    color: { color: '#4a5060', highlight: '#4f8ef7', hover: '#6aa3ff' },
    smooth: { enabled: true, type: 'curvedCW', roundness: 0.15 },
    font: { size: 10, color: '#7a8199', align: 'middle' },
    selectionWidth: 3,
  },
  interaction: { hover: true, multiselect: false, selectConnectedEdges: false, dragNodes: true, dragView: false },
  physics: {
    enabled: true,
    solver: 'forceAtlas2Based',
    forceAtlas2Based: { gravitationalConstant: -80, springLength: 150 },
    stabilization: { iterations: 150 },
  },
  manipulation: { enabled: false },
});

// ── API ヘルパー ───────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

// ── ログ ────────────────────────────────────────────────────────────────────
function log(msg, level = 'info') {
  const now = new Date().toTimeString().slice(0, 8);
  const el = document.createElement('div');
  el.className = `log-entry ${level}`;
  el.textContent = `[${now}] ${msg}`;
  elLogContent.appendChild(el);
  elLogContent.scrollTop = elLogContent.scrollHeight;
}

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
    card.innerHTML = `
      <div class="node-card-icon" style="background:${t.color}20;color:${t.color}">&#9632;</div>
      <div class="node-card-info">
        <div class="node-card-name">${t.name}</div>
        <div class="node-card-kind">${t.kind}</div>
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

// ── 右詳細パネル ──────────────────────────────────────────────────────────
function renderDetailPanel(id, type) {
  const dc = $('detail-content');
  if (!dc) return;
  if (!id) {
    dc.innerHTML = '<p class="dim-text">ノードまたはリンクをクリック</p>';
    return;
  }
  try {
    if (type === 'edge') {
      _renderEdgeDetail(dc, id);
    } else {
      _renderNodeDetail(dc, id);
    }
  } catch (e) {
    dc.innerHTML = `<p class="dim-text" style="color:var(--danger)">表示エラー: ${e.message}</p>`;
    console.error('renderDetailPanel error:', e);
  }
}

function _renderEdgeDetail(dc, id) {
  const lk  = _edgeData.get(id);
  const edge = visEdges.get(id);
  if (!lk || !edge) { dc.innerHTML = '<p class="dim-text">リンクが見つかりません</p>'; return; }
  const srcNd = _nodeData.get(edge.from);
  const tgtNd = _nodeData.get(edge.to);
  dc.innerHTML = `
    <div class="detail-section">
      <div class="detail-section-title">リンク</div>
      <div class="info-row"><span class="info-label">接続元</span><span class="info-value">${srcNd ? srcNd.name : '-'}</span></div>
      <div class="info-row"><span class="info-label">IF</span><span class="info-value">${lk.source_iface || '-'}</span></div>
    </div>
    <div class="detail-divider"></div>
    <div class="detail-section">
      <div class="info-row"><span class="info-label">接続先</span><span class="info-value">${tgtNd ? tgtNd.name : '-'}</span></div>
      <div class="info-row"><span class="info-label">IF</span><span class="info-value">${lk.target_iface || '-'}</span></div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-danger btn-sm" onclick="deleteEdge('${id}')">削除</button>
    </div>`;
}

function _renderNodeDetail(dc, id) {
  const nd = _nodeData.get(id);
  if (!nd) { dc.innerHTML = '<p class="dim-text">ノードが見つかりません</p>'; return; }
  const dep = (state.deployedNodes || {})[nd.name];
  const stateStr   = (dep && dep.state) ? dep.state : '';
  const stateClass = stateStr === 'running' ? 'ok' : stateStr ? 'warn' : '';
  const imgShort   = (nd.image || '').split('/').pop();

  let linksHtml = '';
  try {
    const connEdges = network.getConnectedEdges(id);
    for (const eid of connEdges) {
      const edge = visEdges.get(eid);
      const lk   = _edgeData.get(eid);
      if (!edge || !lk) continue;
      const isSource   = edge.from === id;
      const myIface    = isSource ? (lk.source_iface || '-') : (lk.target_iface || '-');
      const otherIface = isSource ? (lk.target_iface || '-') : (lk.source_iface || '-');
      const otherId    = isSource ? edge.to : edge.from;
      const otherNd    = _nodeData.get(otherId);
      const otherName  = otherNd ? otherNd.name : '?';
      linksHtml += `<div class="link-row" onclick="selectEdge('${eid}')">${myIface} &harr; ${otherName}:${otherIface}</div>`;
    }
  } catch (_) {}

  const configSectionId = `cfg-${id}`;
  const hasIp = dep && dep.mgmt_ip;

  dc.innerHTML = `
    <div class="detail-section">
      <div class="detail-section-title">ノード</div>
      <div class="info-row"><span class="info-label">名前</span><span class="info-value">${nd.name || '-'}</span></div>
      <div class="info-row"><span class="info-label">種別</span><span class="info-value">${nd.kind || '-'}</span></div>
      <div class="info-row"><span class="info-label">イメージ</span><span class="info-value" title="${nd.image || ''}">${imgShort || '-'}</span></div>
      <div class="info-row"><span class="info-label">SSH ユーザ</span><span class="info-value">${nd.ssh_user || '-'}</span></div>
    </div>
    ${dep ? `<div class="detail-divider"></div>
    <div class="detail-section">
      <div class="detail-section-title">デプロイ情報</div>
      <div class="info-row"><span class="info-label">状態</span><span class="info-value ${stateClass}">${stateStr || '-'}</span></div>
      <div class="info-row"><span class="info-label">管理IP</span><span class="info-value">${dep.mgmt_ip || '待機中...'}</span></div>
    </div>` : ''}
    ${linksHtml ? `<div class="detail-divider"></div>
    <div class="detail-section">
      <div class="detail-section-title">リンク</div>
      ${linksHtml}
    </div>` : ''}
    ${hasIp ? `<div class="detail-divider"></div>
    <div class="detail-section">
      <div class="detail-section-title" style="display:flex;align-items:center;justify-content:space-between">
        設定情報
        <button class="btn btn-ghost btn-sm" onclick="loadNodeConfig('${nd.name}','${configSectionId}')">↺ 更新</button>
      </div>
      <div id="${configSectionId}"><span class="dim-text">読み込み中...</span></div>
    </div>` : ''}
    <div class="detail-divider"></div>
    <div class="detail-actions">
      ${state.deployed ? `<button class="btn btn-success btn-sm" onclick="openCLITab('${nd.name}',${nd.ssh_port || 22})">CLI</button>` : ''}
      ${hasIp ? `<button class="btn btn-ghost btn-sm" onclick="showPingModal('${nd.name}')">ping</button>` : ''}
      ${hasIp ? `<button class="btn btn-ghost btn-sm" onclick="downloadBackup('${nd.name}')">設定保存</button>` : ''}
      <button class="btn btn-ghost btn-sm" onclick="showEditModal('${id}')">編集</button>
      <button class="btn btn-danger btn-sm" onclick="deleteNode('${id}')">削除</button>
    </div>`;

  if (hasIp) loadNodeConfig(nd.name, configSectionId);
}

async function loadNodeConfig(nodeName, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<span class="dim-text">取得中...</span>';
  try {
    const cfg = await api('GET', `/api/node/${encodeURIComponent(nodeName)}/config`);
    el.innerHTML = _renderConfigHtml(cfg);
  } catch (e) {
    el.innerHTML = `<span class="dim-text" style="color:var(--danger)">取得失敗: ${e.message}</span>`;
  }
}

function _renderConfigHtml(cfg) {
  let html = '';

  // VLAN
  if (cfg.vlans && cfg.vlans.length) {
    html += `<div class="cfg-subtitle">VLAN</div>
    <table class="cfg-table">
      <tr><th>ID</th><th>名前</th><th>状態</th></tr>`;
    for (const v of cfg.vlans) {
      html += `<tr><td>${v.id}</td><td>${v.name}</td><td class="${v.status === 'up' ? 'ok' : 'warn'}">${v.status}</td></tr>`;
    }
    html += '</table>';
  }

  // IP インターフェース（show ip interface + running-config の VLAN IF をマージ）
  const ipMap = new Map();
  for (const i of (cfg.ip_interfaces || [])) {
    ipMap.set(i.interface, { interface: i.interface, ip: i.ip, status: i.status || '-' });
  }
  for (const i of (cfg.interfaces || [])) {
    if (i.ip && !ipMap.has(i.name)) {
      ipMap.set(i.name, { interface: i.name, ip: i.ip, status: i.shutdown ? 'down' : 'up' });
    }
  }
  if (ipMap.size) {
    html += `<div class="cfg-subtitle">IP アドレス</div>
    <table class="cfg-table">
      <tr><th>IF</th><th>IP アドレス</th><th>状態</th></tr>`;
    for (const i of ipMap.values()) {
      html += `<tr><td>${i.interface}</td><td>${i.ip}</td><td>${i.status}</td></tr>`;
    }
    html += '</table>';
  }

  // インターフェース
  const phys = (cfg.interfaces || []).filter(i => /^\d+\/\d+\/\d+/.test(i.name));
  if (phys.length) {
    html += `<div class="cfg-subtitle">インターフェース</div>
    <table class="cfg-table">
      <tr><th>IF</th><th>モード</th><th>VLAN</th><th>状態</th></tr>`;
    for (const i of phys) {
      const vlanCol = i.mode === 'access' ? i.vlan
                    : i.mode === 'trunk'  ? i.trunk_vlans
                    : '-';
      html += `<tr><td>${i.name}</td><td>${i.mode}</td><td>${vlanCol ?? '-'}</td><td class="${i.shutdown ? 'warn' : 'ok'}">${i.shutdown ? 'down' : 'up'}</td></tr>`;
    }
    html += '</table>';
  }

  if (!html) html = '<span class="dim-text">設定情報なし</span>';
  return html;
}

function selectEdge(eid) {
  network.selectEdges([eid]);
  state.selectedEdgeId = eid;
  state.selectedNodeId = null;
  renderDetailPanel(eid, 'edge');
}

// ── デプロイ済み機器一覧 ───────────────────────────────────────────────────
function renderDeployedList() {
  const section = $('deployed-section');
  const list    = $('deployed-list');
  const names   = Object.keys(state.deployedNodes);
  if (!state.deployed || names.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  list.innerHTML = '';
  for (const name of names) {
    const dep  = state.deployedNodes[name];
    const dotClass = dep.state === 'running' ? 'running' : dep.state === 'exited' ? 'error' : 'starting';
    const item = document.createElement('div');
    item.className = 'deployed-item';
    item.dataset.name = name;
    item.innerHTML = `
      <div class="deployed-dot ${dotClass}"></div>
      <div>
        <div class="deployed-name">${name}</div>
        <div class="deployed-ip">${dep.mgmt_ip || '起動待機中...'}</div>
      </div>`;
    item.addEventListener('click', () => selectDeployedNode(name));
    list.appendChild(item);
  }
  if (state.selectedNodeId) {
    const nd = _nodeData.get(state.selectedNodeId);
    if (nd) list.querySelector(`[data-name="${nd.name}"]`)?.classList.add('active');
  }
}

function selectDeployedNode(name) {
  let foundId = null;
  _nodeData.forEach((nd, id) => { if (nd.name === name) foundId = id; });
  if (foundId) {
    network.selectNodes([foundId]);
    network.focus(foundId, { scale: 1.2, animation: true });
    state.selectedNodeId = foundId;
    state.selectedEdgeId = null;
    renderDetailPanel(foundId, 'node');
  }
  renderDeployedList();
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

async function applyConfigs() {
  await applyConfigsWithRetry();
}
function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// ── CLI タブ (インライン xterm) ────────────────────────────────────────────
let _tabCounter    = 0;
let _activeTab     = 'log';
const _cliSessions = {};
let _broadcastMode    = false;
let _broadcastSessions = new Set(); // 一括入力対象の tabId セット

function openCLITab(nodeName, sshPort) {
  const port  = sshPort || 22;
  const tabId = `cli-${_tabCounter++}`;

  const tabBtn = document.createElement('div');
  tabBtn.className = 'bottom-tab';
  tabBtn.id = `tab-btn-${tabId}`;
  tabBtn.dataset.tab = tabId;
  tabBtn.innerHTML = `CLI: ${nodeName} <span class="tab-close" data-tabid="${tabId}">&#10005;</span>`;
  tabBtn.addEventListener('click', e => {
    if (e.target.dataset.tabid) { closeCLITab(e.target.dataset.tabid); return; }
    switchTab(tabId);
  });

  const pane = document.createElement('div');
  pane.className = 'tab-pane';
  pane.id = `tab-pane-${tabId}`;
  const inner = document.createElement('div');
  inner.className = 'cli-pane-inner';
  inner.id = `term-inner-${tabId}`;
  pane.appendChild(inner);

  const spacer = $('bottom-tabbar').querySelector('.tab-spacer');
  $('bottom-tabbar').insertBefore(tabBtn, spacer);
  $('bottom-content').appendChild(pane);

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 12,
    fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
    theme: {
      background: '#1a1d23', foreground: '#d4d8e2', cursor: '#4f8ef7',
      selectionBackground: 'rgba(79,142,247,0.3)',
      black: '#1a1d23', brightBlack: '#4a5060',
      red: '#e05252',   brightRed: '#ff6b6b',
      green: '#4caf7d', brightGreen: '#6dda9f',
      yellow: '#f0a940',brightYellow: '#ffc261',
      blue: '#4f8ef7',  brightBlue: '#6aa3ff',
      magenta: '#b07ceb',brightMagenta: '#c89aff',
      cyan: '#4ec9b0',  brightCyan: '#70ddc6',
      white: '#d4d8e2', brightWhite: '#ffffff',
    },
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(inner);

  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${wsProto}//${location.host}/ws/terminal/${encodeURIComponent(nodeName)}?port=${port}`);

  ws.onopen = () => {
    term.write(`\r\n\x1b[32m${nodeName} に接続中...\x1b[0m\r\n`);
    fitAddon.fit();
  };
  ws.onclose = () => term.write('\r\n\x1b[33m--- セッション終了 ---\x1b[0m\r\n');
  ws.onerror = () => term.write('\r\n\x1b[31mWebSocket エラー\x1b[0m\r\n');
  ws.onmessage = ev => {
    try { const m = JSON.parse(ev.data); if (m.type === 'output') term.write(m.data); }
    catch { term.write(ev.data); }
  };

  term.onData(data => {
    if (_broadcastMode) {
      for (const tid of _broadcastSessions) {
        const s = _cliSessions[tid];
        if (s?.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify({ type: 'input', data }));
      }
    } else {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    }
  });
  term.onResize(({ cols, rows }) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  });

  _cliSessions[tabId] = { term, fitAddon, ws, nodeName };
  _updateBroadcastBtn();
  switchTab(tabId);
  log(`CLI タブ起動: ${nodeName}`, 'ok');
}

function switchTab(tabId) {
  // 個別 CLI タブに切り替えたらブロードキャストモードを終了
  if (_broadcastMode && tabId !== 'log' && tabId !== 'broadcast') {
    exitBroadcastMode();
  }

  document.querySelectorAll('.bottom-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

  $(`tab-btn-${tabId}`)?.classList.add('active');
  $(`tab-pane-${tabId}`)?.classList.add('active');
  _activeTab = tabId;

  if (_cliSessions[tabId]) {
    requestAnimationFrame(() => _cliSessions[tabId].fitAddon.fit());
  }

  $('btn-clear-log').style.display = tabId === 'log' ? '' : 'none';
}

function closeCLITab(tabId) {
  // ブロードキャスト中にこのタブが含まれていたら整理
  if (_broadcastMode && _broadcastSessions.has(tabId)) {
    $(`broadcast-col-${tabId}`)?.remove();
    _broadcastSessions.delete(tabId);
    if (_broadcastSessions.size < 2) {
      // 残りを個別paneに戻してブロードキャスト終了
      _broadcastMode = false;
      for (const tid of _broadcastSessions) {
        const inner = $(`term-inner-${tid}`);
        const pane  = $(`tab-pane-${tid}`);
        if (inner && pane) pane.appendChild(inner);
        setTimeout(() => _cliSessions[tid]?.fitAddon.fit(), 50);
      }
      _broadcastSessions.clear();
      $('tab-pane-broadcast')?.remove();
      log('一括入力 OFF (残り1台以下)', 'info');
    }
  }

  const session = _cliSessions[tabId];
  if (session) {
    session.ws.close();
    session.term.dispose();
    delete _cliSessions[tabId];
  }
  $(`tab-btn-${tabId}`)?.remove();
  $(`tab-pane-${tabId}`)?.remove();
  if (_activeTab === tabId || _activeTab === 'broadcast') switchTab('log');
  _updateBroadcastBtn();
}

// ── 一括入力モード ────────────────────────────────────────────────────────
function _updateBroadcastBtn() {
  const btn   = $('btn-broadcast');
  const count = Object.keys(_cliSessions).length;
  if (_broadcastMode && _broadcastSessions.size === 0) {
    _broadcastMode = false;
  }
  btn.disabled = count <= 1;
  btn.classList.toggle('broadcast-active', _broadcastMode);
  btn.textContent = _broadcastMode
    ? `一括入力 ON (${_broadcastSessions.size}台)`
    : '一括入力';
}

function showBroadcastSelectModal() {
  const list = $('broadcast-node-list');
  list.innerHTML = '';
  for (const [tabId, session] of Object.entries(_cliSessions)) {
    const label = document.createElement('label');
    label.className = 'node-check-item';
    label.innerHTML = `<input type="checkbox" value="${tabId}" checked> ${session.nodeName}`;
    list.appendChild(label);
  }
  $('modal-broadcast-select').classList.add('visible');
}

function enterBroadcastMode(selectedTabIds) {
  _broadcastMode    = true;
  _broadcastSessions = new Set(selectedTabIds);

  // 横並びビューペインを構築
  let pane = $('tab-pane-broadcast');
  if (!pane) {
    pane = document.createElement('div');
    pane.id = 'tab-pane-broadcast';
    pane.className = 'tab-pane broadcast-view';
    $('bottom-content').appendChild(pane);
  } else {
    pane.innerHTML = '';
  }

  for (const tabId of selectedTabIds) {
    const session = _cliSessions[tabId];
    if (!session) continue;
    const col = document.createElement('div');
    col.className = 'broadcast-col';
    col.id = `broadcast-col-${tabId}`;
    const header = document.createElement('div');
    header.className = 'broadcast-col-header';
    header.textContent = session.nodeName;
    const inner = $(`term-inner-${tabId}`);
    col.appendChild(header);
    if (inner) col.appendChild(inner);
    pane.appendChild(col);

    // フォーカス時にカラムをハイライト
    session.term.onFocus(() => {
      document.querySelectorAll('.broadcast-col').forEach(c => c.classList.remove('focused'));
      col.classList.add('focused');
    });
  }

  switchTab('broadcast');
  setTimeout(() => {
    for (const tabId of _broadcastSessions) _cliSessions[tabId]?.fitAddon.fit();
  }, 50);

  _updateBroadcastBtn();
  const names = selectedTabIds.map(t => _cliSessions[t]?.nodeName).join(', ');
  log(`一括入力 ON — ${selectedTabIds.length} 台: ${names}`, 'warn');
}

function exitBroadcastMode() {
  if (!_broadcastMode) return;
  _broadcastMode = false;

  // 各ターミナルを元のペインに戻す
  for (const tabId of _broadcastSessions) {
    const inner = $(`term-inner-${tabId}`);
    const origPane = $(`tab-pane-${tabId}`);
    if (inner && origPane) origPane.appendChild(inner);
    setTimeout(() => _cliSessions[tabId]?.fitAddon.fit(), 50);
  }
  _broadcastSessions.clear();
  $('tab-pane-broadcast')?.remove();
  _updateBroadcastBtn();
  log('一括入力 OFF', 'info');
}

$('btn-broadcast').addEventListener('click', () => {
  if (_broadcastMode) { exitBroadcastMode(); return; }
  showBroadcastSelectModal();
});

$('btn-broadcast-cancel').addEventListener('click', () => {
  $('modal-broadcast-select').classList.remove('visible');
});

$('btn-broadcast-confirm').addEventListener('click', () => {
  const checked = [...$('broadcast-node-list').querySelectorAll('input[type=checkbox]:checked')];
  const ids = checked.map(c => c.value);
  $('modal-broadcast-select').classList.remove('visible');
  if (ids.length < 2) { log('2台以上選択してください', 'warn'); return; }
  enterBroadcastMode(ids);
});

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
    if (_activeTab !== 'log' && _cliSessions[_activeTab]) {
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

// ── ログ タブ切替 ──────────────────────────────────────────────────────────
$('tab-btn-log').addEventListener('click', () => switchTab('log'));
$('btn-clear-log').addEventListener('click', () => { elLogContent.innerHTML = ''; });

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
  if ((e.key === 'Delete' || e.key === 'Backspace') && !isInputFocused()) {
    await deleteSelected();
  }
});
function isInputFocused() {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

// ── ボタンイベント ────────────────────────────────────────────────────────
$('btn-connect').addEventListener('click', () => {
  if (state.connectMode) exitConnectMode(); else enterConnectMode();
});
$('btn-delete').addEventListener('click', deleteSelected);

// ── ヒント ─────────────────────────────────────────────────────────────────
function updateHint() {
  elHint.style.opacity = visNodes.length === 0 ? '1' : '0';
}

// ── HTML エスケープ ────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── トポロジー保存 ─────────────────────────────────────────────────────────
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

// ── トポロジー読み込み ─────────────────────────────────────────────────────
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

// ── コマンド一括投入 ───────────────────────────────────────────────────────
let _lastBulkResults = {};
let _bulkViewMode = 'result';

$('btn-bulk-cmd').addEventListener('click', () => {
  if (!state.deployed) { log('デプロイ後に使用できます', 'warn'); return; }
  const names = Object.keys(state.deployedNodes);
  if (names.length === 0) { log('デプロイ済みノードがありません', 'warn'); return; }
  const listEl = $('bulk-node-list');
  listEl.innerHTML = '';
  for (const name of names) {
    const label = document.createElement('label');
    label.className = 'node-check-item';
    label.innerHTML = `<input type="checkbox" value="${name}" checked> ${name}`;
    listEl.appendChild(label);
  }
  $('bulk-cmd-input').value = '';
  $('bulk-results').style.display = 'none';
  $('bulk-results-content').innerHTML = '';
  _lastBulkResults = {};
  _bulkViewMode = 'result';
  $('btn-view-result').classList.add('active');
  $('btn-view-diff').classList.remove('active');
  $('modal-bulk-cmd').classList.add('visible');
  $('bulk-cmd-input').focus();
});

$('btn-bulk-cancel').addEventListener('click', () => $('modal-bulk-cmd').classList.remove('visible'));
$('bulk-cmd-input').addEventListener('keydown', e => { if (e.key === 'Enter') execBulkCmd(); });
$('btn-bulk-exec').addEventListener('click', execBulkCmd);

async function execBulkCmd() {
  const cmd = $('bulk-cmd-input').value.trim();
  if (!cmd) { $('bulk-cmd-input').focus(); return; }
  const checked = [...$('bulk-node-list').querySelectorAll('input[type=checkbox]:checked')];
  const names = checked.map(c => c.value);
  if (names.length === 0) { log('ノードを選択してください', 'warn'); return; }

  const btn = $('btn-bulk-exec');
  btn.disabled = true;
  btn.textContent = '実行中...';
  log(`コマンド一括投入: "${cmd}" → ${names.join(', ')}`, 'info');

  try {
    const res = await api('POST', '/api/nodes/command', { node_names: names, command: cmd });
    _lastBulkResults = res.results;
    renderBulkResults(_lastBulkResults, _bulkViewMode);
    $('bulk-results').style.display = '';
    log(`コマンド一括投入完了 (${names.length} ノード)`, 'ok');
  } catch (e) {
    log(`一括投入エラー: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '実行';
  }
}

function renderBulkResults(results, mode) {
  const content = $('bulk-results-content');
  content.innerHTML = '';
  const names = Object.keys(results);
  if (names.length === 0) return;
  if (mode === 'diff') {
    renderBulkDiff(content, results, names);
  } else {
    renderBulkNormal(content, results, names);
  }
}

function renderBulkNormal(container, results, names) {
  const row = document.createElement('div');
  row.className = 'bulk-result-row';
  for (const name of names) {
    const r = results[name];
    const text = r.output !== undefined ? r.output : (r.error || '');
    const col = document.createElement('div');
    col.className = 'bulk-result-col';
    const header = document.createElement('div');
    header.className = 'bulk-col-header' + (r.error ? ' error' : '');
    header.textContent = name;
    const pre = document.createElement('pre');
    pre.className = 'bulk-col-pre';
    pre.textContent = text;
    col.appendChild(header);
    col.appendChild(pre);
    row.appendChild(col);
  }
  container.appendChild(row);
}

// LCS テーブル構築（行数×行数が大きすぎる場合は null を返す）
function _lcsTable(a, b) {
  const m = a.length, n = b.length;
  if (m * n > 200000) return null;
  const dp = Array.from({length: m + 1}, () => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  return dp;
}

// LCS バックトラックで「共通行」のインデックスを特定し、
// 各行が "異なる(true) / 同じ(false)" の配列を返す
function _diffStatus(aLines, bLines) {
  const m = aLines.length, n = bLines.length;
  const dp = _lcsTable(aLines, bLines);

  if (!dp) {
    // フォールバック: セットベース
    const bSet = new Set(bLines), aSet = new Set(aLines);
    return {
      aStatus: aLines.map(l => !bSet.has(l)),
      bStatus: bLines.map(l => !aSet.has(l)),
    };
  }

  const aStatus = new Array(m).fill(true);
  const bStatus = new Array(n).fill(true);
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (aLines[i-1] === bLines[j-1]) {
      aStatus[i-1] = false;
      bStatus[j-1] = false;
      i--; j--;
    } else if (dp[i][j-1] >= dp[i-1][j]) {
      j--;
    } else {
      i--;
    }
  }
  return {aStatus, bStatus};
}

function renderBulkDiff(container, results, names) {
  if (names.length < 2) { renderBulkNormal(container, results, names); return; }

  const outputs = names.map(n => {
    const r = results[n];
    return (r.output !== undefined ? r.output : (r.error || '')).split('\n');
  });

  // panel[0] を基準に各パネルと diff を取る
  const diffs = outputs.map((lines, i) => i === 0 ? null : _diffStatus(outputs[0], lines));

  // panel[0] のハイライト: いずれかの比較で "削除" とみなされた行
  const baseHighlight = new Array(outputs[0].length).fill(false);
  for (let i = 1; i < names.length; i++) {
    diffs[i].aStatus.forEach((v, j) => { if (v) baseHighlight[j] = true; });
  }

  const row = document.createElement('div');
  row.className = 'bulk-result-row';
  const pres = [];

  for (let i = 0; i < names.length; i++) {
    const r = results[names[i]];
    const col = document.createElement('div');
    col.className = 'bulk-result-col';

    const header = document.createElement('div');
    header.className = 'bulk-col-header' + (r.error ? ' error' : '');
    header.textContent = names[i];
    col.appendChild(header);

    const pre = document.createElement('pre');
    pre.className = 'bulk-col-pre';

    const lines = outputs[i];
    const highlights = i === 0 ? baseHighlight : diffs[i].bStatus;

    for (let j = 0; j < lines.length; j++) {
      const span = document.createElement('span');
      span.className = 'diff-line';
      if (highlights[j]) span.classList.add('diff-unique');
      span.textContent = lines[j] + '\n';
      pre.appendChild(span);
    }

    col.appendChild(pre);
    row.appendChild(col);
    pres.push(pre);
  }

  // 同期スクロール
  let _syncing = false;
  pres.forEach(pre => {
    pre.addEventListener('scroll', () => {
      if (_syncing) return;
      _syncing = true;
      pres.forEach(p => { if (p !== pre) p.scrollTop = pre.scrollTop; });
      _syncing = false;
    });
  });

  container.appendChild(row);
}

$('btn-view-result').addEventListener('click', () => {
  if (_bulkViewMode === 'result') return;
  _bulkViewMode = 'result';
  $('btn-view-result').classList.add('active');
  $('btn-view-diff').classList.remove('active');
  renderBulkResults(_lastBulkResults, 'result');
});

$('btn-view-diff').addEventListener('click', () => {
  if (_bulkViewMode === 'diff') return;
  _bulkViewMode = 'diff';
  $('btn-view-diff').classList.add('active');
  $('btn-view-result').classList.remove('active');
  renderBulkResults(_lastBulkResults, 'diff');
});

// ── ping 疎通確認 ──────────────────────────────────────────────────────────
function showPingModal(defaultSrcNode) {
  if (!state.deployed) { log('デプロイ後に使用できます', 'warn'); return; }
  const select = $('ping-src-select');
  select.innerHTML = '';
  for (const name of Object.keys(state.deployedNodes)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (name === defaultSrcNode) opt.selected = true;
    select.appendChild(opt);
  }
  $('ping-target-ip').value = '';
  $('ping-count').value = '5';
  $('ping-result').style.display = 'none';
  $('ping-output').textContent = '';
  $('modal-ping').classList.add('visible');
  $('ping-target-ip').focus();
}

$('btn-open-ping').addEventListener('click', () => showPingModal(null));
$('btn-ping-cancel').addEventListener('click', () => $('modal-ping').classList.remove('visible'));
$('ping-target-ip').addEventListener('keydown', e => { if (e.key === 'Enter') execPing(); });
$('btn-ping-exec').addEventListener('click', execPing);

async function execPing() {
  const src    = $('ping-src-select').value;
  const target = $('ping-target-ip').value.trim();
  const count  = parseInt($('ping-count').value, 10) || 5;
  if (!target) { $('ping-target-ip').focus(); return; }

  const btn = $('btn-ping-exec');
  btn.disabled = true;
  btn.textContent = '実行中...';
  $('ping-result').style.display = 'none';

  try {
    const res = await api('POST', '/api/ping', { source_node: src, target_ip: target, count });
    $('ping-cmd-label').textContent = `> ${res.command}`;
    $('ping-output').textContent = res.output;
    $('ping-result').style.display = '';
    log(`ping: ${src} → ${target}`, 'ok');
  } catch (e) {
    log(`pingエラー: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '実行';
  }
}

// ── 設定バックアップ ───────────────────────────────────────────────────────
async function downloadBackup(nodeName) {
  try {
    log(`設定バックアップ取得中: ${nodeName}`, 'info');
    const res = await fetch(`/api/node/${encodeURIComponent(nodeName)}/backup`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${nodeName}-running-config.txt`;
    a.click();
    log(`設定バックアップ完了: ${nodeName}`, 'ok');
  } catch (e) {
    log(`バックアップエラー: ${e.message}`, 'error');
  }
}

// ── テンプレート ───────────────────────────────────────────────────────────
async function loadTemplates() {
  try {
    const data = await api('GET', '/api/templates');
    state.templates = data.templates;
  } catch (e) {
    log(`テンプレート取得エラー: ${e.message}`, 'error');
  }
}

async function loadTemplate(templateId, templateName) {
  if (!confirm(`現在のトポロジーを上書きして「${templateName}」を読み込みますか？`)) return;
  try {
    const topo = await api('POST', `/api/templates/${templateId}/load`);
    applyTopology(topo);
    state.pendingConfigPush = true;
    log(`テンプレート「${templateName}」を読み込みました (ノード: ${topo.nodes.length}, リンク: ${topo.links.length})`, 'ok');
    log('コンフィグ付きテンプレートです — デプロイ後に SSH で自動投入されます', 'ok');
  } catch (e) {
    log(`テンプレートロードエラー: ${e.message}`, 'error');
  }
}

// ── テンプレートブラウザモーダル ───────────────────────────────────────────
let _tplNetwork = null;
let _currentTpl = null;

function openTemplateModal() {
  showTplListView();
  $('modal-templates').classList.add('visible');
}

function closeTplModal() {
  destroyTplNetwork();
  $('modal-templates').classList.remove('visible');
}

function showTplListView() {
  destroyTplNetwork();
  $('tpl-list-view').style.display = '';
  $('tpl-detail-view').style.display = 'none';
  const grid = $('tpl-card-grid');
  grid.innerHTML = '';
  for (const t of state.templates) {
    const card = document.createElement('div');
    card.className = 'tpl-card';
    card.innerHTML = `
      <div class="tpl-card-name">${t.name}</div>
      <div class="tpl-card-desc">${t.description}</div>
      <div class="tpl-card-meta">${t.node_count} ノード / ${t.link_count} リンク</div>`;
    card.addEventListener('click', () => showTplDetailView(t));
    grid.appendChild(card);
  }
}

function showTplDetailView(tpl) {
  _currentTpl = tpl;
  $('tpl-list-view').style.display = 'none';
  $('tpl-detail-view').style.display = '';
  $('tpl-detail-name').textContent = tpl.name;
  $('tpl-detail-desc').textContent = tpl.description;

  const vl = $('tpl-verify-list');
  vl.innerHTML = '';
  for (const v of (tpl.verification || [])) {
    const li = document.createElement('li');
    li.textContent = v;
    vl.appendChild(li);
  }

  const cb = $('tpl-cmd-blocks');
  cb.innerHTML = '';
  for (const [node, cmds] of Object.entries(tpl.test_commands || {})) {
    const block = document.createElement('div');
    block.className = 'tpl-cmd-block';
    block.innerHTML = `<div class="tpl-cmd-node">${node}</div><pre class="tpl-cmd-pre">${escapeHtml(cmds.join('\n'))}</pre>`;
    cb.appendChild(block);
  }

  renderTplMiniTopo(tpl);
}

function renderTplMiniTopo(tpl) {
  destroyTplNetwork();
  const container = $('tpl-topo-canvas');
  const nodes = new vis.DataSet((tpl.nodes || []).map(n => ({
    id: n.name,
    label: n.name,
    shape: 'box',
    color: {
      background: '#4f8ef733',
      border: '#4f8ef7',
      highlight: { background: '#4f8ef755', border: '#4f8ef7' },
      hover:      { background: '#4f8ef744', border: '#4f8ef7' },
    },
    font: { color: '#d4d8e2', size: 12, face: 'Consolas, monospace' },
    margin: { top: 6, right: 10, bottom: 6, left: 10 },
    borderWidth: 2,
  })));
  const edges = new vis.DataSet((tpl.links || []).map(l => ({
    from: l.source,
    to: l.target,
    width: 2,
    color: { color: '#4a5060' },
    smooth: { enabled: true, type: 'curvedCW', roundness: 0.15 },
  })));
  _tplNetwork = new vis.Network(container, { nodes, edges }, {
    interaction: { dragNodes: false, dragView: false, zoomView: false, selectable: false, hover: false },
    physics: {
      enabled: true,
      solver: 'forceAtlas2Based',
      forceAtlas2Based: { gravitationalConstant: -60, springLength: 90 },
      stabilization: { iterations: 150 },
    },
    manipulation: { enabled: false },
  });
}

function destroyTplNetwork() {
  if (_tplNetwork) { _tplNetwork.destroy(); _tplNetwork = null; }
}

$('btn-templates').addEventListener('click', openTemplateModal);
$('btn-tpl-close').addEventListener('click', closeTplModal);
$('btn-tpl-back').addEventListener('click', showTplListView);
$('btn-tpl-detail-close').addEventListener('click', closeTplModal);
$('btn-tpl-load').addEventListener('click', () => {
  if (_currentTpl) { closeTplModal(); loadTemplate(_currentTpl.id, _currentTpl.name); }
});
$('modal-templates').addEventListener('click', e => {
  if (e.target === $('modal-templates')) closeTplModal();
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
