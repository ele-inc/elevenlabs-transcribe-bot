#!make
include .env
export

# Cloud Run deployment
deploy:
	@echo "🚀 Deploying to Cloud Run..."
	@./scripts/deploy.sh

# Local development
dev:
	@echo "🔧 Starting local development server..."
	@./test-local.sh

# Build Docker image locally
build:
	@echo "🔨 Building Docker image..."
	docker build -t scribe-bot-local .

# Run Docker container locally
docker-run: build
	@echo "🐳 Running Docker container..."
	docker run -p 8080:8080 --env-file .env scribe-bot-local

# Cache Deno dependencies
install:
	cd src && deno cache index.ts

# Reload Deno cache
reload-cache:
	deno cache --reload ./src/index.ts

# Show deployment status
status:
	@echo "📊 Cloud Run Service Status:"
	@gcloud run services describe scribe-bot --region asia-northeast1 --format="table(status.url,status.traffic.percent,spec.template.spec.containers[0].image)"

# Show environment variables
env:
	@echo "🔧 Current Environment Variables:"
	@gcloud run services describe scribe-bot --region asia-northeast1 --format="yaml" | grep -A 100 "env:" | grep -E "name:|value:" | sed 's/^[ ]*//' | awk 'BEGIN{ORS=""} /name:/{if(NR>1)print "\n"; print $$2 "="} /value:/{print $$2}' | column -t -s "="

# Show logs
logs:
	@echo "📜 Recent logs:"
	@gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=scribe-bot" --limit 50 --format json | jq -r '.[] | "\(.timestamp): \(.textPayload // .jsonPayload.message)"'

# Local transcription
transcribe:
	@if [ -z "$(FILE)" ]; then \
		echo "Error: FILE parameter is required"; \
		echo "Usage: make transcribe FILE=path/to/audio.mp3 [ARGS='--option value']"; \
		echo ""; \
		echo "Examples:"; \
		echo "  make transcribe FILE=audio.mp3"; \
		echo "  make transcribe FILE=video.mp4 ARGS='--output transcript.txt'"; \
		echo "  make transcribe FILE=meeting.m4a ARGS='--speaker-names \"Alice,Bob\"'"; \
		echo "  make transcribe FILE=audio.wav ARGS='--no-diarize --format json'"; \
		exit 1; \
	fi
	@echo "🎙️ Transcribing file: $(FILE)"
	@deno run --allow-all src/cli-stream.ts $(FILE) $(ARGS)

# Help
help:
	@echo "Available commands:"
	@echo "  make deploy      - Deploy to Cloud Run with .env variables"
	@echo "  make dev         - Start local development server"
	@echo "  make build       - Build Docker image locally"
	@echo "  make docker-run  - Run Docker container locally"
	@echo "  make install     - Cache Deno dependencies"
	@echo "  make status      - Show Cloud Run deployment status"
	@echo "  make env         - Show current environment variables"
	@echo "  make logs        - Show recent Cloud Run logs"
	@echo "  make transcribe  - Transcribe audio/video files locally"
	@echo "                     Usage: make transcribe FILE=path/to/file [ARGS='options']"
	@echo "  make help        - Show this help message"
