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
	@deno run --allow-all src/cli.ts $(FILE) $(ARGS)

# Workspace Events Subscription Management
subscription-list:
	@echo "📋 Listing Workspace Events subscriptions..."
	@curl -s -X GET "https://workspaceevents.googleapis.com/v1beta/subscriptions?filter=target_resource%3D%22%2F%2Fdrive.googleapis.com%2Ffiles%2F$(DRIVE_INPUT_FOLDER_ID)%22" \
		-H "Authorization: Bearer $$(gcloud auth application-default print-access-token)" | jq '.'

subscription-delete:
	@if [ -z "$(SUBSCRIPTION_NAME)" ]; then \
		echo "Error: SUBSCRIPTION_NAME parameter is required"; \
		echo "Usage: make subscription-delete SUBSCRIPTION_NAME=subscriptions/drive-file-xxx"; \
		exit 1; \
	fi
	@echo "🗑️ Deleting subscription: $(SUBSCRIPTION_NAME)..."
	@curl -X DELETE "https://workspaceevents.googleapis.com/v1beta/subscriptions/$(SUBSCRIPTION_NAME)" \
		-H "Authorization: Bearer $$(gcloud auth application-default print-access-token)"

subscription-create:
	@echo "✨ Creating new Workspace Events subscription..."
	@ACCESS_TOKEN=$$(gcloud auth application-default print-access-token) && \
	curl -X POST "https://workspaceevents.googleapis.com/v1beta/subscriptions" \
		-H "Authorization: Bearer $${ACCESS_TOKEN}" \
		-H "Content-Type: application/json" \
		-H "X-Goog-User-Project: 804300863743" \
		-d '{ \
			"targetResource": "//drive.googleapis.com/files/$(DRIVE_INPUT_FOLDER_ID)", \
			"eventTypes": ["google.workspace.drive.file.v3.created"], \
			"payloadOptions": {"includeResource": false}, \
			"notificationEndpoint": { \
				"pubsubTopic": "projects/$(GCP_PROJECT_ID)/topics/drive-events-topic-1757063322" \
			}, \
			"driveOptions": {"includeDescendants": true} \
		}' | jq '.'

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
	@echo ""
	@echo "Workspace Events Management:"
	@echo "  make subscription-list   - List all Workspace Events subscriptions"
	@echo "  make subscription-delete - Delete a subscription"
	@echo "                            Usage: make subscription-delete SUBSCRIPTION_NAME=subscriptions/xxx"
	@echo "  make subscription-create - Create new subscription for Drive events"
	@echo ""
	@echo "  make help        - Show this help message"
