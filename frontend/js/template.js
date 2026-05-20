'use strict';

// テンプレートブラウザモーダル (一覧 + 詳細 + プレビュー描画 + ロード)。
// core.js (state, $, api, log, escapeHtml) と topology.js (applyTopology) に依存。

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
      <div class="tpl-card-name">${escapeHtml(t.name)}</div>
      <div class="tpl-card-desc">${escapeHtml(t.description)}</div>
      <div class="tpl-card-meta">${escapeHtml(t.node_count)} ノード / ${escapeHtml(t.link_count)} リンク</div>`;
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
    block.innerHTML = `<div class="tpl-cmd-node">${escapeHtml(node)}</div><pre class="tpl-cmd-pre">${escapeHtml(cmds.join('\n'))}</pre>`;
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
