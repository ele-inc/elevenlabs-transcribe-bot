FROM denoland/deno:2.4.5

WORKDIR /app

# Copy dependency files
COPY supabase/functions/scribe-bot/deno.json ./

# Don't copy lockfile to avoid version conflicts
# It will be regenerated inside the container

# Cache dependencies
COPY supabase/functions/scribe-bot/*.ts ./
RUN deno cache index.ts

# Copy all source files
COPY supabase/functions/scribe-bot/ ./

# Cloud Run uses PORT env variable (default 8080)
EXPOSE 8080

# Run with necessary permissions
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-run", "--unstable-kv", "--unstable-temporal", "index.ts"]
