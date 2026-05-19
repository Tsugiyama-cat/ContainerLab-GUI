import asyncio
import json
import re
import uuid
from pathlib import Path
from typing import Optional

import asyncssh
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from lab_manager import LabManager, NODE_TYPES
from templates import TEMPLATES

FRONTEND = Path(__file__).parent.parent / "frontend"

app = FastAPI(title="ContainerLab GUI")
app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")

lab = LabManager()
_deploy_lock = asyncio.Lock()
_mclag_task: Optional[asyncio.Task] = None


# ── MCLAG バックグラウンドタスク ──────────────────────────────

async def _ssh_push_config(info: dict, config: str, retries: int = 3) -> bool:
    """SSH で configure terminal → コンフィグ投入 → write memory (最大 retries 回リトライ)"""
    lines = [l.rstrip() for l in config.splitlines()
             if l.strip() and not l.strip().startswith('#')]
    for attempt in range(retries):
        if attempt > 0:
            await asyncio.sleep(10)
        try:
            async with asyncssh.connect(
                info["mgmt_ip"],
                port=info.get("ssh_port", 22),
                username=info["ssh_user"],
                password=info["ssh_pass"],
                known_hosts=None,
                connect_timeout=30,
            ) as conn:
                async with conn.create_process(term_type="vt100", term_size=(220, 50)) as proc:
                    await asyncio.sleep(3.0)
                    proc.stdin.write("configure terminal\n")
                    await asyncio.sleep(1.0)
                    for line in lines:
                        proc.stdin.write(line + "\n")
                        await asyncio.sleep(0.1)
                    proc.stdin.write("end\n")
                    await asyncio.sleep(1.0)
                    proc.stdin.write("write memory\n")
                    await asyncio.sleep(5.0)
                    proc.stdin.write("exit\n")
                    await asyncio.sleep(0.5)
            return True
        except Exception:
            continue
    return False


async def _vsx_mclag_background():
    """VSX In-Sync 確認後に MCLAG (vsx-sync) 設定を SSH で自動投入する"""
    if not lab.vsx_primary or not lab.mclag_configs:
        return

    lab.mclag_status = "VSX In-Sync 待機中..."

    # VSX primary に SSH して ISL channel In-Sync を確認 (最大 5分)
    for _ in range(30):
        await asyncio.sleep(10)
        if not lab.deployed:
            lab.mclag_status = ""
            return
        info = lab.get_ssh_info(lab.vsx_primary)
        if not info or not info.get("mgmt_ip"):
            continue
        try:
            async with asyncssh.connect(
                info["mgmt_ip"],
                port=info.get("ssh_port", 22),
                username=info["ssh_user"],
                password=info["ssh_pass"],
                known_hosts=None,
                connect_timeout=10,
            ) as conn:
                async with conn.create_process(
                    term_type="vt100", term_size=(220, 50)
                ) as proc:
                    await asyncio.sleep(3.0)
                    proc.stdin.write("show vsx status\n")
                    await asyncio.sleep(3.0)
                    data = b""
                    try:
                        while True:
                            chunk = await asyncio.wait_for(
                                proc.stdout.read(4096), timeout=1.0)
                            if not chunk:
                                break
                            data += chunk
                    except asyncio.TimeoutError:
                        pass
                    if b"In-Sync" in data:
                        break
        except Exception:
            continue
    else:
        lab.mclag_status = "VSX In-Sync 待機タイムアウト (5分)"
        return

    lab.mclag_status = "VSX In-Sync 確認 → MCLAG (vsx-sync) 設定投入中..."
    await asyncio.sleep(10)  # VSX 安定化のため追加待機

    failed = []
    for node_name, config in lab.mclag_configs.items():
        if not lab.deployed:
            return
        info = lab.get_ssh_info(node_name)
        if not info or not info.get("mgmt_ip"):
            failed.append(f"{node_name}(IP未取得)")
            continue
        lab.mclag_status = f"MCLAG: {node_name} に vsx-sync を投入中..."
        ok = await _ssh_push_config(info, config)
        if not ok:
            failed.append(node_name)

    if failed:
        lab.mclag_status = f"MCLAG 設定投入失敗: {', '.join(failed)} — ログインして手動確認してください"
    else:
        lab.mclag_status = "MCLAG (vsx-sync) 設定投入完了 — LAG が up になるまで数十秒かかります"


# ── 静的ページ ────────────────────────────────────────────────

@app.get("/")
async def index():
    return FileResponse(FRONTEND / "index.html")


@app.get("/terminal")
async def terminal_page():
    return FileResponse(FRONTEND / "terminal.html")


# ── ノードタイプ一覧 ──────────────────────────────────────────

@app.get("/api/node-types")
async def get_node_types():
    return {
        "types": [
            {
                "id": k,
                "name": v["name"],
                "kind": v["kind"],
                "default_image": v["default_image"],
                "image_hint": v["image_hint"],
                "ssh_user": v["ssh_user"],
                "ssh_port": v["ssh_port"],
                "color": v["color"],
                "label_color": v["label_color"],
            }
            for k, v in NODE_TYPES.items()
        ]
    }


# ── トポロジー取得 ────────────────────────────────────────────

@app.get("/api/topology")
async def get_topology():
    return lab.to_dict()


@app.get("/api/topology/yaml")
async def get_yaml():
    return {"yaml": lab.generate_yaml()}


# ── ノード操作 ────────────────────────────────────────────────

class AddNodeReq(BaseModel):
    node_type: str
    label: Optional[str] = None
    image: Optional[str] = None


class UpdateNodeReq(BaseModel):
    name: Optional[str] = None
    image: Optional[str] = None


@app.post("/api/topology/node", status_code=201)
async def add_node(req: AddNodeReq):
    try:
        return lab.add_node(req.node_type, req.label, req.image)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.patch("/api/topology/node/{node_id}")
async def update_node(node_id: str, req: UpdateNodeReq):
    try:
        return lab.update_node(node_id, req.name, req.image)
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.delete("/api/topology/node/{node_id}")
async def remove_node(node_id: str):
    try:
        lab.remove_node(node_id)
        return {"status": "ok"}
    except ValueError as e:
        raise HTTPException(404, str(e))


# ── リンク操作 ────────────────────────────────────────────────

class AddLinkReq(BaseModel):
    source_id: str
    target_id: str
    source_port: Optional[int] = None
    target_port: Optional[int] = None


@app.post("/api/topology/link", status_code=201)
async def add_link(req: AddLinkReq):
    try:
        return lab.add_link(req.source_id, req.target_id, req.source_port, req.target_port)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/topology/link/{link_id}")
async def remove_link(link_id: str):
    try:
        lab.remove_link(link_id)
        return {"status": "ok"}
    except ValueError as e:
        raise HTTPException(404, str(e))


# ── デプロイ/破棄 ─────────────────────────────────────────────

@app.post("/api/deploy")
async def deploy():
    global _mclag_task
    if _deploy_lock.locked():
        raise HTTPException(409, "デプロイが既に進行中です")
    if not lab.nodes:
        raise HTTPException(400, "ノードが1つも追加されていません")
    if _mclag_task and not _mclag_task.done():
        _mclag_task.cancel()
    lab.mclag_status = ""
    async with _deploy_lock:
        success, output = await lab.deploy()
    if success and lab.mclag_configs:
        _mclag_task = asyncio.create_task(_vsx_mclag_background())
    return {
        "success": success,
        "output": output,
        "node_count": len(lab.nodes),
        "link_count": len(lab.links),
    }


@app.post("/api/destroy")
async def destroy():
    global _mclag_task
    if _mclag_task and not _mclag_task.done():
        _mclag_task.cancel()
        _mclag_task = None
    success, output = await lab.destroy()
    return {"success": success, "output": output}


@app.get("/api/status")
async def get_status():
    return {
        "deployed": lab.deployed,
        "deployed_nodes": lab.deployed_nodes,
        "has_pending_configs": bool(lab.startup_configs),
        "mclag_status": lab.mclag_status,
    }


# ── SSH コンフィグ投入 ────────────────────────────────────────

@app.post("/api/apply-configs")
async def apply_configs():
    if not lab.startup_configs:
        return {"results": {}}

    async def push_to(node_name: str, config: str) -> dict:
        info = lab.get_ssh_info(node_name)
        if not info or not info.get("mgmt_ip"):
            return {"error": "IPアドレス未取得"}
        node = next((n for n in lab.nodes.values() if n["name"] == node_name), None)
        kind = node["kind"] if node else ""
        junos = _is_junos(kind)
        try:
            async with asyncssh.connect(
                info["mgmt_ip"],
                port=info.get("ssh_port", 22),
                username=info["ssh_user"],
                password=info["ssh_pass"],
                known_hosts=None,
                connect_timeout=30,
            ) as conn:
                lines = [l.rstrip() for l in config.splitlines()
                         if l.strip() and not l.strip().startswith('#')]
                async with conn.create_process(
                    term_type="vt100",
                    term_size=(220, 50),
                ) as proc:
                    await asyncio.sleep(3.0)          # ログインバナー・CLI 起動待機
                    if junos:
                        proc.stdin.write("configure\n")
                        await asyncio.sleep(1.0)
                        proc.stdin.write("load set terminal\n")
                        await asyncio.sleep(0.5)
                        for line in lines:
                            proc.stdin.write(line + "\n")
                            await asyncio.sleep(0.05)
                        proc.stdin.write("\x04")      # Ctrl+D で load 終了
                        await asyncio.sleep(2.0)
                        proc.stdin.write("commit\n")
                        await asyncio.sleep(5.0)      # commit 待機
                        proc.stdin.write("exit\n")
                        await asyncio.sleep(0.5)
                    else:
                        proc.stdin.write("configure terminal\n")
                        await asyncio.sleep(1.0)
                        for line in lines:
                            proc.stdin.write(line + "\n")
                            await asyncio.sleep(0.1)
                        proc.stdin.write("end\n")
                        await asyncio.sleep(1.0)
                        proc.stdin.write("write memory\n")
                        await asyncio.sleep(5.0)      # 設定保存待機
                        proc.stdin.write("exit\n")
                        await asyncio.sleep(0.5)

                    output_chunks = []
                    try:
                        async with asyncio.timeout(5):
                            while True:
                                chunk = await proc.stdout.read(4096)
                                if not chunk:
                                    break
                                output_chunks.append(chunk)
                    except (asyncio.TimeoutError, Exception):
                        pass

                return {"output": "".join(output_chunks)}
        except (asyncssh.Error, OSError) as e:
            return {"error": f"SSHエラー: {e}"}
        except Exception as e:
            return {"error": str(e)}

    configs = dict(lab.startup_configs)

    results_list = await asyncio.gather(*[push_to(n, c) for n, c in configs.items()])
    results = dict(zip(configs.keys(), results_list))
    # 全ノード成功時のみ startup_configs をクリア
    if all(not r.get("error") for r in results.values()):
        lab.startup_configs = {}
    return {"results": results}


# ── ノード設定情報取得 ─────────────────────────────────────────────────────

def _is_junos(kind: str) -> bool:
    return "vjunos" in kind or "juniper" in kind


# ── Junos パーサー ─────────────────────────────────────────────

def _parse_junos_vlans(output: str) -> list[dict]:
    vlans = []
    for line in output.splitlines():
        # "vlan100  100  ge-0/0/0.0*" or "default  1"
        m = re.match(r'^(\S+)\s+(\d+)', line)
        if m and m.group(1) not in ('Name', 'Routing', 'VLAN', 'default-switch', 'Instance'):
            try:
                vlans.append({"id": int(m.group(2)), "name": m.group(1), "status": "up"})
            except ValueError:
                pass
    return vlans


def _parse_junos_ip_ifaces(output: str) -> list[dict]:
    result = []
    for line in output.splitlines():
        # ge-0/0/0.0  up  up  inet  10.0.0.1/31
        m = re.match(r'^(\S+\.\d+)\s+\S+\s+\S+\s+inet\s+([\d.]+/\d+)', line)
        if m:
            result.append({
                "interface": m.group(1),
                "ip": m.group(2),
                "type": "inet",
                "status": "up",
            })
    return result


def _parse_junos_ifaces(output: str) -> list[dict]:
    ifaces = []
    for line in output.splitlines():
        # ge-0/0/0  up  up
        m = re.match(r'^(ge-\d+/\d+/\d+)\s+(\S+)\s+(\S+)', line)
        if m:
            ifaces.append({
                "name": m.group(1),
                "mode": "routed",
                "vlan": None,
                "trunk_vlans": None,
                "ip": None,
                "shutdown": m.group(2) != "up",
            })
    return ifaces


# ── AOS-CX パーサー ────────────────────────────────────────────

def _parse_vlans(output: str) -> list[dict]:
    vlans = []
    for line in output.splitlines():
        m = re.match(r'^\s*(\d+)\s+(\S+)\s+(up|down)', line)
        if m:
            vlans.append({"id": int(m.group(1)), "name": m.group(2), "status": m.group(3)})
    return vlans


def _parse_ip_ifaces(output: str) -> list[dict]:
    result = []
    for line in output.splitlines():
        m = re.match(r'^(\S+)\s+([\d\.]+/\d+)\s+(\S+)\s+(\S+)', line)
        if m and '/' in m.group(2) and m.group(2)[0].isdigit():
            result.append({
                "interface": m.group(1),
                "ip": m.group(2),
                "type": m.group(3),
                "status": m.group(4),
            })
    return result


def _parse_ifaces_from_running(running: str) -> list[dict]:
    ifaces = []
    current: dict | None = None
    for raw in running.splitlines():
        line = raw.rstrip()
        # "interface 1/1/2" or "interface vlan 2" (with space)
        m = re.match(r'^interface (vlan\s+\d+|\S+)', line)
        if m:
            if current:
                ifaces.append(current)
            name = m.group(1).replace(' ', '')  # "vlan 2" -> "vlan2"
            current = {
                "name": name,
                "mode": "routed",
                "vlan": None,
                "trunk_vlans": None,
                "ip": None,
                "shutdown": True,
            }
        elif current:
            if re.match(r'\s+no shutdown', line):
                current["shutdown"] = False
            elif re.match(r'\s+no routing', line):
                current["mode"] = "switching"  # L2モードに移行済み
            elif (m2 := re.match(r'\s+vlan access (\d+)', line)):
                current["mode"] = "access"
                current["vlan"] = int(m2.group(1))
            elif (m2 := re.match(r'\s+vlan trunk allowed (\S+)', line)):
                current["mode"] = "trunk"
                current["trunk_vlans"] = m2.group(1)
            elif (m2 := re.match(r'\s+ip address ([\d\.]+/\d+)', line)):
                current["ip"] = m2.group(1)
            elif re.match(r'^[^\s]', line) and not line.startswith('interface'):
                ifaces.append(current)
                current = None
    if current:
        ifaces.append(current)
    return ifaces


@app.get("/api/node/{node_name}/config")
async def get_node_config(node_name: str):
    info = lab.get_ssh_info(node_name)
    if not info:
        raise HTTPException(404, "ノードが見つかりません")
    if not info.get("mgmt_ip"):
        raise HTTPException(400, "ノードがデプロイされていません")

    node = next((n for n in lab.nodes.values() if n["name"] == node_name), None)
    kind = node["kind"] if node else ""
    junos = _is_junos(kind)

    result: dict = {"vlans": [], "ip_interfaces": [], "interfaces": []}
    try:
        async with asyncssh.connect(
            info["mgmt_ip"],
            port=info.get("ssh_port", 22),
            username=info["ssh_user"],
            password=info["ssh_pass"],
            known_hosts=None,
            connect_timeout=15,
        ) as conn:
            async def run(cmd: str) -> str:
                try:
                    r = await conn.run(cmd, timeout=15)
                    return r.stdout or ""
                except Exception:
                    return ""

            if junos:
                vlan_out = await run("show vlans")
                iface_out = await run("show interfaces terse")
            else:
                vlan_out    = await run("show vlan")
                ip_out      = await run("show ip interface")
                running_out = await run("show running-config")

    except asyncssh.Error as e:
        raise HTTPException(500, f"SSHエラー: {e}")
    except Exception as e:
        raise HTTPException(500, str(e))

    if junos:
        result["vlans"]         = _parse_junos_vlans(vlan_out)
        result["ip_interfaces"] = _parse_junos_ip_ifaces(iface_out)
        result["interfaces"]    = _parse_junos_ifaces(iface_out)
    else:
        result["vlans"]         = _parse_vlans(vlan_out)
        result["ip_interfaces"] = _parse_ip_ifaces(ip_out)
        result["interfaces"]    = _parse_ifaces_from_running(running_out)
    return result


# ── テンプレート ──────────────────────────────────────────────

@app.get("/api/templates")
async def list_templates():
    return {
        "templates": [
            {
                "id": t["id"],
                "name": t["name"],
                "description": t["description"],
                "node_count": len(t["nodes"]),
                "link_count": len(t["links"]),
                "nodes": t["nodes"],
                "links": t["links"],
                "verification": t.get("verification", []),
                "test_commands": t.get("test_commands", {}),
            }
            for t in TEMPLATES
        ]
    }


@app.post("/api/templates/{template_id}/load")
async def load_template(template_id: str):
    tmpl = next((t for t in TEMPLATES if t["id"] == template_id), None)
    if not tmpl:
        raise HTTPException(404, "テンプレートが見つかりません")

    name_to_id   = {n["name"]: str(uuid.uuid4())[:8] for n in tmpl["nodes"]}
    node_type_map = {n["name"]: n["node_type"] for n in tmpl["nodes"]}

    nodes = []
    for n in tmpl["nodes"]:
        t = NODE_TYPES.get(n["node_type"])
        if not t:
            raise HTTPException(400, f"不明なノードタイプ: {n['node_type']}")
        if not t["default_image"]:
            raise HTTPException(400, f"'{n['node_type']}' のデフォルトイメージが未設定です")
        nodes.append({
            "id":        name_to_id[n["name"]],
            "name":      n["name"],
            "type":      n["node_type"],
            "kind":      t["kind"],
            "image":     t["default_image"],
            "ssh_user":  t["ssh_user"],
            "ssh_pass":  t["ssh_pass"],
            "ssh_port":  t["ssh_port"],
            "color":     t["color"],
            "iface_fmt": t["iface_fmt"],
            "iface_start": t["iface_start"],
        })

    links = []
    for l in tmpl["links"]:
        src_t = NODE_TYPES[node_type_map[l["source"]]]
        tgt_t = NODE_TYPES[node_type_map[l["target"]]]
        sp, tp = l["source_port"], l["target_port"]
        links.append({
            "id":          str(uuid.uuid4())[:8],
            "source_id":   name_to_id[l["source"]],
            "target_id":   name_to_id[l["target"]],
            "source_port": sp,
            "target_port": tp,
            "source_iface": src_t["iface_fmt"].format(n=sp),
            "target_iface": tgt_t["iface_fmt"].format(n=tp),
        })

    try:
        lab.import_data({
            "version": 1,
            "nodes":   nodes,
            "links":   links,
            "configs": tmpl.get("configs", {}),
        })
        lab.mclag_configs = tmpl.get("mclag_configs", {})
        lab.vsx_primary   = tmpl.get("vsx_primary", "")
        lab.mclag_status  = ""
        return lab.to_dict()
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── トポロジー保存/読み込み ────────────────────────────────────

@app.get("/api/topology/export")
async def export_topology():
    data = lab.export()
    if not lab.deployed:
        return data

    async def fetch_config(node: dict) -> tuple[str, str]:
        info = lab.get_ssh_info(node["name"])
        if not info or not info.get("mgmt_ip"):
            return node["name"], ""
        cmd = "show running-config" if "aoscx" in node["kind"] else "show configuration"
        try:
            async with asyncssh.connect(
                info["mgmt_ip"],
                port=info.get("ssh_port", 22),
                username=info["ssh_user"],
                password=info["ssh_pass"],
                known_hosts=None,
                connect_timeout=15,
            ) as conn:
                r = await conn.run(cmd, timeout=30)
                return node["name"], r.stdout or ""
        except Exception:
            return node["name"], ""

    results = await asyncio.gather(*[fetch_config(n) for n in lab.nodes.values()])
    data["configs"] = {name: cfg for name, cfg in results if cfg}
    return data


class ImportReq(BaseModel):
    data: dict


@app.post("/api/topology/import")
async def import_topology(req: ImportReq):
    try:
        lab.import_data(req.data)
        return lab.to_dict()
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── コマンド一括投入 ──────────────────────────────────────────

class BulkCmdReq(BaseModel):
    node_names: list[str]
    command: str


@app.post("/api/nodes/command")
async def bulk_command(req: BulkCmdReq):
    async def run_on(name: str) -> dict:
        info = lab.get_ssh_info(name)
        if not info or not info.get("mgmt_ip"):
            return {"error": "未デプロイ"}
        try:
            async with asyncssh.connect(
                info["mgmt_ip"],
                port=info.get("ssh_port", 22),
                username=info["ssh_user"],
                password=info["ssh_pass"],
                known_hosts=None,
                connect_timeout=15,
            ) as conn:
                r = await conn.run(req.command, timeout=30)
                return {"output": (r.stdout or "") + (r.stderr or "")}
        except Exception as e:
            return {"error": str(e)}

    names = req.node_names
    outputs = await asyncio.gather(*[run_on(n) for n in names])
    return {"results": dict(zip(names, outputs))}


# ── ping 疎通確認 ─────────────────────────────────────────────

class PingReq(BaseModel):
    source_node: str
    target_ip: str
    count: int = 5


@app.post("/api/ping")
async def ping_check(req: PingReq):
    info = lab.get_ssh_info(req.source_node)
    if not info:
        raise HTTPException(404, "ノードが見つかりません")
    if not info.get("mgmt_ip"):
        raise HTTPException(400, "ノードがデプロイされていません")

    node = next((n for n in lab.nodes.values() if n["name"] == req.source_node), None)
    kind = node["kind"] if node else ""
    cmd = (
        f"ping {req.target_ip} repetitions {req.count}"
        if "aoscx" in kind
        else f"ping {req.target_ip} count {req.count}"
    )

    try:
        async with asyncssh.connect(
            info["mgmt_ip"],
            port=info.get("ssh_port", 22),
            username=info["ssh_user"],
            password=info["ssh_pass"],
            known_hosts=None,
            connect_timeout=15,
        ) as conn:
            r = await conn.run(cmd, timeout=30)
            return {"output": (r.stdout or "") + (r.stderr or ""), "command": cmd}
    except asyncssh.Error as e:
        raise HTTPException(500, f"SSHエラー: {e}")
    except Exception as e:
        raise HTTPException(500, str(e))


# ── 設定バックアップ ──────────────────────────────────────────

@app.get("/api/node/{node_name}/backup")
async def get_config_backup(node_name: str):
    info = lab.get_ssh_info(node_name)
    if not info:
        raise HTTPException(404, "ノードが見つかりません")
    if not info.get("mgmt_ip"):
        raise HTTPException(400, "ノードがデプロイされていません")

    node = next((n for n in lab.nodes.values() if n["name"] == node_name), None)
    kind = node["kind"] if node else ""
    cmd = "show running-config" if "aoscx" in kind else "show configuration"

    try:
        async with asyncssh.connect(
            info["mgmt_ip"],
            port=info.get("ssh_port", 22),
            username=info["ssh_user"],
            password=info["ssh_pass"],
            known_hosts=None,
            connect_timeout=15,
        ) as conn:
            r = await conn.run(cmd, timeout=30)
            content = r.stdout or ""
        return Response(
            content=content,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{node_name}-running-config.txt"'},
        )
    except asyncssh.Error as e:
        raise HTTPException(500, f"SSHエラー: {e}")
    except Exception as e:
        raise HTTPException(500, str(e))


# ── WebSocket ターミナル ───────────────────────────────────────

@app.websocket("/ws/terminal/{node_name}")
async def terminal_ws(websocket: WebSocket, node_name: str, port: int = Query(default=22)):
    await websocket.accept()

    def send(text: str):
        return websocket.send_text(json.dumps({"type": "output", "data": text}))

    info = lab.get_ssh_info(node_name)
    if not info:
        await send(f"\r\nノード '{node_name}' が見つかりません。\r\n")
        await websocket.close()
        return

    if not info.get("mgmt_ip"):
        await send(f"\r\nノード '{node_name}' はまだデプロイされていません。\r\n")
        await websocket.close()
        return

    mgmt_ip = info["mgmt_ip"]
    await send(f"\r\n{node_name} ({mgmt_ip}) に接続中...\r\n")

    try:
        async with asyncssh.connect(
            mgmt_ip,
            port=port,
            username=info["ssh_user"],
            password=info["ssh_pass"],
            known_hosts=None,
            connect_timeout=30,
        ) as conn:
            await send("\r\n接続しました。\r\n\r\n")

            async with conn.create_process(
                term_type="xterm-256color",
                term_size=(220, 50),
            ) as process:

                async def ws_to_ssh():
                    try:
                        while True:
                            raw = await websocket.receive_text()
                            msg = json.loads(raw)
                            if msg.get("type") == "input":
                                process.stdin.write(msg["data"])
                            elif msg.get("type") == "resize":
                                process.change_terminal_size(
                                    msg.get("cols", 220),
                                    msg.get("rows", 50),
                                )
                    except (WebSocketDisconnect, Exception):
                        process.stdin.close()

                async def ssh_to_ws():
                    try:
                        while True:
                            data = await process.stdout.read(4096)
                            if not data:
                                break
                            await send(data)
                    except Exception:
                        pass

                await asyncio.gather(ws_to_ssh(), ssh_to_ws())

    except asyncssh.DisconnectError as e:
        await send(f"\r\n切断されました: {e}\r\n")
    except asyncssh.Error as e:
        await send(f"\r\nSSHエラー: {e}\r\n")
    except Exception as e:
        await send(f"\r\nエラー: {e}\r\n")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
