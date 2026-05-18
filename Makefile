.PHONY: build run stop restart logs help

PORT := 8888

help:
	@echo ""
	@echo "  ContainerLab GUI — コマンド一覧"
	@echo "  ─────────────────────────────────────────"
	@echo "  make build    イメージをビルド"
	@echo "  make run      コンテナ起動  http://localhost:$(PORT)"
	@echo "  make stop     コンテナ停止・削除"
	@echo "  make restart  コンテナ再起動"
	@echo "  make logs     ログをフォロー"
	@echo ""

build:
	docker compose build

run:
	docker compose up -d
	@echo ""
	@echo "  起動しました → http://localhost:$(PORT)"

stop:
	docker compose down

restart:
	docker compose restart

logs:
	docker compose logs -f clabgui
