import asyncio
import http.client
import json
import os
import socket
import uuid
from pathlib import Path
from typing import Optional

import yaml

NODE_TYPES = {
    "aruba_aoscx": {
        "name": "Aruba AOSCX",
        "kind": "aruba_aoscx",
        "default_image": "clabgui/aruba_arubaos-cx:10.16.1006",
        "image_hint": "例: clabgui/aruba_arubaos-cx:10.16.1006",
        "ssh_user": os.environ.get("AOSCX_SSH_USER", "admin"),
        "ssh_pass": os.environ.get("AOSCX_SSH_PASS", "admin"),
        "ssh_port": 22,
        "color": "#FF6B35",
        "label_color": "#ffffff",
        # 1/1/1 は vrnetlab 管理用のため、データリンクは 1/1/2 以降を使用
        "iface_fmt": "1/1/{n}",
        "iface_start": 2,
    },

}

LAB_NAME = "clabgui"
WORK_DIR = Path("/tmp/clabgui")


class LabManager:
    def __init__(self):
        WORK_DIR.mkdir(exist_ok=True)
        self.nodes: dict[str, dict] = {}
        self.links: dict[str, dict] = {}
        self._node_port: dict[str, int] = {}
        self.deployed = False
        self.deployed_nodes: dict[str, dict] = {}
        self.startup_configs: dict[str, str] = {}  # node_name -> running-config text
        self.mclag_configs: dict[str, str] = {}    # Phase1: spine ポート再割り当て
        self.mclag_leaf_configs: dict[str, str] = {}  # Phase2: leaf ポートshut/no-shut
        self.vsx_primary: str = ""                  # VSX In-Sync 監視対象ノード名
        self.mclag_status: str = ""                 # フロントエンド表示用ステータス

    # ── ノード操作 ────────────────────────────────────────────

    def add_node(
        self,
        node_type: str,
        label: Optional[str] = None,
        image: Optional[str] = None,
    ) -> dict:
        if node_type not in NODE_TYPES:
            raise ValueError(f"不明なノードタイプ: {node_type}")

        nid = str(uuid.uuid4())[:8]
        t = NODE_TYPES[node_type]
        short = node_type.split("_")[-1]  # e.g. "aoscx", "vjunosswitch"

        # ユニークな名前を生成
        existing = {n["name"] for n in self.nodes.values()}
        if label:
            if label in existing:
                raise ValueError(f"ノード名 '{label}' は既に使用されています")
            name = label
        else:
            idx = 1
            while f"{short}{idx}" in existing:
                idx += 1
            name = f"{short}{idx}"

        resolved_image = image or t["default_image"]
        if not resolved_image:
            raise ValueError(
                f"イメージ名を指定してください（{t['image_hint']}）"
            )

        self.nodes[nid] = {
            "id": nid,
            "name": name,
            "type": node_type,
            "kind": t["kind"],
            "image": resolved_image,
            "ssh_user": t["ssh_user"],
            "ssh_pass": t["ssh_pass"],
            "ssh_port": t["ssh_port"],
            "color": t["color"],
            "iface_fmt": t["iface_fmt"],
            "iface_start": t["iface_start"],
        }
        self._node_port[nid] = t["iface_start"]
        return self.nodes[nid]

    def update_node(self, node_id: str, name: Optional[str] = None, image: Optional[str] = None) -> dict:
        if node_id not in self.nodes:
            raise ValueError(f"ノードが見つかりません: {node_id}")
        if name:
            self.nodes[node_id]["name"] = name
        if image:
            self.nodes[node_id]["image"] = image
        return self.nodes[node_id]

    def remove_node(self, node_id: str):
        if node_id not in self.nodes:
            raise ValueError(f"ノードが見つかりません: {node_id}")
        for lid in [l for l, d in self.links.items()
                    if d["source_id"] == node_id or d["target_id"] == node_id]:
            del self.links[lid]
        del self.nodes[node_id]
        del self._node_port[node_id]

    # ── リンク操作 ────────────────────────────────────────────

    def add_link(
        self,
        source_id: str,
        target_id: str,
        source_port: Optional[int] = None,
        target_port: Optional[int] = None,
    ) -> dict:
        if source_id not in self.nodes or target_id not in self.nodes:
            raise ValueError("ノードが見つかりません")
        if source_id == target_id:
            raise ValueError("同じノード同士は接続できません")

        sp = source_port if source_port is not None else self._node_port[source_id]
        tp = target_port if target_port is not None else self._node_port[target_id]

        self._node_port[source_id] = max(self._node_port[source_id], sp + 1)
        self._node_port[target_id] = max(self._node_port[target_id], tp + 1)

        src_node = self.nodes[source_id]
        tgt_node = self.nodes[target_id]
        lid = str(uuid.uuid4())[:8]
        self.links[lid] = {
            "id": lid,
            "source_id": source_id,
            "target_id": target_id,
            "source_port": sp,
            "target_port": tp,
            "source_iface": src_node["iface_fmt"].format(n=sp),
            "target_iface": tgt_node["iface_fmt"].format(n=tp),
        }
        return self.links[lid]

    def remove_link(self, link_id: str):
        if link_id not in self.links:
            raise ValueError(f"リンクが見つかりません: {link_id}")
        del self.links[link_id]

    # ── YAML 生成 ─────────────────────────────────────────────

    def generate_yaml(self) -> str:
        topo: dict = {
            "name": LAB_NAME,
            "topology": {"nodes": {}, "links": []},
        }

        # 各ノードで使用するインターフェース収集
        node_ifaces: dict[str, list[str]] = {}
        for lk in self.links.values():
            for nid, iface_key in [(lk["source_id"], "source_iface"), (lk["target_id"], "target_iface")]:
                name = self.nodes[nid]["name"]
                node_ifaces.setdefault(name, []).append(lk[iface_key])

        for n in self.nodes.values():
            node_entry: dict = {"kind": n["kind"], "image": n["image"]}
            ifaces = node_ifaces.get(n["name"], [])
            startup_cfg = self.startup_configs.get(n["name"], "")
            if startup_cfg or ifaces:
                cfg_path = WORK_DIR / f"startup-{n['name']}.cfg"
                if startup_cfg:
                    cfg_path.write_text(startup_cfg)
                else:
                    cfg_lines = []
                    for iface in sorted(set(ifaces)):
                        cfg_lines.append(f"interface {iface}")
                        cfg_lines.append("    no shutdown")
                    cfg_path.write_text("\n".join(cfg_lines) + "\n")
                node_entry["startup-config"] = str(cfg_path)
            topo["topology"]["nodes"][n["name"]] = node_entry

        for lk in self.links.values():
            src_node = self.nodes[lk["source_id"]]
            tgt_node = self.nodes[lk["target_id"]]
            src_iface = src_node["iface_fmt"].format(n=lk["source_port"])
            tgt_iface = tgt_node["iface_fmt"].format(n=lk["target_port"])
            topo["topology"]["links"].append({
                "endpoints": [
                    f"{src_node['name']}:{src_iface}",
                    f"{tgt_node['name']}:{tgt_iface}",
                ]
            })
        return yaml.dump(topo, default_flow_style=False, allow_unicode=True)

    def _topo_path(self) -> Path:
        return WORK_DIR / f"{LAB_NAME}.clab.yaml"

    # ── Docker API (Unix socket) ──────────────────────────────

    def _docker_request(self, method: str, path: str, body: dict | None = None):
        class _UnixConn(http.client.HTTPConnection):
            def connect(self_):
                self_.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                self_.sock.connect("/var/run/docker.sock")

        conn = _UnixConn("localhost")
        headers = {}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        conn.request(method, path, body=data, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
        return resp.status, json.loads(raw) if raw else {}

    def _force_cleanup_lab(self):
        """containerlab=LAB_NAME ラベルを持つコンテナを全て強制削除する"""
        import urllib.parse
        filt = urllib.parse.quote(json.dumps({"label": [f"containerlab={LAB_NAME}"]}))
        try:
            _, containers = self._docker_request("GET", f"/containers/json?all=1&filters={filt}")
            for c in containers:
                cid = c["Id"]
                self._docker_request("POST", f"/containers/{cid}/stop?t=5")
                self._docker_request("DELETE", f"/containers/{cid}?force=true")
        except Exception:
            pass
        # 管理ネットワークも削除
        try:
            net_name = f"clab-{LAB_NAME}"
            filt2 = urllib.parse.quote(json.dumps({"name": [net_name]}))
            _, nets = self._docker_request("GET", f"/networks?filters={filt2}")
            for n in nets:
                self._docker_request("DELETE", f"/networks/{n['Id']}")
        except Exception:
            pass

    # ── デプロイ/破棄 ─────────────────────────────────────────

    async def deploy(self) -> tuple[bool, str]:
        self._topo_path().write_text(self.generate_yaml())

        # 残骸コンテナを Docker API で直接強制削除
        await asyncio.get_event_loop().run_in_executor(None, self._force_cleanup_lab)

        # clab が管理するノード設定ディレクトリを削除して startup-config を確実に上書きさせる
        import shutil as _shutil
        clab_node_dir = WORK_DIR / f"clab-{LAB_NAME}"
        if clab_node_dir.exists():
            _shutil.rmtree(clab_node_dir)

        proc = await asyncio.create_subprocess_exec(
            "clab", "deploy", "-t", str(self._topo_path()),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        out, _ = await proc.communicate()
        output = out.decode()
        if proc.returncode == 0:
            self.deployed = True
            await self._refresh_node_info()
        return proc.returncode == 0, output

    async def destroy(self) -> tuple[bool, str]:
        await asyncio.get_event_loop().run_in_executor(None, self._force_cleanup_lab)
        self.deployed = False
        self.deployed_nodes = {}
        self.mclag_status = ""
        self.mclag_leaf_configs = {}
        return True, "ラボを破棄しました"

    async def _refresh_node_info(self):
        proc = await asyncio.create_subprocess_exec(
            "clab", "inspect", "--name", LAB_NAME, "--format", "json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await proc.communicate()
        if proc.returncode != 0 or not out:
            return
        try:
            data = json.loads(out.decode())
            if isinstance(data, list):
                containers = data
            elif isinstance(data, dict):
                # {"clabgui": [...]} or {"containers": [...]}
                containers = data.get(LAB_NAME) or data.get("containers") or []
            else:
                containers = []
            for c in containers:
                raw = c.get("name", "")
                node_name = raw.replace(f"clab-{LAB_NAME}-", "")
                addr = c.get("ipv4_address") or c.get("ipv4_mgmt_addr", "")
                self.deployed_nodes[node_name] = {
                    "mgmt_ip": addr.split("/")[0] if addr and addr != "N/A" else "",
                    "container_name": raw,
                    "state": c.get("state", "unknown"),
                }
        except (json.JSONDecodeError, KeyError):
            pass

    # ── SSH 情報取得 ──────────────────────────────────────────

    def get_ssh_info(self, node_name: str) -> Optional[dict]:
        node = next((n for n in self.nodes.values() if n["name"] == node_name), None)
        if not node:
            return None
        dep = self.deployed_nodes.get(node_name, {})
        return {
            "mgmt_ip": dep.get("mgmt_ip"),
            "ssh_user": node["ssh_user"],
            "ssh_pass": node["ssh_pass"],
            "ssh_port": node["ssh_port"],
            "container_name": dep.get("container_name"),
        }

    # ── トポロジー保存/読み込み ───────────────────────────────

    def export(self) -> dict:
        return {
            "version": 1,
            "nodes": list(self.nodes.values()),
            "links": list(self.links.values()),
            "configs": {},  # main.py がデプロイ済みの場合に SSH で取得して埋める
        }

    def import_data(self, data: dict):
        self.nodes = {}
        self.links = {}
        self._node_port = {}
        self.deployed = False
        self.deployed_nodes = {}
        self.startup_configs = {k: v for k, v in data.get("configs", {}).items() if v}

        for n in data.get("nodes", []):
            if n.get("type") not in NODE_TYPES:
                raise ValueError(f"不明なノードタイプ: {n.get('type')}")
            self.nodes[n["id"]] = n
            t = NODE_TYPES[n["type"]]
            self._node_port[n["id"]] = t["iface_start"]

        for l in data.get("links", []):
            if l["source_id"] not in self.nodes or l["target_id"] not in self.nodes:
                raise ValueError("リンクのノードが見つかりません")
            self.links[l["id"]] = l
            sid, tid = l["source_id"], l["target_id"]
            sp = l.get("source_port", 0)
            tp = l.get("target_port", 0)
            self._node_port[sid] = max(self._node_port.get(sid, 0), sp + 1)
            self._node_port[tid] = max(self._node_port.get(tid, 0), tp + 1)

    # ── 状態シリアライズ ──────────────────────────────────────

    def to_dict(self) -> dict:
        return {
            "nodes": list(self.nodes.values()),
            "links": list(self.links.values()),
            "deployed": self.deployed,
            "deployed_nodes": self.deployed_nodes,
        }
