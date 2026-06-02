# ContainerLab GUI

ブラウザ上でネットワークトポロジーを構築・デプロイできる Web アプリです。  
[ContainerLab](https://containerlab.dev/) をバックエンドとして使用します。

> 本プロジェクトは個人で開発しているものであり、特定の企業やベンダーの意図を反映するものではありません。

---

## 動作環境（必須要件）

AOS-CX などのノードは containerlab コンテナ内で **QEMU 仮想マシン**として起動します。  
そのため **CPU 仮想化支援（KVM）が使える Linux ホスト**が必須です。

| 項目 | 要件 |
|---|---|
| OS | Linux（ベアメタル推奨。例: Ubuntu 22.04 / 24.04） |
| CPU | x86_64 で Intel VT-x / AMD-V が有効。`/dev/kvm` が存在すること |
| vCPU | AOS-CX は **1 ノードあたり 4 vCPU**（`launch.py` が `smp="4"`）。例: 4 ノード構成なら 16 vCPU 以上を推奨 |
| メモリ | AOS-CX は **1 ノードあたり 8GB**。`ノード数 × 8GB` 以上を確保 |
| Docker | privileged コンテナ実行と `/dev/kvm` へのアクセスが可能なこと |

### 検証済みバージョン

| ソフトウェア | バージョン |
|---|---|
| AOS-CX | **10.16.1006**（Virtual） |
| containerlab | **0.74.3** |
| Docker | 24.x 以降 |
| Docker Compose | v2.24 以降（`env_file.required` を使用） |

### ✗ 動作しない環境

- **macOS（Docker Desktop） / Windows（Docker Desktop）**  
  Docker Desktop は内部の Linux VM 上で動作し、ネスト仮想化（KVM）をコンテナへ渡しません。  
  → GUI 表示やイメージビルドはできますが、ノード VM の起動時に  
  `CPU virtualization support is required for node ...` で**必ず失敗します**。  
  （Colima / Lima / Podman Desktop など他の方式も、Mac では結局 Linux VM 経由となり同じ結果です）

### ○ 動作する環境

| 環境 | 備考 |
|---|---|
| ベアメタル Linux（Ubuntu 等） | CPU 仮想化を BIOS/UEFI で有効化していること |
| ネスト仮想化を有効化した VM 上の Linux | 例: **VMware ESXi** — VM 設定で「**ハードウェア アシストによる仮想化をゲスト OS に公開**」(Expose hardware-assisted virtualization to the guest OS) を **ON** にすること（OFF だと `/dev/kvm` が無く必ず失敗）。Proxmox（ゲスト CPU = `host`）、GCP（`--enable-nested-virtualization`） |
| Windows + WSL2 + docker-ce | Docker Desktop ではなく、WSL2 のディストリ内に Docker Engine を直接導入。対応 CPU でネスト仮想化が有効なこと |

### KVM が使えるか確認

```bash
ls -l /dev/kvm                      # デバイスが存在すること
egrep -c '(vmx|svm)' /proc/cpuinfo  # 1 以上であること
```

---

## 対応ノードタイプ

| ノード | イメージ |
|---|---|
| Aruba AOS-CX | `clabgui/aruba_arubaos-cx:10.16.1006` |

> **アプリ側はビルド済みのローカルイメージを自動検出します**。`make` で `:10.16.1006` 以外の日付タグが付いた場合でも、`backend/lab_manager.py` が起動時に `clabgui/aruba_arubaos-cx:*` を Docker から探し、見つかった最新タグを既定イメージにします。

---

## セットアップ

```bash
git clone https://github.com/Tsugiyama-cat/ContainerLab-GUI.git
cd ContainerLab-GUI

# 1. AOS-CX の OVA を SWOS/aoscx/ に配置（OVA のまま OK。make が自動展開）
#    例: cp ~/Downloads/ArubaOS-CX_10_16_1006.ova SWOS/aoscx/

# 2. AOS-CX イメージをビルド
cd SWOS/aoscx/docker && make && cd ../../..
#    → clabgui/aruba_arubaos-cx:10.16.1006 が作成される

# 3. (任意) 認証情報を変更したい場合のみ
# cp .env.example .env  # .env はオプション。未配置でもデフォルト値で動作

# 4. GUI を起動
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

1. [HPE Networking Support Portal](https://networkingsupport.hpe.com/) から OVA をダウンロード
2. `SWOS/aoscx/` に配置（**OVA のまま OK**、展開不要）
3. Docker イメージをビルド:

```bash
cd SWOS/aoscx/docker
make
# OVA を検出 → tar 自動展開 → vmdk からビルド → clabgui/aruba_arubaos-cx:10.16.1006 タグ付与
```

タグ末尾を明示したい場合：
```bash
make TAG_VERSION=10.16.1006
```

### vrnetlab スクリプトの出自

`SWOS/aoscx/docker/vrnetlab.py` / `launch.py` は [hellt/vrnetlab](https://github.com/hellt/vrnetlab) の **tap+tc 版**を元にしています。  
**この 2 ファイルは必ずペアでバージョンが一致している必要があります**（`launch.py` は `boot_delay()` / `cpu` / `smp` 引数など `vrnetlab.py` の tap+tc API に依存）。  
古い socket 版に戻すとノード間リンクが無通信になるため、差し替えは両ファイル同時に行ってください。

> **注意:** ベンダーイメージ（`.ova` / `.vmdk` / `.ovf` / `.qcow2`）は `.gitignore` により Git 管理対象外です。ローカルにのみ保存してください。

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
    └── aoscx/               # Aruba AOS-CX
        ├── *.ova / *.vmdk / *.ovf   # ← gitignore（要手動配置）
        └── docker/          # vrnetlab (tap+tc 版) ベースの Dockerfile / Makefile
```

> `SWOS/` 配下の OS イメージ（`.ova` / `.vmdk` / `.ovf`）はライセンス上 Git 管理対象外です。  
> HPE Networking Support Portal から取得してローカルに配置してください。

---

## 環境変数

`.env` は **任意**です（無くてもデフォルト値で起動します）。デフォルトを変更したい場合のみ作成してください：

```bash
cp .env.example .env
```

| 変数名 | 説明 | デフォルト値 |
|---|---|---|
| `AOSCX_SSH_USER` | AOS-CX SSH ユーザー名 | `admin` |
| `AOSCX_SSH_PASS` | AOS-CX SSH パスワード | `admin` |
