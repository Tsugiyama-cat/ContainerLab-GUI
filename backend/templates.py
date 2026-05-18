TEMPLATES = [
    {
        "id": "ping_test",
        "name": "疎通確認",
        "description": "sw1(192.168.100.1) と sw2(192.168.100.2) がVLAN100で相互pingできる2台構成",
        "nodes": [
            {"name": "sw1", "node_type": "aruba_aoscx"},
            {"name": "sw2", "node_type": "aruba_aoscx"},
        ],
        "links": [
            {"source": "sw1", "source_port": 2, "target": "sw2", "target_port": 2},
        ],
        "configs": {
            "sw1": """\
ip routing
vlan 100
    name VLAN100
interface 1/1/2
    no shutdown
    no routing
    vlan access 100
interface vlan 100
    ip address 192.168.100.1/24
    no shutdown
""",
            "sw2": """\
ip routing
vlan 100
    name VLAN100
interface 1/1/2
    no shutdown
    no routing
    vlan access 100
interface vlan 100
    ip address 192.168.100.2/24
    no shutdown
""",
        },
        "verification": [
            "VLAN100 の SVI (interface vlan 100) が up 状態であること",
            "sw1 から sw2 へ ping 192.168.100.2 が通ること",
            "sw2 から sw1 へ ping 192.168.100.1 が通ること",
        ],
        "test_commands": {
            "sw1": [
                "show vlan 100",
                "show interface vlan 100",
                "ping 192.168.100.2 repetitions 5",
            ],
            "sw2": [
                "show vlan 100",
                "ping 192.168.100.1 repetitions 5",
            ],
        },
    },
    {
        "id": "edge_core",
        "name": "Edge-Core 構成",
        "description": (
            "core がVLAN100/200間をルーティング。"
            "edge1(192.168.100.2) → edge2(192.168.200.2) へpingが通る3台構成"
        ),
        "nodes": [
            {"name": "core",  "node_type": "aruba_aoscx"},
            {"name": "edge1", "node_type": "aruba_aoscx"},
            {"name": "edge2", "node_type": "aruba_aoscx"},
        ],
        "links": [
            {"source": "core", "source_port": 2, "target": "edge1", "target_port": 2},
            {"source": "core", "source_port": 3, "target": "edge2", "target_port": 2},
        ],
        "configs": {
            "core": """\
ip routing
vlan 100
    name VLAN100
vlan 200
    name VLAN200
interface 1/1/2
    no shutdown
    no routing
    vlan access 100
interface 1/1/3
    no shutdown
    no routing
    vlan access 200
interface vlan 100
    ip address 192.168.100.1/24
    no shutdown
interface vlan 200
    ip address 192.168.200.1/24
    no shutdown
""",
            "edge1": """\
ip routing
vlan 100
    name VLAN100
interface 1/1/2
    no shutdown
    no routing
    vlan access 100
interface vlan 100
    ip address 192.168.100.2/24
    no shutdown
ip route 0.0.0.0/0 192.168.100.1
""",
            "edge2": """\
ip routing
vlan 200
    name VLAN200
interface 1/1/2
    no shutdown
    no routing
    vlan access 200
interface vlan 200
    ip address 192.168.200.2/24
    no shutdown
ip route 0.0.0.0/0 192.168.200.1
""",
        },
        "verification": [
            "core で VLAN100/VLAN200 間のルーティングが動作していること",
            "edge1 → edge2 へ cross-VLAN ping が通ること (192.168.100.2 → 192.168.200.2)",
        ],
        "test_commands": {
            "core": [
                "show ip route",
                "show vlan",
            ],
            "edge1": [
                "show ip route",
                "ping 192.168.200.2 repetitions 5",
            ],
            "edge2": [
                "ping 192.168.100.2 repetitions 5",
            ],
        },
    },
    # ── BGP L3 ルーティング ────────────────────────────────────────────────────
    {
        "id": "bgp_l3",
        "name": "BGP L3 ルーティング",
        "description": (
            "eBGP によるL3ルーティング。"
            "r1(lo:10.0.0.1) と r3(lo:10.0.0.3) が r2(AS65000) 経由で疎通できる3台構成"
        ),
        "nodes": [
            {"name": "r1", "node_type": "aruba_aoscx"},
            {"name": "r2", "node_type": "aruba_aoscx"},
            {"name": "r3", "node_type": "aruba_aoscx"},
        ],
        "links": [
            {"source": "r1", "source_port": 2, "target": "r2", "target_port": 2},
            {"source": "r2", "source_port": 3, "target": "r3", "target_port": 2},
        ],
        "configs": {
            "r1": """\
ip routing
interface loopback 0
    ip address 10.0.0.1/32
    no shutdown
interface 1/1/2
    no shutdown
    ip address 10.1.1.1/31
router bgp 65001
    bgp router-id 10.0.0.1
    neighbor 10.1.1.0 remote-as 65000
    address-family ipv4 unicast
        network 10.0.0.1/32
        neighbor 10.1.1.0 activate
""",
            "r2": """\
ip routing
interface loopback 0
    ip address 10.0.0.2/32
    no shutdown
interface 1/1/2
    no shutdown
    ip address 10.1.1.0/31
interface 1/1/3
    no shutdown
    ip address 10.1.2.0/31
router bgp 65000
    bgp router-id 10.0.0.2
    neighbor 10.1.1.1 remote-as 65001
    neighbor 10.1.2.1 remote-as 65002
    address-family ipv4 unicast
        network 10.0.0.2/32
        network 10.1.1.0/31
        network 10.1.2.0/31
        neighbor 10.1.1.1 activate
        neighbor 10.1.2.1 activate
""",
            "r3": """\
ip routing
interface loopback 0
    ip address 10.0.0.3/32
    no shutdown
interface 1/1/2
    no shutdown
    ip address 10.1.2.1/31
router bgp 65002
    bgp router-id 10.0.0.3
    neighbor 10.1.2.0 remote-as 65000
    address-family ipv4 unicast
        network 10.0.0.3/32
        neighbor 10.1.2.0 activate
""",
        },
        "verification": [
            "r1-r2、r2-r3 間で eBGP セッションが Established であること",
            "r1 が r3 の loopback (10.0.0.3/32) を BGP で受信していること",
            "loopback 間 ping は source 指定が必要 (source 省略では疎通しない)",
        ],
        "test_commands": {
            "r1": [
                "show bgp ipv4 unicast summary",
                "show ip bgp",
                "ping 10.0.0.3 repetitions 5 source 10.0.0.1",
            ],
            "r2": [
                "show bgp ipv4 unicast summary",
                "show ip bgp",
            ],
            "r3": [
                "show bgp ipv4 unicast summary",
                "ping 10.0.0.1 repetitions 5 source 10.0.0.3",
            ],
        },
    },
    # ── EVPN-VXLAN (Spine-Leaf) ────────────────────────────────────────────────
    {
        "id": "evpn_vxlan",
        "name": "EVPN-VXLAN",
        "description": (
            "eBGP アンダーレイ + EVPN-VXLAN オーバーレイ。"
            "leaf1/leaf2 間の VLAN10 を VNI 10010 で延伸する Spine-Leaf 3台構成"
        ),
        "nodes": [
            {"name": "spine1", "node_type": "aruba_aoscx"},
            {"name": "leaf1",  "node_type": "aruba_aoscx"},
            {"name": "leaf2",  "node_type": "aruba_aoscx"},
        ],
        "links": [
            {"source": "spine1", "source_port": 2, "target": "leaf1", "target_port": 2},
            {"source": "spine1", "source_port": 3, "target": "leaf2", "target_port": 2},
        ],
        "configs": {
            "spine1": """\
ip routing
interface loopback 0
    ip address 10.0.0.1/32
    no shutdown
interface 1/1/2
    no shutdown
    ip address 10.1.1.0/31
interface 1/1/3
    no shutdown
    ip address 10.1.2.0/31
router bgp 65000
    bgp router-id 10.0.0.1
    neighbor 10.1.1.1 remote-as 65001
    neighbor 10.1.2.1 remote-as 65002
    address-family ipv4 unicast
        network 10.0.0.1/32
        neighbor 10.1.1.1 activate
        neighbor 10.1.2.1 activate
    address-family l2vpn evpn
        neighbor 10.1.1.1 activate
        neighbor 10.1.1.1 send-community extended
        neighbor 10.1.2.1 activate
        neighbor 10.1.2.1 send-community extended
""",
            "leaf1": """\
ip routing
vlan 10
    name VLAN10
interface loopback 0
    ip address 10.0.0.2/32
    no shutdown
interface 1/1/2
    no shutdown
    ip address 10.1.1.1/31
interface vlan 10
    ip address 10.10.10.1/24
    no shutdown
interface vxlan 1
    source ip 10.0.0.2
    no shutdown
    vni 10010
        vlan 10
evpn
    vlan 10
        rd auto
        route-target export 10010:10010
        route-target import 10010:10010
router bgp 65001
    bgp router-id 10.0.0.2
    neighbor 10.1.1.0 remote-as 65000
    address-family ipv4 unicast
        network 10.0.0.2/32
        neighbor 10.1.1.0 activate
    address-family l2vpn evpn
        neighbor 10.1.1.0 activate
        neighbor 10.1.1.0 send-community extended
""",
            "leaf2": """\
ip routing
vlan 10
    name VLAN10
interface loopback 0
    ip address 10.0.0.3/32
    no shutdown
interface 1/1/2
    no shutdown
    ip address 10.1.2.1/31
interface vlan 10
    ip address 10.10.10.2/24
    no shutdown
interface vxlan 1
    source ip 10.0.0.3
    no shutdown
    vni 10010
        vlan 10
evpn
    vlan 10
        rd auto
        route-target export 10010:10010
        route-target import 10010:10010
router bgp 65002
    bgp router-id 10.0.0.3
    neighbor 10.1.2.0 remote-as 65000
    address-family ipv4 unicast
        network 10.0.0.3/32
        neighbor 10.1.2.0 activate
    address-family l2vpn evpn
        neighbor 10.1.2.0 activate
        neighbor 10.1.2.0 send-community extended
""",
        },
        "verification": [
            "spine1-leaf 間で eBGP (IPv4 Unicast + L2VPN EVPN) が Established であること",
            "leaf1/leaf2 で show evpn evi の Peer VTEPs が 1 以上表示されること",
            "leaf1 ↔ leaf2 間で SVI ping が通ること (source 指定必須)",
        ],
        "test_commands": {
            "spine1": [
                "show bgp ipv4 unicast summary",
                "show bgp l2vpn evpn summary",
            ],
            "leaf1": [
                "show evpn evi",
                "show bgp l2vpn evpn",
                "show interface vxlan 1",
                "ping 10.10.10.2 repetitions 5 source 10.10.10.1",
            ],
            "leaf2": [
                "show evpn evi",
                "ping 10.10.10.1 repetitions 5 source 10.10.10.2",
            ],
        },
    },
]
