'use strict';

// インライン CLI タブ (xterm.js + WebSocket SSH) と
// 一括入力ポップアップモード (複数ノードへの同期入力)。
// core.js に依存。

let _tabCounter    = 0;
let _activeTab     = 'log';
const _cliSessions = {};
let _broadcastMode         = false;
let _broadcastSyncOn       = true;  // true=全台同期, false=個別入力
let _broadcastPopupSessions = []; // { term, fitAddon, ws, nodeName }

function openCLITab(nodeName, sshPort) {
  const port  = sshPort || 22;
  const tabId = `cli-${_tabCounter++}`;

  const tabBtn = document.createElement('div');
  tabBtn.className = 'bottom-tab';
  tabBtn.id = `tab-btn-${tabId}`;
  tabBtn.dataset.tab = tabId;
  tabBtn.innerHTML = `CLI: ${escapeHtml(nodeName)} <span class="tab-close" data-tabid="${escapeHtml(tabId)}">&#10005;</span>`;
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
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
  });
  term.onResize(({ cols, rows }) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  });

  _cliSessions[tabId] = { term, fitAddon, ws, nodeName };
  switchTab(tabId);
  log(`CLI タブ起動: ${nodeName}`, 'ok');
}

function switchTab(tabId) {
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
  const session = _cliSessions[tabId];
  if (session) {
    session.ws.close();
    session.term.dispose();
    delete _cliSessions[tabId];
  }
  $(`tab-btn-${tabId}`)?.remove();
  $(`tab-pane-${tabId}`)?.remove();
  if (_activeTab === tabId) switchTab('log');
  _updateBroadcastBtn();
}

// ── 一括入力モード（ポップアップ + 独立 SSH 接続）────────────────────────
function _updateBroadcastBtn() {
  const btn        = $('btn-broadcast');
  const readyCount = Object.values(state.deployedNodes || {}).filter(d => d.mgmt_ip).length;
  btn.disabled     = readyCount < 2;
  btn.classList.toggle('broadcast-active', _broadcastMode);
  btn.textContent  = _broadcastMode
    ? `一括入力 ON (${_broadcastPopupSessions.length}台)`
    : '一括入力';
}

function _updateBroadcastSyncIndicator() {
  const badge = $('broadcast-sync-badge');
  if (!badge) return;
  if (_broadcastSyncOn) {
    badge.textContent = '● 同期中';
    badge.className = 'broadcast-sync-badge sync-on';
  } else {
    badge.textContent = '● 個別入力';
    badge.className = 'broadcast-sync-badge sync-off';
  }
}

function showBroadcastSelectModal() {
  const list = $('broadcast-node-list');
  list.innerHTML = '';
  const nodeNames = Object.entries(state.deployedNodes || {})
    .filter(([, d]) => d.mgmt_ip)
    .map(([name]) => name);
  for (const name of nodeNames) {
    const label = document.createElement('label');
    label.className = 'node-check-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = name;
    cb.checked = true;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + name));
    list.appendChild(label);
  }
  $('modal-broadcast-select').classList.add('visible');
}

function _makeBroadcastTerm() {
  return new Terminal({
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
}

function enterBroadcastMode(nodeNames) {
  _broadcastMode         = true;
  _broadcastSyncOn       = true;
  _broadcastPopupSessions = [];

  const container = $('broadcast-terminals');
  container.innerHTML = '';

  // SSH ポート取得とカラム DOM を先に構築
  const colDefs = nodeNames.map(nodeName => {
    let sshPort = 22;
    _nodeData.forEach(nd => { if (nd.name === nodeName) sshPort = nd.ssh_port || 22; });

    const col    = document.createElement('div');
    col.className = 'broadcast-term-col';
    const header = document.createElement('div');
    header.className = 'broadcast-term-header';
    header.textContent = nodeName;
    const inner  = document.createElement('div');
    inner.className = 'broadcast-term-inner';
    col.appendChild(header);
    col.appendChild(inner);
    container.appendChild(col);
    return { nodeName, sshPort, col, inner };
  });

  // モーダルを先に表示（xterm は visible 要素に対して open する必要がある）
  $('broadcast-modal-title').textContent = `一括入力 — ${nodeNames.length} 台: ${nodeNames.join(', ')}`;
  $('modal-broadcast-view').classList.add('visible');
  _updateBroadcastSyncIndicator();

  // レイアウトが確定してからターミナルを全台まとめて初期化
  setTimeout(() => {
    const rect = container.getBoundingClientRect();
    const colW  = Math.floor(rect.width  / colDefs.length);
    const colH  = Math.max(100, rect.height);

    for (const { nodeName, sshPort, col, inner } of colDefs) {
      // flex 計算に頼らず JavaScript でサイズを明示的に設定
      const headerH = (inner.previousElementSibling?.offsetHeight) || 22;
      inner.style.width    = colW + 'px';
      inner.style.height   = Math.max(60, colH - headerH) + 'px';
      inner.style.overflow = 'hidden';

      try {
        const term     = _makeBroadcastTerm();
        const fitAddon = new FitAddon.FitAddon();
        term.loadAddon(fitAddon);
        term.open(inner);

        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(
          `${wsProto}//${location.host}/ws/terminal/${encodeURIComponent(nodeName)}?port=${sshPort}`
        );
        ws.onopen    = () => { fitAddon.fit(); };
        ws.onclose   = () => term.write('\r\n\x1b[33m--- セッション終了 ---\x1b[0m\r\n');
        ws.onerror   = () => term.write('\r\n\x1b[31mWebSocket エラー\x1b[0m\r\n');
        ws.onmessage = ev => {
          try { const m = JSON.parse(ev.data); if (m.type === 'output') term.write(m.data); }
          catch { term.write(ev.data); }
        };

        term.onData(data => {
          if (_broadcastSyncOn) {
            // 全台同期: 全セッションに送信
            for (const s of _broadcastPopupSessions) {
              if (s.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify({ type: 'input', data }));
            }
          } else {
            // 個別入力: このターミナルのみ
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
          }
        });
        term.onResize(({ cols, rows }) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        });
        // Shift+ESC で同期 ON/OFF をトグル
        term.attachCustomKeyEventHandler(e => {
          if (e.key === 'Escape' && e.shiftKey && e.type === 'keydown') {
            _broadcastSyncOn = !_broadcastSyncOn;
            _updateBroadcastSyncIndicator();
            return false; // SSH には送らない
          }
          return true;
        });
        // term.onFocus は xterm v5.3.0 に存在しないため click イベントで代替
        inner.addEventListener('click', () => {
          container.querySelectorAll('.broadcast-term-col').forEach(c => c.classList.remove('focused'));
          col.classList.add('focused');
        });

        _broadcastPopupSessions.push({ term, fitAddon, ws, nodeName });
      } catch(e) {
        log(`[一括入力] ${nodeName} 初期化エラー: ${e.message}`, 'error');
      }
    }

    requestAnimationFrame(() => {
      for (const s of _broadcastPopupSessions) s.fitAddon.fit();
      // 最初のターミナルを自動フォーカス
      if (_broadcastPopupSessions.length > 0) {
        _broadcastPopupSessions[0].term.focus();
        container.querySelector('.broadcast-term-col')?.classList.add('focused');
      }
    });
  }, 100);

  _updateBroadcastBtn();
  log(`一括入力 ON — ${nodeNames.length} 台: ${nodeNames.join(', ')}`, 'warn');
}

function exitBroadcastMode() {
  if (!_broadcastMode) return;
  _broadcastMode = false;
  for (const s of _broadcastPopupSessions) {
    try { s.ws.close(); } catch (_) {}
    try { s.term.dispose(); } catch (_) {}
  }
  _broadcastPopupSessions = [];
  $('modal-broadcast-view').classList.remove('visible');
  _updateBroadcastBtn();
  log('一括入力 OFF', 'info');
}

$('btn-broadcast').addEventListener('click', () => {
  if (_broadcastMode) return; // ポップアップは閉じるボタンでのみ終了
  showBroadcastSelectModal();
});
$('btn-broadcast-close').addEventListener('click', exitBroadcastMode);

$('btn-broadcast-cancel').addEventListener('click', () => {
  $('modal-broadcast-select').classList.remove('visible');
});

$('btn-broadcast-confirm').addEventListener('click', () => {
  const checked   = [...$('broadcast-node-list').querySelectorAll('input[type=checkbox]:checked')];
  const nodeNames = checked.map(c => c.value);
  $('modal-broadcast-select').classList.remove('visible');
  if (nodeNames.length < 2) { log('2台以上選択してください', 'warn'); return; }
  enterBroadcastMode(nodeNames);
});

// ── ログ タブ切替 ──────────────────────────────────────────────────────────
$('tab-btn-log').addEventListener('click', () => switchTab('log'));
$('btn-clear-log').addEventListener('click', () => { elLogContent.innerHTML = ''; });
