FROM rust:1-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        pkg-config \
        curl \
        wget \
        file \
        xvfb \
        xauth \
        mold \
        libgtk-3-dev \
        libwebkit2gtk-4.1-dev \
        libxdo-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Tauri/WebKit-Tests: Link-Schritt braucht viel RAM; weniger parallele rustc-Jobs + mold-Linker
# reduzieren OOM-Risiko (Docker Desktop Default oft zu knapp).
ENV CARGO_BUILD_JOBS=1
ENV RUSTFLAGS="-C link-arg=-fuse-ld=mold"

WORKDIR /workspace/src-tauri
