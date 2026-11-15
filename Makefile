.PHONY: help up down logs build test-determinism clean

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

up: ## Start all services
	docker compose up -d

down: ## Stop all services
	docker compose down

logs: ## Tail logs from all services
	docker compose logs -f

build: ## Build all services
	docker compose build

test-determinism: ## Run determinism test
	docker compose exec physiology python test_determinism.py

validate-case: ## Validate a case file (usage: make validate-case CASE=cases/adult-tension-pneumothorax.yaml)
	@python3 scripts/validate-case.py $(CASE)

clean: ## Stop services and remove volumes
	docker compose down -v

restart: ## Restart all services
	docker compose restart

status: ## Show service status
	docker compose ps
