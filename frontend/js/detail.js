'use strict';

// 右詳細パネル (ノード/エッジ詳細、設定情報パネル) と
// 左サイドバーのデプロイ済み機器一覧。
// core.js / topology.js / cli.js / actions.js (loadNodeConfig は detail 内、
// openCLITab/showPingModal/downloadBackup は cli.js / actions.js) を呼ぶ。

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
    dc.innerHTML = `<p class="dim-text" style="color:var(--danger)">表示エラー: ${escapeHtml(e.message)}</p>`;
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
      <div class="info-row"><span class="info-label">接続元</span><span class="info-value">${escapeHtml(srcNd ? srcNd.name : '-')}</span></div>
      <div class="info-row"><span class="info-label">IF</span><span class="info-value">${escapeHtml(lk.source_iface || '-')}</span></div>
    </div>
    <div class="detail-divider"></div>
    <div class="detail-section">
      <div class="info-row"><span class="info-label">接続先</span><span class="info-value">${escapeHtml(tgtNd ? tgtNd.name : '-')}</span></div>
      <div class="info-row"><span class="info-label">IF</span><span class="info-value">${escapeHtml(lk.target_iface || '-')}</span></div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-danger btn-sm" data-action="delete-edge" data-edge-id="${escapeHtml(id)}">削除</button>
    </div>`;
  dc.querySelector('[data-action="delete-edge"]')?.addEventListener('click', () => deleteEdge(id));
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
      linksHtml += `<div class="link-row" data-action="select-edge" data-edge-id="${escapeHtml(eid)}">${escapeHtml(myIface)} &harr; ${escapeHtml(otherName)}:${escapeHtml(otherIface)}</div>`;
    }
  } catch (_) {}

  const configSectionId = `cfg-${id}`;
  const hasIp = dep && dep.mgmt_ip;

  dc.innerHTML = `
    <div class="detail-section">
      <div class="detail-section-title">ノード</div>
      <div class="info-row"><span class="info-label">名前</span><span class="info-value">${escapeHtml(nd.name || '-')}</span></div>
      <div class="info-row"><span class="info-label">種別</span><span class="info-value">${escapeHtml(nd.kind || '-')}</span></div>
      <div class="info-row"><span class="info-label">イメージ</span><span class="info-value" title="${escapeHtml(nd.image || '')}">${escapeHtml(imgShort || '-')}</span></div>
      <div class="info-row"><span class="info-label">SSH ユーザ</span><span class="info-value">${escapeHtml(nd.ssh_user || '-')}</span></div>
    </div>
    ${dep ? `<div class="detail-divider"></div>
    <div class="detail-section">
      <div class="detail-section-title">デプロイ情報</div>
      <div class="info-row"><span class="info-label">状態</span><span class="info-value ${stateClass}">${escapeHtml(stateStr || '-')}</span></div>
      <div class="info-row"><span class="info-label">管理IP</span><span class="info-value">${escapeHtml(dep.mgmt_ip || '待機中...')}</span></div>
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
        <button class="btn btn-ghost btn-sm" data-action="reload-config">↺ 更新</button>
      </div>
      <div id="${escapeHtml(configSectionId)}"><span class="dim-text">読み込み中...</span></div>
    </div>` : ''}
    <div class="detail-divider"></div>
    <div class="detail-actions">
      ${state.deployed ? `<button class="btn btn-success btn-sm" data-action="cli">CLI</button>` : ''}
      ${hasIp ? `<button class="btn btn-ghost btn-sm" data-action="ping">ping</button>` : ''}
      ${hasIp ? `<button class="btn btn-ghost btn-sm" data-action="backup">設定保存</button>` : ''}
      <button class="btn btn-ghost btn-sm" data-action="edit">編集</button>
      <button class="btn btn-danger btn-sm" data-action="delete-node">削除</button>
    </div>`;

  // インライン onclick は XSS リスクがあるため避け、ノード ID をクロージャに閉じ込めて
  // dataset 経由でアクションを区別する。
  dc.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const cur = _nodeData.get(id);
      if (!cur) return;
      switch (action) {
        case 'select-edge': { const eid = btn.dataset.edgeId; if (eid) selectEdge(eid); break; }
        case 'reload-config': loadNodeConfig(cur.name, configSectionId); break;
        case 'cli':          openCLITab(cur.name, cur.ssh_port); break;
        case 'ping':         showPingModal(cur.name); break;
        case 'backup':       downloadBackup(cur.name); break;
        case 'edit':         showEditModal(id); break;
        case 'delete-node':  deleteNode(id); break;
      }
    });
  });

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
    el.innerHTML = `<span class="dim-text" style="color:var(--danger)">取得失敗: ${escapeHtml(e.message)}</span>`;
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
      html += `<tr><td>${escapeHtml(v.id)}</td><td>${escapeHtml(v.name)}</td><td class="${v.status === 'up' ? 'ok' : 'warn'}">${escapeHtml(v.status)}</td></tr>`;
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
      html += `<tr><td>${escapeHtml(i.interface)}</td><td>${escapeHtml(i.ip)}</td><td>${escapeHtml(i.status)}</td></tr>`;
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
      html += `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.mode)}</td><td>${escapeHtml(vlanCol ?? '-')}</td><td class="${i.shutdown ? 'warn' : 'ok'}">${i.shutdown ? 'down' : 'up'}</td></tr>`;
    }
    html += '</table>';
  }

  if (!html) html = '<span class="dim-text">設定情報なし</span>';
  return html;
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
  const itemByName = new Map();
  for (const name of names) {
    const dep  = state.deployedNodes[name];
    const dotClass = dep.state === 'running' ? 'running' : dep.state === 'exited' ? 'error' : 'starting';
    const item = document.createElement('div');
    item.className = 'deployed-item';
    item.dataset.name = name;
    item.innerHTML = `
      <div class="deployed-dot ${dotClass}"></div>
      <div>
        <div class="deployed-name">${escapeHtml(name)}</div>
        <div class="deployed-ip">${escapeHtml(dep.mgmt_ip || '起動待機中...')}</div>
      </div>`;
    item.addEventListener('click', () => selectDeployedNode(name));
    list.appendChild(item);
    itemByName.set(name, item);
  }
  if (state.selectedNodeId) {
    const nd = _nodeData.get(state.selectedNodeId);
    // querySelector の属性セレクタはノード名次第で構文が壊れるため、Map で直接ルックアップする。
    if (nd) itemByName.get(nd.name)?.classList.add('active');
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
