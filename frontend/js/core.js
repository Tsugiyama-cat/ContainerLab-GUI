'use strict';

// このファイルは他の js/*.js より先に読み込む。
// 共有状態 (state, _nodeData, _edgeData, vis.DataSet, network) と
// 共通ユーティリティ ($, api, log, escapeHtml) を全てここで宣言する。

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

// ── HTML エスケープ ────────────────────────────────────────────────────────
// innerHTML 内に展開するユーザー入力・機器応答は必ずこの関数を通すこと。
// 属性値内 (例: <div title="${...}">) でも壊れないよう " と ' もエスケープする。
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── 入力フォーカス判定 (Delete/Backspace ハンドラ用) ──────────────────────
function isInputFocused() {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

// ── ヒント表示更新 ────────────────────────────────────────────────────────
function updateHint() {
  elHint.style.opacity = visNodes.length === 0 ? '1' : '0';
}
