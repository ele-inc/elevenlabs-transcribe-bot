#!make
include .env
export

# Cloud Run deployment
deploy:
	@echo "🚀 Deploying to Cloud Run..."
	@./deploy-with-env.sh

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
	cd supabase/functions/scribe-bot && deno cache index.ts

# Reload Deno cache
reload-cache:
	deno cache --reload ./supabase/functions/scribe-bot/index.ts

# Show deployment status
status:
	@echo "📊 Cloud Run Service Status:"
	@gcloud run services describe scribe-bot --region asia-northeast1 --format="table(status.url,status.traffic.percent,spec.template.spec.containers[0].image)"

# Show logs
logs:
	@echo "📜 Recent logs:"
	@gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=scribe-bot" --limit 50 --format json | jq -r '.[] | "\(.timestamp): \(.textPayload // .jsonPayload.message)"'

# Help
help:
	@echo "Available commands:"
	@echo "  make deploy      - Deploy to Cloud Run with .env variables"
	@echo "  make dev         - Start local development server"
	@echo "  make build       - Build Docker image locally"
	@echo "  make docker-run  - Run Docker container locally"
	@echo "  make install     - Cache Deno dependencies"
	@echo "  make status      - Show Cloud Run deployment status"
	@echo "  make logs        - Show recent Cloud Run logs"
	@echo "  make help        - Show this help message"
