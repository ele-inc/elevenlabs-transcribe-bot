FROM denoland/deno:latest

# 1. 必要な基本ツールをインストール
# - curl: ダウンロード用
# - xz-utils: ffmpegの圧縮形式(.tar.xz)の解凍用
# - python3: yt-dlpの実行に必須
RUN apt-get update && apt-get install -y \
    curl \
    xz-utils \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# 2. FFmpeg (Static Build) のインストール
# apt版ではなく、最新機能が含まれた静的ビルド(amd64)を採用
# これにより Mac環境に近い(あるいはそれ以上の)フィルタ品質を確保
RUN curl -O https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz && \
    tar -xJf ffmpeg-release-amd64-static.tar.xz && \
    mv ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ffmpeg && \
    mv ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ffprobe && \
    rm -rf ffmpeg*

# 3. yt-dlp (最新版) のインストール
# GitHubから最新バイナリを直接取得。これによりYouTube側の仕様変更に追従可能
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

# Copy dependency files
COPY src/deno.json ./

# Cache dependencies
# 注意: src/*.ts だけだとサブディレクトリの依存関係が解決できない場合があるため
# 構造によっては COPY src/ src/ としてからキャッシュする方が安全ですが、
# 現状で動いているならこのままでもOKです
COPY src/*.ts ./
# index.tsが存在しないとエラーになるため、構成に合わせて調整してください
# もしsrc直下にindex.tsがあるならこれでOK
RUN deno cache index.ts || true

# Copy all source files
COPY src/ ./

# Cloud Run uses PORT env variable (default 8080)
EXPOSE 8080

# Run with necessary permissions
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-run", "--unstable-kv", "--unstable-temporal", "index.ts"]
