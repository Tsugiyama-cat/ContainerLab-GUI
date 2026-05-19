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
│   ├── main.py              # API エンドポイント / SSH 設定取得
│   ├── lab_manager.py       # ノード・リンク管理 / デプロイ / Docker API
│   ├── templates.py         # テンプレートトポロジー定義
│   └── requirements.txt
│
├── frontend/                # Web フロントエンド（バニラ JS）
│   ├── index.html           # メイン画面
│   ├── app.js               # フロントエンドロジック全般
│   ├── style.css
│   └── terminal.html        # インライン SSH ターミナル（xterm.js）
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
