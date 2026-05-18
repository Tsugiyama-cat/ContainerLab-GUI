# ContainerLab GUI

ブラウザ上でネットワークトポロジーを構築・デプロイできる Web アプリです。  
[ContainerLab](https://containerlab.dev/) をバックエンドとして使用します。

---

## 対応ノードタイプ

| ノード | イメージ |
|---|---|
| Aruba AOS-CX | `clabgui/aruba_arubaos-cx:10.16.1006` |
| Juniper vJunos-Switch | `clabgui/juniper_vjunosswitch:25.4R1.12` |

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

### Juniper vJunos-Switch

1. [Juniper Software Download](https://support.juniper.net/support/downloads/) から `vJunos-switch` の `.qcow2` をダウンロード
2. vrnetlab の Juniper ディレクトリに配置してビルド

> **注意:** これらのイメージファイル（`.ova` / `.vmdk` / `.ovf` / `.qcow2`）は `.gitignore` により Git 管理対象外です。ローカルにのみ保存してください。

---

## 環境変数

`.env.example` をコピーして `.env` を作成してください。

| 変数名 | 説明 | デフォルト値 |
|---|---|---|
| `AOSCX_SSH_USER` | AOS-CX SSH ユーザー名 | `admin` |
| `AOSCX_SSH_PASS` | AOS-CX SSH パスワード | `admin` |
| `VJUNOS_SSH_USER` | vJunos SSH ユーザー名 | `admin` |
| `VJUNOS_SSH_PASS` | vJunos SSH パスワード | `admin@123` |
