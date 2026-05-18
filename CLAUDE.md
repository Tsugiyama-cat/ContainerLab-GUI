# ContainerLab GUI — プロジェクト概要

> **Claude へ:** セッション開始時にこのファイルを読み、内容が現在のコードと乖離していないか確認すること。
> 解決済みの問題・古くなった注意事項は**その場で削除**し、新たに判明した重要事項は追記すること。
> ファイルは常に「今まさに役立つ情報だけ」に保つ。最終確認日を更新すること。
>
> **最終確認日: 2026-05-15（テンプレート検証完了: BGP L3 / EVPN-VXLAN 動作確認済み）**

---

## 構成

```
backend/
  main.py          # FastAPI。エンドポイント・SSH設定取得・パース関数
  lab_manager.py   # LabManager。ノード/リンク管理・デプロイ・Docker API
frontend/
  index.html       # メイン画面（キャッシュバスト: ?v=5）
  app.js           # 全フロントエンドロジック
  style.css        # スタイル
docker-compose.yml / Dockerfile
```

起動ポート: **8888**

---

## 重要な制約・既知の挙動

- **`clab destroy` はコンテナ内から動作しない**（`clab inspect` は動く）
  → `lab_manager.py` の `_force_cleanup_lab()` で Docker Unix socket API を直叩きして削除
- **ブラウザキャッシュ対策**: `index.html` の `<script>` / `<link>` タグに `?v=N` を付与
  → JS/CSS 変更時は N をインクリメントすること（現在 v=10）
- **デプロイ後にリンク追加した場合は再デプロイが必要**（警告ログ表示済み）
- **aruba_aoscx の 1/1/1 は vrnetlab 管理ポート**: データリンクは 1/1/2 以降を使用（iface_start=2）
  → startup-config に VLAN・interface 設定を書けば 1/1/2 以降は正常に適用される
  → 1/1/1 は `vlan access` 割り当て不可

---

## ノードタイプ

`lab_manager.py` の `NODE_TYPES` に定義。現在対応:
- `aruba_aoscx`: iface_fmt=`1/1/{n}`, **iface_start=2**, image=`vrnetlab/aruba_arubaos-cx:10.16.1006-fixed`
  - OVA/VMDK: `/home/vlab/containerlab-gui/SWOS/aoscx/`
  - イメージ再ビルド: `cd /home/vlab/containerlab-gui/SWOS/aoscx && make docker-image`
- `juniper_vjunosswitch`: iface_fmt=`ge-0/0/{n}`, iface_start=0

---

## 実装済み機能（v1.1）

- ノード追加/削除/編集（名前重複チェック付き）
- リンク追加（ポート選択モーダル）/削除
- YAML 生成・プレビュー
- デプロイ / 破棄
- startup-config: `startup_configs` に設定があればそれを使用、なければ接続 IF の `no shutdown` のみ
- デプロイ完了ポーリング（全ノード mgmt_ip 取得まで）
- 右詳細パネル: ノード情報・デプロイ情報・リンク一覧・設定情報（↺更新）
- 設定情報: VLAN一覧・IPアドレス（VLAN IFも含む）・IF一覧
- インライン CLI タブ（xterm.js / WebSocket SSH）
- デプロイ済み機器一覧（サイドバー）
- **トポロジー保存/読み込み**: JSON export (`GET /api/topology/export`) / import (`POST /api/topology/import`)
  - デプロイ済みの場合は各ノードの running-config も並列 SSH で取得して JSON に収録
  - インポート時に configs が含まれていれば `startup_configs` に保持、次の deploy 時に clab startup-config として自動適用
  - `LabManager.startup_configs` (dict[node_name, str]) — deploy 後も保持（再 deploy でも有効）
- **コマンド一括投入**: 複数ノードへ並列 SSH で同一コマンド実行 (`POST /api/nodes/command`)
- **ping 疎通確認**: ノード間 ping、機器種別で ping コマンド構文を自動切替 (`POST /api/ping`)
- **設定バックアップ**: running-config をファイルダウンロード (`GET /api/node/{name}/backup`)

---

## AOS-CX VXLAN/EVPN 構文メモ（動作確認済み）

- `interface vxlan 1` → `source ip <vtep-ip>` （`source-ip` はNG、スペース区切り）
- VNI-VLAN マッピング: `interface vxlan 1` → `vni 10010` コンテキスト内に `vlan 10`
- EVPN 設定: `evpn` → `vlan 10` → `rd auto` / `route-target export/import <value>`
- **route-target auto は ASN ベース生成のため leaf 間で不一致になる** → 必ず明示的な値を使うこと
  - 例: `route-target export 10010:10010` / `route-target import 10010:10010`
- SVI (`interface vlan 10`) は startup-config からも SSH push でも設定可能
- 検証コマンド: `show evpn evi`（Peer VTEPs が 1 以上なら制御プレーン OK）、`show bgp l2vpn evpn`
