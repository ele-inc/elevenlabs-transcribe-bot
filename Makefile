# Load environment variables from .env file
# Save current PATH before including .env
_STD_PATH := /opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
include .env
# Export all variables and ensure PATH includes standard locations
export PATH := $(_STD_PATH):$(or $(PATH),)
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
		echo "Usage: make transcribe FILE=<file-or-url> [ARGS='--option value']"; \
		echo ""; \
		echo "Examples:"; \
		echo "  make transcribe FILE=audio.mp3"; \
		echo "  make transcribe FILE=video.mp4 ARGS='--output transcript.txt'"; \
		echo "  make transcribe FILE=meeting.m4a ARGS='--speaker-names \"Alice,Bob\"'"; \
		echo "  make transcribe FILE=audio.wav ARGS='--no-diarize --format json'"; \
		echo "  make transcribe FILE='https://www.dropbox.com/...' ARGS='--speaker-names \"Alice,Bob\"'"; \
		exit 1; \
	fi
	@export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$$PATH" && \
	if echo "$(FILE)" | grep -q '^https\?://'; then \
		echo "🌐 Transcribing from URL: $(FILE)"; \
	else \
		echo "🎙️ Transcribing file: $(FILE)"; \
	fi
	@export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$$PATH" && \
	deno run --allow-all src/cli.ts "$(FILE)" $(ARGS)

# Replace speaker labels in transcript
replace-speakers:
	@if [ -z "$(FILE)" ] || [ -z "$(SPEAKERS)" ]; then \
		echo "Error: FILE and SPEAKERS parameters are required"; \
		echo "Usage: make replace-speakers FILE=transcript.txt SPEAKERS='Name1,Name2,Name3' [OUTPUT=output.txt]"; \
		echo ""; \
		echo "Examples:"; \
		echo "  make replace-speakers FILE=transcript.txt SPEAKERS='Alice,Bob'"; \
		echo "  make replace-speakers FILE=meeting.txt SPEAKERS='John,Jane,Mike' OUTPUT=labeled.txt"; \
		exit 1; \
	fi
	@echo "👥 Replacing speaker labels in: $(FILE)"
	@echo "   Speaker candidates: $(SPEAKERS)"
	@scripts/replace-speakers.ts "$(FILE)" "$(SPEAKERS)" $(OUTPUT)

# Help
help:
	@echo "Available commands:"
	@echo "  make deploy          - Deploy to Cloud Run with .env variables"
	@echo "  make dev             - Start local development server"
	@echo "  make build           - Build Docker image locally"
	@echo "  make docker-run      - Run Docker container locally"
	@echo "  make install         - Cache Deno dependencies"
	@echo "  make status          - Show Cloud Run deployment status"
	@echo "  make env             - Show current environment variables"
	@echo "  make logs            - Show recent Cloud Run logs"
	@echo "  make transcribe      - Transcribe audio/video files locally or from URL"
	@echo "                        Usage: make transcribe FILE=<file-or-url> [ARGS='options']"
	@echo "  make replace-speakers - Replace speaker labels with names using AI"
	@echo "                        Usage: make replace-speakers FILE=transcript.txt SPEAKERS='Name1,Name2'"
	@echo "  make help            - Show this help message"
