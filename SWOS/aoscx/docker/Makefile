# ArubaOS-CX Docker イメージビルド
#
# 使い方:
#   1) SWOS/aoscx/ 配下に OVA を配置 (例: ArubaOS-CX_10_16_1006.ova)
#   2) make                          # OVA → vmdk 展開、ビルド、タグ付け まで自動
#   3) make TAG_VERSION=10.16.1006   # タグ末尾を明示指定したい場合
#
# タグ仕様:
#   clabgui/aruba_arubaos-cx:<TAG_VERSION>
#   - TAG_VERSION 未指定時は OVA ファイル名から推定 (例: ArubaOS-CX_10_16_1006 → 10.16.1006)
#   - 推定に失敗した場合のみ vmdk の日付 (genericx86-p4-YYYYMMDDhhmmss) にフォールバック
#
# .vmdk が既に SWOS/aoscx/ にあれば OVA 展開はスキップされる。

VENDOR    = Aruba
NAME      = ArubaOS-CX
NAMESPACE = clabgui

# 1) OVA を検出 (SWOS/aoscx/ 直下)
OVA       ?= $(shell ls ../*.ova 2>/dev/null | head -1)

# 2) vmdk を検出 (OVA 展開後 or 元々ある場合)
IMAGE     ?= $(shell ls ../*.vmdk 2>/dev/null | head -1 | xargs -r basename)

# 3) タグのバージョン部分を決定
#    - 明示指定 (TAG_VERSION=...) があればそれを使う
#    - 無ければ OVA ファイル名から推定 (例 ArubaOS-CX_10_16_1006.ova → 10.16.1006)
#    - それも無ければ vmdk の日付部分にフォールバック
OVA_VERSION  = $(shell echo "$(OVA)" | sed -rn 's|.*ArubaOS-CX[_-]([0-9]+)[_-]([0-9]+)[_-]([0-9]+).*|\1.\2.\3|p')
VMDK_VERSION = $(shell echo "$(IMAGE)" | sed -rn 's/.*arubaoscx-disk-image-genericx86-p4-(.+)\.vmdk/\1/p')
TAG_VERSION  ?= $(or $(OVA_VERSION),$(VMDK_VERSION))
TAG          = $(NAMESPACE)/aruba_arubaos-cx:$(TAG_VERSION)

.PHONY: docker-image clean extract-ova help

docker-image: extract-ova
	@if [ -z "$(IMAGE)" ]; then \
		echo "エラー: ../*.vmdk が見つかりません (OVA 展開にも失敗)"; exit 1; \
	fi
	@if [ -z "$(TAG_VERSION)" ]; then \
		echo "エラー: タグバージョンを決定できません。make TAG_VERSION=x.y.z で明示してください"; exit 1; \
	fi
	@echo "ビルド対象: $(IMAGE) → $(TAG)"
	cp ../$(IMAGE) ./
	docker build --build-arg IMAGE=$(IMAGE) -t $(TAG) .
	rm -f ./$(IMAGE)
	@echo "完了: $(TAG)"

# OVA を自動展開する (vmdk が既にあればスキップ)
extract-ova:
	@if [ -n "$(IMAGE)" ]; then \
		echo "vmdk 検出済み: $(IMAGE) (OVA 展開はスキップ)"; \
	elif [ -n "$(OVA)" ]; then \
		echo "OVA 展開: $(OVA)"; \
		tar -xf $(OVA) -C ../ ; \
		echo "展開完了: $$(ls ../*.vmdk 2>/dev/null | head -1)"; \
	else \
		echo "エラー: ../*.ova も ../*.vmdk も見つかりません"; exit 1; \
	fi

clean:
	docker rmi $(TAG) 2>/dev/null || true

help:
	@echo "Targets:"
	@echo "  make                       OVA展開→ビルド (推奨)"
	@echo "  make TAG_VERSION=10.16.1006 タグ末尾を固定"
	@echo "  make clean                 イメージ削除"
