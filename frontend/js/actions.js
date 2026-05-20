'use strict';

// コマンド一括投入、ping 疎通確認、設定バックアップダウンロード。
// core.js (state, $, api, log, escapeHtml) に依存。

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
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = name;
    cb.checked = true;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + name));
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
