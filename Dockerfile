FROM python:3.12-slim

# ContainerLab インストールに必要なツール
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl bash ca-certificates iproute2 \
    && rm -rf /var/lib/apt/lists/*

# ContainerLab インストール
RUN bash -c "$(curl -sL https://get.containerlab.dev)"

# Python 依存パッケージ
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# アプリ本体
COPY backend/  /app/backend/
COPY frontend/ /app/frontend/

WORKDIR /app/backend
EXPOSE 8888
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8888"]
