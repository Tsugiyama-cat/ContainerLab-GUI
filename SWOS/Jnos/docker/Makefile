# Juniper vJunos-Switch Docker イメージビルド
# 使い方: make IMAGE=vJunos-switch-25.4R1.12.qcow2

NAMESPACE = clabgui

IMAGE   ?= $(shell ls ../*.qcow2 2>/dev/null | head -1 | xargs basename)
VERSION = $(shell echo $(IMAGE) | sed -rn 's/vJunos-switch-(.+)\.qcow2/\1/p')
TAG     = $(NAMESPACE)/juniper_vjunosswitch:$(VERSION)

.PHONY: docker-image clean

docker-image:
	@if [ -z "$(IMAGE)" ]; then \
		echo "エラー: ../に .qcow2 ファイルが見つかりません"; exit 1; \
	fi
	@echo "ビルド対象: $(IMAGE) → $(TAG)"
	cp ../$(IMAGE) ./
	docker build --build-arg IMAGE=$(IMAGE) -t $(TAG) .
	rm -f ./$(IMAGE)
	@echo "完了: $(TAG)"

clean:
	docker rmi $(TAG) 2>/dev/null || true
