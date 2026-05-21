# ContainerLab GUI

ブラウザ上でネットワークトポロジーを構築・デプロイできる Web アプリです。  
[ContainerLab](https://containerlab.dev/) をバックエンドとして使用します。

---

## 対応ノードタイプ

| ノード | イメージ |
|---|---|
| Aruba AOS-CX | `clabgui/aruba_arubaos-cx:10.16.1006` |

> **Juniper vJunos-Switch について**  
> ネスト仮想化の制約により VM 環境では動作しません。  
> ベアメタル Linux / Intel Mac 環境向けに [`feature/vjunos`](https://github.com/Tsugiyama-cat/ContainerLab-GUI/tree/feature/vjunos) ブランチで提供しています。

---

## セットアップ

```bash
git clone https://github.com/Tsugiyama-cat/ContainerLab-GUI.git
cd ContainerLab-GUI
cp .env.example .env
# .env を編集して認証情報を設定
docker compose up -d
```

起動後、ブラウザで `http://localhost:8888` にアクセスしてください。

---

## 使い方

### クイックスタート（テンプレートから始める）

最初は組み込みテンプレートのロードが手軽です。

1. サイドバーの **「テンプレートを選択...」** をクリック
2. 一覧から目的の構成（例: 「疎通確認」）をクリック → 右側に検証ポイントとテストコマンドが表示 → **「ロード」**
3. ヘッダーの **「Deploy」** を押す（VM 起動まで数分かかります）
4. ステータスバッジが **「デプロイ済み」** に変わったら、ノードをダブルクリックで CLI が開きます

組み込みテンプレート:

| ID | 内容 |
|---|---|
| 疎通確認 | sw1/sw2 が VLAN100 で相互 ping |
| Edge-Core 構成 | core が VLAN 間ルーティング、edge1↔edge2 |
| BGP L3 ルーティング | eBGP 3 台、loopback 間 ping |
| VSX ペア | 2 台 VSX (ISL + Keepalive) |
| VSX Spine-Leaf (MCLAG) | 4 台、VSX In-Sync 後に MCLAG ワークアラウンドを自動投入 |
| EVPN-VXLAN | Spine-Leaf 3 台、VLAN10 を VNI 10010 で延伸 |

ロード後にデプロイすると、テンプレートの startup-config が SSH 経由で自動投入されます（VM 起動完了まで最大 10 回リトライ）。

### ノードとリンクの操作

- **ノードを追加**: 左パレットのノードカードをクリック → キャンバスをクリック → モーダルで名前（空欄なら自動命名）とイメージを指定して「追加」
- **リンクを作成**: サイドバー「**↔ 接続モード**」をクリック → 接続元 → 接続先の順にクリック → ポート番号モーダルで「接続」
  - AOS-CX のデータリンクは **1/1/2 以降**を使用（1/1/1 は vrnetlab 管理用で割り当て不可）
- **ノード/リンクの削除**: 選択 → 右パネル「削除」、または **Delete / Backspace** キー、または右クリックメニュー
- **ノードを編集**: 右パネル「編集」または右クリック「ノード編集」で名前・イメージを変更
- **YAML を確認**: ヘッダー「YAML 確認」で containerlab に渡される YAML をプレビュー

> ⚠ デプロイ後にノードやリンクを追加・変更しても、Destroy → Deploy しないとラボに反映されません。

### CLI（ターミナル）

- **単体 CLI**: ノードをダブルクリック、または右パネル「CLI」で xterm.js のタブが画面下に開きます
- **一括入力（ブロードキャスト CLI）**: ヘッダー右の「**一括入力**」→ 対象ノードを選択 → 「開始」で複数 CLI を横並びポップアップ表示。入力は全端末に同時送信されます
  - **Shift + Esc** で同期 ON / 個別入力をトグル（モーダルは閉じません）
  - 閉じるボタンで終了

### コマンド一括投入

- サイドバー「**▶ コマンド投入**」→ ノードと show / 設定コマンドを指定 → 「実行」
- 結果は **各ノード 1 カラム**で横並び表示
- **「Diff」モード**に切り替えると、最初のノードを基準にした行差分がハイライトされ、全パネルがスクロール同期します

### ping 疎通確認

- 右パネル「ping」または、サイドバー「**◇ ping 確認**」
- 送信元ノード・宛先 IP・回数を指定して「実行」
- 機器種別（AOS-CX / Junos）で `ping ... repetitions N` / `ping ... count N` の構文を自動切替

### 設定情報パネル / バックアップ

- ノードを選択すると、右パネルに VLAN 一覧 / IP インターフェース / 物理 IF の一覧が表示されます（「↺ 更新」で再取得）
- 「**設定保存**」で running-config をテキストファイルとしてダウンロードできます

### トポロジー保存 / 読み込み

- ヘッダー **「💾 保存」**: 現在のトポロジー（+ デプロイ済みなら各ノードの running-config）を JSON でダウンロード
- ヘッダー **「📁 読込」**: 保存した JSON を選択 → 現状を上書きして読み込み。configs を含む JSON ならデプロイ後に SSH で自動投入されます

### キーボードショートカット

| キー | 動作 |
|---|---|
| `Esc` | 開いているモーダル / モードを閉じる |
| `Delete` / `Backspace` | 選択中のノードまたはリンクを削除（入力欄フォーカス中は無効） |
| `Enter`（入力欄内） | モーダルの内容を確定 |
| `Shift + Esc`（一括入力中） | 全端末同期 ON / 個別入力をトグル |

### トラブルシューティング

- **デプロイ失敗 (`Node name contains invalid characters`)**: ノード名に `<`, `>`, スペースなどの記号が含まれていないか確認
- **VM が起動しない**: ホストの CPU / メモリ不足の可能性。`docker stats` で確認し、起動するノード数を減らす
- **CLI が `Connection refused`**: VM 起動待機中です。ステータスバッジが「デプロイ済み」になるまで待ってください
- **設定情報が空 / 取得失敗**: 起動直後は SSH 接続が成立しないことがあるため、右パネルの「↺ 更新」を数回試してください
- **再デプロイ後にも startup-config が反映されない**: `clab` が古い `clab-clabgui/` ディレクトリの設定を再利用していた問題は修正済みですが、念のため `docker compose restart clabgui` でバックエンドをリセットしてから Deploy し直してください

---

## VM イメージの準備（vrnetlab ビルド用）

OVA / VMDK / OVF などのベンダーイメージはライセンスの関係上このリポジトリには含まれていません。  
各ダウンロードサイトから取得して、下記のパスに配置してください。

### Aruba AOS-CX

1. [Aruba Support Portal](https://asp.arubanetworks.com/) からOVAをダウンロード
2. `SWOS/aoscx/` に配置
3. Dockerイメージをビルド:

```bash
cd SWOS/aoscx/docker
make
# → clabgui/aruba_arubaos-cx:<バージョン> としてビルドされます
```

> **注意:** これらのイメージファイル（`.ova` / `.vmdk` / `.ovf` / `.qcow2`）は `.gitignore` により Git 管理対象外です。ローカルにのみ保存してください。

---

## ファイル構成

```
ContainerLab-GUI/
├── compose.yml              # Docker Compose 定義（GUI コンテナ）
├── Dockerfile               # GUI アプリ本体のイメージ
├── Dockerfile.aoscx         # AOS-CX ビルド用（補助）
├── Makefile                 # ショートカット（make up / down 等）
├── .env.example             # 環境変数テンプレート → .env にコピーして使用
├── .gitignore
│
├── backend/                 # FastAPI バックエンド
│   ├── main.py              # API エンドポイント + SSH ヘルパー集約
│   ├── lab_manager.py       # ノード・リンク管理 / デプロイ / Docker API
│   ├── templates.py         # テンプレートトポロジー定義
│   └── requirements.txt
│
├── frontend/                # Web フロントエンド（バニラ JS）
│   ├── index.html           # メイン画面
│   ├── style.css
│   ├── terminal.html        # 単体ターミナルページ
│   └── js/                  # 機能別に分割した JS（順序を index.html で明示）
│       ├── core.js          # state / vis.js init / api / log / escapeHtml
│       ├── topology.js      # パレット / モード / リンク / 削除・編集 / YAML
│       ├── detail.js        # 右詳細パネル / 設定情報 / デプロイ済み一覧
│       ├── cli.js           # CLI タブ (xterm + WebSocket) / 一括入力
│       ├── actions.js       # 一括コマンド (Diff) / ping / 設定バックアップ
│       ├── template.js      # テンプレートブラウザ
│       ├── deploy.js        # デプロイ・破棄 / ポーリング / 保存・読込
│       └── main.js          # コンテキストメニュー / キーボード / init()
│
└── SWOS/                    # Switch OS ビルド環境
    ├── aoscx/               # Aruba AOS-CX（main ブランチ）
    │   ├── *.ova / *.vmdk / *.ovf   # ← gitignore（要手動配置）
    │   └── docker/          # vrnetlab ベース Dockerfile / Makefile
    │
    └── Jnos/                # Juniper vJunos-Switch（feature/vjunos ブランチのみ）
        ├── *.qcow2          # ← gitignore（要手動配置）
        └── docker/          # vrnetlab ベース Dockerfile / Makefile
```

> `SWOS/` 配下の OS イメージ（`.ova` / `.vmdk` / `.ovf` / `.qcow2`）はライセンス上 Git 管理対象外です。  
> 各ベンダーのサポートポータルから取得してローカルに配置してください。

---

## 環境変数

`.env.example` をコピーして `.env` を作成してください。

| 変数名 | 説明 | デフォルト値 |
|---|---|---|
| `AOSCX_SSH_USER` | AOS-CX SSH ユーザー名 | `admin` |
| `AOSCX_SSH_PASS` | AOS-CX SSH パスワード | `admin` |
| `VJUNOS_SSH_USER` | vJunos SSH ユーザー名 | `admin` |
| `VJUNOS_SSH_PASS` | vJunos SSH パスワード | `admin@123` |
