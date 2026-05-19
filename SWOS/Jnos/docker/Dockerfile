ARG DEBIAN_FRONTEND=noninteractive
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

LABEL org.opencontainers.image.authors="containerlab-gui"

RUN apt-get update -qy \
 && apt-get install -y --no-install-recommends \
    ca-certificates \
    bridge-utils \
    iproute2 \
    socat \
    qemu-kvm \
    qemu-utils \
    tcpdump \
    tftpd-hpa \
    ssh \
    inetutils-ping \
    dnsutils \
    iptables \
    nftables \
    telnet \
    git \
    dosfstools \
    genisoimage \
    ovmf \
 && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml /pyproject.toml
COPY uv.lock /uv.lock
RUN uv sync --frozen

COPY vrnetlab.py healthcheck.py /

ARG IMAGE=vJunos-switch-25.4R1.12.qcow2
COPY ${IMAGE}* /
COPY init.conf make-config.sh /
RUN chmod +x /make-config.sh
COPY *.py /

HEALTHCHECK CMD ["uv", "run", "/healthcheck.py"]
ENTRYPOINT ["uv", "run", "/launch.py"]

EXPOSE 22/tcp 161/udp 830/tcp 5000/tcp 57400/tcp 10000-10099/tcp
