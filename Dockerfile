FROM denoland/deno:latest

# Install ffmpeg for video to audio conversion and yt-dlp for YouTube downloads
RUN apt-get update && apt-get install -y ffmpeg yt-dlp && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy all source files
COPY src/ ./

# Cache dependencies
RUN deno cache index.ts

# Cloud Run uses PORT env variable (default 8080)
EXPOSE 8080

# Run with necessary permissions
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-run", "--unstable-kv", "--unstable-temporal", "index.ts"]
