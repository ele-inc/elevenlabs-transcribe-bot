FROM denoland/deno:2.4.5

# Install ffmpeg for video to audio conversion and yt-dlp for YouTube downloads
RUN apt-get update && apt-get install -y ffmpeg yt-dlp && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency files
COPY src/deno.json ./

# Don't copy lockfile to avoid version conflicts
# It will be regenerated inside the container

# Cache dependencies
COPY src/*.ts ./
RUN deno cache index.ts

# Copy all source files
COPY src/ ./

# Cloud Run uses PORT env variable (default 8080)
EXPOSE 8080

# Run with necessary permissions
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-run", "--unstable-kv", "--unstable-temporal", "index.ts"]
