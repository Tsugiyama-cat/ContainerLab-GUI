# ArubaOS-CX Docker イメージビルド
# 使い方: make IMAGE=arubaoscx-disk-image-genericx86-p4-XXXXXXXX.vmdk

VENDOR    = Aruba
NAME      = ArubaOS-CX
NAMESPACE = clabgui

IMAGE     ?= $(shell ls ../**.vmdk 2>/dev/null | head -1 | xargs basename)
VERSION   = $(shell echo $(IMAGE) | sed -rn 's/.*arubaoscx-disk-image-genericx86-p4-(.+)\.vmdk/\1/p')
TAG       = $(NAMESPACE)/aruba_arubaos-cx:$(VERSION)

.PHONY: docker-image clean

docker-image:
	@if [ -z "$(IMAGE)" ]; then \
		echo "エラー: ../に .vmdk ファイルが見つかりません"; exit 1; \
	fi
	@echo "ビルド対象: $(IMAGE) → $(TAG)"
	cp ../$(IMAGE) ./
	docker build --build-arg IMAGE=$(IMAGE) -t $(TAG) .
	rm -f ./$(IMAGE)
	@echo "完了: $(TAG)"

clean:
	docker rmi $(TAG) 2>/dev/null || true
